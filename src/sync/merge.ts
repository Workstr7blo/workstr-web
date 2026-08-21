import type { BodyWeightEntry, Session, SessionSet, Sheet, SheetExercise, WorkstrSettings } from '../core/types';
import type { WorkstrStore } from '../db/store';
import type { SignedNostrEvent, Signer } from '../signer/types';
import { decodePrivateRecord, type DecodedPrivateRecord, type RecordCipher } from '../nostr/codecs30078';
import { fetchRecords } from './relay';
import { resolveRecord } from './backfill';
import { parseAddress, sessionAddress } from './addresses';
import { sessionUpdatedAt, type SessionsBundlePayload, type SyncedSettings } from './records';

export interface MergeSummary {
  applied: number;
  skipped: number;
  deleted: number;
  // Events that could not be read at all. Surfaced rather than swallowed: a rising count
  // means a key changed or the data is damaged, which the user needs to know.
  unreadable: number;
}

export interface PullOptions {
  onProgress?: (done: number, total: number) => void;
}

// How far behind the newest event this device has read the next pull still asks. A device
// with a fast clock can stamp its own upload ahead of another device's, and a `since` cut
// exactly at that stamp would step over the other device's work permanently. Re-fetching a
// day is nearly free: those events are skipped by the ledger before any decrypt.
export const PULL_OVERLAP_SEC = 86400;

function dTag(event: SignedNostrEvent): string {
  return ((event.tags || []).find((tag) => tag[0] === 'd') || [])[1] || '';
}

async function unreadEvents(store: WorkstrStore, relayUrl: string, signer: Signer): Promise<SignedNostrEvent[]> {
  const seen = new Map((await store.listSeen()).map((entry) => [entry.address, entry]));
  const newest = [...seen.values()].reduce((latest, entry) => Math.max(latest, entry.created_at), 0);
  const since = newest > 0 ? Math.max(0, newest - PULL_OVERLAP_SEC) : undefined;

  const fetched = await fetchRecords(relayUrl, await signer.getPublicKey(), undefined, true, since);
  const unread = fetched.filter((event) => {
    const address = dTag(event);
    const parsed = parseAddress(address);
    if (!parsed) return false;
    // The wrapped backup key is NIP-44 to the user's own pubkey, not a sealed record, and
    // it is resolved before a pass starts. Left in, every pull would try to open it with
    // the key it hands out and report it as a record that could not be read.
    if (parsed.kind === 'key') return false;
    const known = seen.get(address);
    return !known || known.event_id !== event.id;
  });

  return unread;
}

// Decrypts one event at a time. Under NIP-46 every decrypt is a round trip to a remote
// signer, so this is deliberately not parallel and callers keep it off the critical path.
//
// The seen ledger is what keeps a routine start cheap. The `d` tag and `created_at` of an
// addressable event are cleartext, so an event this device has already read is recognised
// and dropped without asking the signer anything. Without it, opening the app cost one
// decrypt per record every single time, even when nothing had changed.
export async function pullRecords(store: WorkstrStore, relayUrl: string, signer: Signer, cipher: RecordCipher, options: PullOptions = {}): Promise<{ records: DecodedPrivateRecord[]; unreadable: number }> {
  const events = await unreadEvents(store, relayUrl, signer);

  const records: DecodedPrivateRecord[] = [];
  let unreadable = 0;
  let consecutiveFailures = 0;
  for (const [index, event] of events.entries()) {
    const decoded = await decodePrivateRecord(cipher, event);
    if (decoded) {
      records.push(decoded);
      consecutiveFailures = 0;
    } else {
      unreadable += 1;
      consecutiveFailures += 1;
      // A damaged record is rare and isolated; a run of failures from the very start is
      // the signer, not the data. Without this a restore would wait out one timeout per
      // event, which on a real history is hours of a status line saying nothing.
      if (consecutiveFailures >= 3 && records.length === 0) {
        throw new Error('Your backup could not be read with this account key.');
      }
    }
    options.onProgress?.(index + 1, events.length);
  }
  return { records, unreadable };
}

// The local claim on an address: a pending queue entry is an edit this device has made
// and not yet uploaded, so it outranks anything the relay can offer.
async function localUpdatedAt(store: WorkstrStore, address: string, pending: Map<string, string>): Promise<string | null> {
  const queued = pending.get(address);
  if (queued) return queued;
  // Singletons are rebuilt with a read timestamp, which says nothing about when they last
  // changed, and a month bundle is compared one session at a time rather than as a whole.
  // Only per-row records carry a timestamp worth comparing — and asking for any of the
  // others would rebuild the record just to throw the answer away.
  const kind = parseAddress(address)?.kind;
  if (kind !== 'sheet' && kind !== 'session') return null;
  const snapshot = await resolveRecord(store, address);
  return snapshot ? snapshot.updatedAt : null;
}

