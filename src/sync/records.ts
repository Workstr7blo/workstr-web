import type { BodyWeightEntry, Session, SessionSet, WorkstrSettings } from '../core/types';
import type { SheetWithExercises } from '../db/store';
import { BODYWEIGHT_ADDRESS, SETTINGS_ADDRESS, sessionAddress, sessionsAddress, sheetAddress } from './addresses';

export interface RecordSnapshot<T = unknown> {
  address: string;
  updatedAt: string;
  payload: T;
}

// Preferences that describe the user, not the device. `workstrRelay` and `signerType` are
// how this browser reaches the network, `canonCache` is a re-fetchable catalog copy, and
// `backup` is this device's sync state — replicating any of them would fight the device
// it landed on rather than restore anything.
export const SYNCED_SETTINGS_KEYS = ['unit', 'publicRelays', 'heightCm', 'targetWeightKg', 'ownedEquipment', 'seedVersion'] as const;

export type SyncedSettings = Pick<WorkstrSettings, typeof SYNCED_SETTINGS_KEYS[number]>;

export function syncedSettings(settings: WorkstrSettings): SyncedSettings {
  const picked: Record<string, unknown> = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    if (settings[key] !== undefined) picked[key] = settings[key];
  }
  return picked as SyncedSettings;
}

// Autoincrement keys are meaningless on another device and actively harmful if restored,
// so every payload is stripped of them and rebuilt from its natural key on merge.
function withoutLocalKeys<T extends Record<string, unknown>>(row: T, ...keys: string[]): Omit<T, string> {
  const copy = { ...row };
  for (const key of ['id', ...keys]) delete copy[key];
  return copy;
}

export function sheetRecord(sheet: SheetWithExercises): RecordSnapshot {
  return {
    address: sheetAddress(sheet.slug),
    updatedAt: sheet.updated_at || sheet.created_at,
    payload: {
      ...withoutLocalKeys(sheet as unknown as Record<string, unknown>, 'exercises'),
      exercises: (sheet.exercises || []).map((row) => withoutLocalKeys(row as unknown as Record<string, unknown>, 'sheet_id', 'exercise_id'))
    }
  };
}

// A session has no `updated_at` column: it is written once at creation and then grows sets
// for as long as it runs. The newest thing that happened to it is its modification time.
export function sessionUpdatedAt(session: Session, sets: SessionSet[]): string {
  const stamps = [session.started_at, session.finished_at, ...sets.map((set) => set.completed_at)].filter(Boolean) as string[];
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest), stamps[0] || new Date().toISOString());
}

export function sessionRecord(session: Session, sets: SessionSet[]): RecordSnapshot {
  if (!session.uid) throw new Error('session has no uid; database upgrade did not run');
  return {
    address: sessionAddress(session.uid),
    updatedAt: sessionUpdatedAt(session, sets),
    payload: {
      ...withoutLocalKeys(session as unknown as Record<string, unknown>),
      sets: sets.map((set) => withoutLocalKeys(set as unknown as Record<string, unknown>, 'session_id', 'exercise_id'))
    }
  };
}

// One session inside a month bundle. It keeps its own `updatedAt` so a merge stays
// per session: two devices that both trained in the same month rewrite the same bundle
// address, and whole-record last-write-wins would let the later upload erase the other
// device's sessions.
export interface BundledSession {
  uid: string;
  updatedAt: string;
  deleted?: boolean;
  payload?: unknown;
}

export interface SessionsBundlePayload {
  month: string;
  // Absent on a month that fits in one record, which is almost all of them.
  part?: number;
  items: BundledSession[];
}

// What a NIP-46 signer's own relay has to carry to sign one of our records. A remote
// signer is asked to sign by sending it the whole unsigned event as a JSON-RPC parameter,
// itself NIP-44 encrypted into a kind:24133 event on the signer's relay — so our record
// travels inside another event, encrypted twice over. 32 KB is the most conservative
// event size in common use, and clearing it means every signer can answer.
export const NIP46_REQUEST_CEILING_BYTES = 32768;

