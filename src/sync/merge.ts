import type { BodyWeightEntry, Session, SessionSet, Sheet, SheetExercise, WorkstrSettings } from '../core/types';
import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import { decodePrivateRecord, type DecodedPrivateRecord } from '../nostr/codecs30078';
import { fetchRecords } from './relay';
import { resolveRecord } from './backfill';
import type { SyncedSettings } from './records';

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

// Decrypts one event at a time. Under NIP-46 every decrypt is a round trip to a remote
// signer, so this is deliberately not parallel and callers keep it off the critical path.
export async function pullRecords(relayUrl: string, signer: Signer, options: PullOptions = {}): Promise<{ records: DecodedPrivateRecord[]; unreadable: number }> {
  const events = await fetchRecords(relayUrl, await signer.getPublicKey());
  const records: DecodedPrivateRecord[] = [];
  let unreadable = 0;
  let consecutiveFailures = 0;
  for (const [index, event] of events.entries()) {
    const decoded = await decodePrivateRecord(signer, event);
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
        throw new Error('Signer could not decrypt your backup. Open your signer app and try again.');
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
  const snapshot = await resolveRecord(store, address);
  if (!snapshot) return null;
  // Singletons are rebuilt with a read timestamp, which says nothing about when they last
  // changed. Only per-row records carry a timestamp worth comparing.
  const parsed = address.split(':')[2];
  return parsed === 'sheet' || parsed === 'session' ? snapshot.updatedAt : null;
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

async function applySession(store: WorkstrStore, record: DecodedPrivateRecord): Promise<void> {
  const payload = record.payload as Session & { sets?: SessionSet[] };
  const { sets = [], ...session } = payload;
  await store.applyRemote(() => store.putSessionWithSets({ ...session, uid: String(record.parsed.id) }, sets));
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

export async function mergeRecords(store: WorkstrStore, records: DecodedPrivateRecord[], unreadable = 0): Promise<MergeSummary> {
  const summary: MergeSummary = { applied: 0, skipped: 0, deleted: 0, unreadable };
  // Read once rather than per record: a full-history restore is exactly the case this
  // function exists for, and re-reading the queue inside the loop makes it quadratic.
  const pending = new Map((await store.listSyncQueue()).map((entry) => [entry.address, entry.updated_at]));
  // The manifest is an index for deciding what to fetch, not a record to merge into the
  // database — applying it would mean writing a list of addresses over real data.
  for (const record of records.filter((candidate) => candidate.parsed.kind !== 'manifest')) {
    const local = await localUpdatedAt(store, record.address, pending);
    if (local !== null && local >= record.updatedAt) { summary.skipped += 1; continue; }
    try {
      if (record.deleted) {
        if (await applyTombstone(store, record)) summary.deleted += 1; else summary.skipped += 1;
        continue;
      }
      if (record.parsed.kind === 'sheet') await applySheet(store, record);
      else if (record.parsed.kind === 'session') await applySession(store, record);
      else await applySingleton(store, record);
      summary.applied += 1;
    } catch {
      // One damaged record must not abort the restore of everything after it.
      summary.unreadable += 1;
    }
  }
  return summary;
}

export async function pullAndMerge(store: WorkstrStore, signer: Signer, relayUrl: string, options: PullOptions = {}): Promise<MergeSummary> {
  const { records, unreadable } = await pullRecords(relayUrl, signer, options);
  return mergeRecords(store, records, unreadable);
}