async function applySheet(store: WorkstrStore, record: DecodedPrivateRecord): Promise<void> {
  const payload = record.payload as Sheet & { exercises?: SheetExercise[] };
  const existing = await store.getSheetBySlug(String(record.parsed.id));
  await store.applyRemote(() => store.saveSheet({
    name: payload.name,
    notes: payload.notes,
    difficulty: payload.difficulty,
    tags: payload.tags,
    blocks: payload.blocks,
    is_temporary: payload.is_temporary,
    source_type: payload.source_type,
    nostr_pubkey: payload.nostr_pubkey,
    nostr_address: payload.nostr_address,
    nostr_event_id: payload.nostr_event_id,
    nostr_published_at: payload.nostr_published_at,
    origin_created_at: payload.origin_created_at,
    exercises: (payload.exercises || []).map((row, index) => ({ ...row, position: row.position ?? index }))
  }, existing?.id));
}

async function applySessionPayload(store: WorkstrStore, uid: string, raw: unknown): Promise<void> {
  const payload = raw as Session & { sets?: SessionSet[] };
  const { sets = [], ...session } = payload;
  await store.applyRemote(() => store.putSessionWithSets({ ...session, uid }, sets));
}

async function applySession(store: WorkstrStore, record: DecodedPrivateRecord): Promise<void> {
  await applySessionPayload(store, String(record.parsed.id), record.payload);
}

// A month bundle is merged one session at a time rather than as a whole. Two devices that
// both train in the same month write the same address, so taking the newer event entire
// would delete whatever the other device logged that month. Each session carries its own
// timestamp precisely so this comparison can be made per session.
async function applySessionsBundle(
  store: WorkstrStore,
  record: DecodedPrivateRecord,
  pending: Map<string, string>,
  tombstoned: Map<string, string>,
  summary: MergeSummary
): Promise<void> {
  const payload = record.payload as SessionsBundlePayload | undefined;
  if (!payload?.items?.length) return;
  // Read once per bundle. Every uid in a bundle is distinct, so no item can be invalidated
  // by another item's write, and looking each one up against the whole session table was
  // quadratic on exactly the full-history restore this exists to make fast.
  const held = new Map((await store.listSessions()).filter((session) => session.uid).map((session) => [String(session.uid), session]));
  for (const item of payload.items) {
    if (!item?.uid || typeof item.updatedAt !== 'string') { summary.skipped += 1; continue; }
    // Deleted through its own address after this part was written. A part the relay kept
    // when its month shrank below the split threshold still lists sessions that are gone,
    // and without this the resurrection would come down to which record merged first.
    const buried = tombstoned.get(item.uid);
    if (buried && buried >= item.updatedAt) { summary.skipped += 1; continue; }
    const existing = held.get(item.uid);
    if (!existing || existing.id == null) {
      // Queued against the session's own address with nothing behind it locally: this
      // device has deleted the session and not yet uploaded the tombstone. Writing the
      // session back would undo a deletion the user has already made.
      if (item.deleted || pending.has(sessionAddress(item.uid))) { summary.skipped += 1; continue; }
      await applySessionPayload(store, item.uid, item.payload);
      summary.applied += 1;
      continue;
    }
    const local = sessionUpdatedAt(existing, await store.listSessionSets(existing.id));
    if (local >= item.updatedAt) { summary.skipped += 1; continue; }
    if (item.deleted) {
      await store.applyRemote(() => store.deleteSession(existing.id as number));
      summary.deleted += 1;
      continue;
    }
    await applySessionPayload(store, item.uid, item.payload);
    summary.applied += 1;
  }
}

async function applySingleton(store: WorkstrStore, record: DecodedPrivateRecord): Promise<void> {
  if (record.parsed.kind === 'bodyweight') {
    const payload = record.payload as { entries?: BodyWeightEntry[] };
    await store.applyRemote(() => store.replaceBodyweight(payload.entries || []));
    return;
  }
  const incoming = record.payload as SyncedSettings;
  const current = await store.getSettings();
  // Only the synced keys are overwritten; this device's relay, signer and backup state
  // are its own and survive a restore untouched.
  await store.applyRemote(() => store.saveSettings({ ...current, ...incoming } as WorkstrSettings));
}

