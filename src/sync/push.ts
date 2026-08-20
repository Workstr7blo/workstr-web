import { SimplePool } from 'nostr-tools';
import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import { loadSessionEntries, resolveMonthRecords, resolveRecord, type SessionEntry } from './backfill';
import { parseAddress, parseSessionsId } from './addresses';
import { publishRecord, type PublishOutcome } from './relay';
import type { PrivateRecord } from '../nostr/codecs30078';

export interface PushSummary {
  attempted: number;
  uploaded: number;
  // A policy rejection will never succeed unchanged, so it is counted separately from a
  // failure that retrying will fix on its own.
  rejected: PublishOutcome[];
  failed: PublishOutcome[];
  remaining: number;
}

export interface PushOptions {
  // Backfilling a long history must not hold the main thread or the queue lock, so the
  // caller can bound one pass and come back for the rest.
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}

// What one queue entry actually publishes as, and the timestamp that covers it. A month
// resolves to its parts; everything else is a single record. `updatedAt` is what the
// dequeue is checked against, so it has to describe the whole entry, not one part of it.
async function recordsFor(
  store: WorkstrStore,
  entry: { address: string; updated_at: string },
  sessions: SessionEntry[]
): Promise<{ records: PrivateRecord[]; updatedAt: string }> {
  const parsed = parseAddress(entry.address);
  if (parsed?.kind === 'sessions') {
    const parts = await resolveMonthRecords(store, parseSessionsId(String(parsed.id)).month, sessions);
    if (parts.length > 0) {
      const updatedAt = parts.reduce((latest, part) => (part.updatedAt > latest ? part.updatedAt : latest), parts[0].updatedAt);
      return { records: parts.map((part) => ({ address: part.address, updatedAt: part.updatedAt, payload: part.payload })), updatedAt };
    }
    return { records: [{ address: entry.address, updatedAt: entry.updated_at, deleted: true }], updatedAt: entry.updated_at };
  }
  const snapshot = await resolveRecord(store, entry.address, sessions);
  // Gone locally means deleted: publish a tombstone rather than dropping the entry,
  // because an addressable event cannot be withdrawn from an open relay.
  return snapshot
    ? { records: [{ address: snapshot.address, updatedAt: snapshot.updatedAt, payload: snapshot.payload }], updatedAt: snapshot.updatedAt }
    : { records: [{ address: entry.address, updatedAt: entry.updated_at, deleted: true }], updatedAt: entry.updated_at };
}

// Uploads queued records one at a time. Serial on purpose: a burst of parallel publishes
// to a single relay buys nothing and makes a partial failure harder to reason about.
export async function pushQueue(store: WorkstrStore, signer: Signer, relayUrl: string, options: PushOptions = {}): Promise<PushSummary> {
  const queued = await store.listSyncQueue();
  const batch = options.limit ? queued.slice(0, options.limit) : queued;
  const rejected: PublishOutcome[] = [];
  const failed: PublishOutcome[] = [];
  let uploaded = 0;
  const pool = new SimplePool();
  // Read once for the whole pass. Anything logged while the pass runs re-queues itself,
  // and `dequeueSync` refuses to clear an entry newer than what was actually published,
  // so a snapshot taken here can never swallow a change made during the upload.
  const sessions = await loadSessionEntries(store);

  try {
    for (const [index, entry] of batch.entries()) {
      const { records, updatedAt } = await recordsFor(store, entry, sessions);
      let complete = true;
      let signerIsGone = false;

      // A month can publish as more than one event. The queue entry clears only when all
      // of them are in, so an interrupted month is retried whole rather than left half
      // uploaded with nothing recording which half made it.
      for (const record of records) {
        const outcome = await publishRecord(signer, relayUrl, record, pool, false);
        if (outcome.accepted) {
          // The device already holds what it just sent, so the next pull recognises this
          // event in the relay's answer and skips decrypting its own upload back to itself.
          if (outcome.eventId && outcome.createdAt) await store.noteSeen(record.address, outcome.eventId, outcome.createdAt);
          continue;
        }
        complete = false;
        if (outcome.failure === 'signer') {
          // Every remaining record would wait out the same timeout, turning one dead
          // signer into minutes of hanging. Stop and report; the queue keeps its place.
          signerIsGone = true;
          failed.push(outcome);
        } else if (outcome.failure === 'policy') {
          // Kept in the queue deliberately. A silently vanishing record is the one outcome
          // a backup feature may never produce, even when the relay refuses it.
          rejected.push(outcome);
        } else {
          failed.push(outcome);
        }
        break;
      }

      if (complete) {
        // Only now: an unacknowledged publish that cleared the queue would lose the record.
        await store.dequeueSync(entry.address, updatedAt);
        uploaded += 1;
      }
      options.onProgress?.(index + 1, batch.length);
      if (signerIsGone) break;
    }
  } finally {
    pool.close([relayUrl]);
  }

  return { attempted: batch.length, uploaded, rejected, failed, remaining: (await store.listSyncQueue()).length };
}