// What a record's plaintext grows to by the time it is inside a signing request. NIP-44
// base64 inflates it at each of the two hops and every hop adds an event envelope, and the
// two compound: measured against real NIP-44, a part packed to the budget arrives at the
// signer's relay at 2.07x the JSON that went in.
//
// This factor is the whole reason the budget cannot be eyeballed. A 40 KB bundle produced
// an 83 KB request no relay would carry. Correcting it to 16 KB was still wrong: it was
// checked against a month of large sessions, which packs three to a part and stops well
// short of the budget, while a month of smaller sessions fills a part right up to it and
// produced a 33,269 byte request — over the ceiling by 500 bytes, and refused, while the
// encrypt request at 27,805 went through. Encrypt succeeding and signing failing is the
// signature of a budget that is too high by a little rather than a lot.
const NIP46_EXPANSION = 2.1;

// Kept off the ceiling rather than tuned up to it. Signers differ, the expansion varies
// with how JSON happens to compress, and the cost of a split is one more round trip while
// the cost of overshooting is a backup that does not work at all.
const NIP46_HEADROOM = 0.8;

// How much session JSON goes into one record before it is split. A part packed right to
// this budget is the worst case, and it is the one `tests/sync-bundle-size.test.ts`
// measures — the earlier test asserted on an easier shape and passed while real months
// were over the line.
export const MAX_BUNDLE_BYTES = Math.floor((NIP46_REQUEST_CEILING_BYTES * NIP46_HEADROOM) / NIP46_EXPANSION);

function bundledSessions(entries: { session: Session; sets: SessionSet[] }[]): BundledSession[] {
  return entries
    .filter((entry) => Boolean(entry.session.uid))
    .map((entry) => ({
      uid: String(entry.session.uid),
      updatedAt: sessionUpdatedAt(entry.session, entry.sets),
      payload: sessionRecord(entry.session, entry.sets).payload
    }))
    // Chronological, so a session logged today extends the last part and every part
    // before it stays byte-identical to what the relay already holds.
    .sort((a, b) => String((a.payload as { started_at?: string }).started_at).localeCompare(String((b.payload as { started_at?: string }).started_at)) || a.uid.localeCompare(b.uid));
}

function newest(items: BundledSession[]): string {
  return items.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), items[0]?.updatedAt || new Date().toISOString());
}

// The month's sessions as one record. This is what makes a first sync finish: a signer
// round trip is the unit of cost, and bundling turns two per session into two per month.
// This is the month's logical record — what the queue names and the manifest lists.
// `sessionsBundleRecords` is what actually goes on the wire.
export function sessionsBundleRecord(month: string, entries: { session: Session; sets: SessionSet[] }[]): RecordSnapshot<SessionsBundlePayload> {
  const items = bundledSessions(entries);
  return { address: sessionsAddress(month), updatedAt: newest(items), payload: { month, items } };
}

// The month split into records that each fit in one event. One part for almost every
// month; a very heavy one becomes two or three, which is still nothing beside the one
// event per session this replaced.
export function sessionsBundleRecords(month: string, entries: { session: Session; sets: SessionSet[] }[]): RecordSnapshot<SessionsBundlePayload>[] {
  const parts: BundledSession[][] = [[]];
  let bytes = 0;
  for (const item of bundledSessions(entries)) {
    const size = JSON.stringify(item).length;
    const current = parts[parts.length - 1];
    // A single session larger than the whole budget still gets its own part rather than
    // being dropped: one oversized record is a visible relay rejection, silence is not.
    if (current.length > 0 && bytes + size > MAX_BUNDLE_BYTES) {
      parts.push([]);
      bytes = 0;
    }
    parts[parts.length - 1].push(item);
    bytes += size;
  }
  return parts
    .filter((items) => items.length > 0)
    .map((items, index) => ({
      address: sessionsAddress(month, index + 1),
      updatedAt: newest(items),
      payload: { month, part: index + 1, items }
    }));
}

// Body weight and settings are one record each rather than one per row: they are small,
// always read as a whole, and a per-row address would leak the training calendar into
// cleartext `d` tags on an open relay.
export function bodyweightRecord(entries: BodyWeightEntry[], updatedAt: string): RecordSnapshot {
  return {
    address: BODYWEIGHT_ADDRESS,
    updatedAt,
    payload: { entries: entries.map((entry) => withoutLocalKeys(entry as unknown as Record<string, unknown>)) }
  };
}

export function settingsRecord(settings: WorkstrSettings, updatedAt: string): RecordSnapshot<SyncedSettings> {
  return { address: SETTINGS_ADDRESS, updatedAt, payload: syncedSettings(settings) };
}