async function applyTombstone(store: WorkstrStore, record: DecodedPrivateRecord): Promise<boolean> {
  if (record.parsed.kind === 'sheet') {
    const existing = await store.getSheetBySlug(String(record.parsed.id));
    if (!existing?.id) return false;
    await store.applyRemote(() => store.deleteSheet(existing.id!));
    return true;
  }
  if (record.parsed.kind === 'session') {
    const existing = await store.getSessionByUid(String(record.parsed.id));
    if (existing?.id == null) return false;
    await store.applyRemote(() => store.deleteSession(existing.id!));
    return true;
  }
  // A singleton collection is never deleted, only emptied by a newer record. Treating a
  // tombstone here as "wipe settings" would let one stray event blank a device.
  return false;
}

// Which sessions this pull carries a deletion for, and when it was made. A tombstone and a
// stale bundle part can name the same session, so the answer has to be known before either
// is applied rather than decided by the order the relay happened to return them in.
function tombstonedSessions(records: DecodedPrivateRecord[]): Map<string, string> {
  const tombstoned = new Map<string, string>();
  for (const record of records) {
    if (!record.deleted || record.parsed.kind !== 'session' || !record.parsed.id) continue;
    const uid = String(record.parsed.id);
    const known = tombstoned.get(uid);
    if (!known || record.updatedAt > known) tombstoned.set(uid, record.updatedAt);
  }
  return tombstoned;
}

export async function mergeRecords(store: WorkstrStore, records: DecodedPrivateRecord[], unreadable = 0): Promise<MergeSummary> {
  const summary: MergeSummary = { applied: 0, skipped: 0, deleted: 0, unreadable };
  // Read once rather than per record: a full-history restore is exactly the case this
  // function exists for, and re-reading the queue inside the loop makes it quadratic.
  const pending = new Map((await store.listSyncQueue()).map((entry) => [entry.address, entry.updated_at]));
  const tombstoned = tombstonedSessions(records);
  for (const record of records) {
    const local = await localUpdatedAt(store, record.address, pending);
    if (local !== null && local >= record.updatedAt) {
      summary.skipped += 1;
      await store.noteSeen(record.address, record.eventId, record.createdAt);
      continue;
    }
    try {
      if (record.deleted) {
        if (await applyTombstone(store, record)) summary.deleted += 1; else summary.skipped += 1;
      } else if (record.parsed.kind === 'sessions') {
        await applySessionsBundle(store, record, pending, tombstoned, summary);
      } else if (record.parsed.kind === 'sheet') {
        await applySheet(store, record);
        summary.applied += 1;
      } else if (record.parsed.kind === 'session') {
        await applySession(store, record);
        summary.applied += 1;
      } else {
        await applySingleton(store, record);
        summary.applied += 1;
      }
      // Only a record that landed is remembered. One that threw is left out of the ledger
      // on purpose, so the next pull tries it again rather than writing it off forever.
      await store.noteSeen(record.address, record.eventId, record.createdAt);
    } catch {
      // One damaged record must not abort the restore of everything after it.
      summary.unreadable += 1;
    }
  }
  return summary;
}

// Restore progress has to be durable record-by-record. Mobile browsers and remote signers
// are routinely interrupted mid-pass; if the seen ledger is written only after every
// decrypt finishes, the next app open repeats the same signer prompts from the beginning.
// Processing each decoded record immediately means a phone that reached "2 of 13" starts
// next time after those two, not at one again.
export async function pullAndMerge(store: WorkstrStore, signer: Signer, cipher: RecordCipher, relayUrl: string, options: PullOptions = {}): Promise<MergeSummary> {
  const events = (await unreadEvents(store, relayUrl, signer)).sort((a, b) => a.created_at - b.created_at || dTag(a).localeCompare(dTag(b)));
  const summary: MergeSummary = { applied: 0, skipped: 0, deleted: 0, unreadable: 0 };
  let consecutiveFailures = 0;

  for (const [index, event] of events.entries()) {
    const decoded = await decodePrivateRecord(cipher, event);
    if (!decoded) {
      summary.unreadable += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3 && summary.applied === 0 && summary.deleted === 0 && summary.skipped === 0) {
        throw new Error('Your backup could not be read with this account key.');
      }
      options.onProgress?.(index + 1, events.length);
      continue;
    }

    consecutiveFailures = 0;
    const merged = await mergeRecords(store, [decoded]);
    summary.applied += merged.applied;
    summary.skipped += merged.skipped;
    summary.deleted += merged.deleted;
    summary.unreadable += merged.unreadable;
    options.onProgress?.(index + 1, events.length);
  }
  return summary;
}
