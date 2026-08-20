import { SimplePool } from 'nostr-tools';
import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import { resolveRecord } from './backfill';
import { publishRecord, type PublishOutcome } from './relay';

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

// Uploads queued records one at a time. Serial on purpose: a burst of parallel publishes
// to a single relay buys nothing and makes a partial failure harder to reason about.
export async function pushQueue(store: WorkstrStore, signer: Signer, relayUrl: string, options: PushOptions = {}): Promise<PushSummary> {
  const queued = await store.listSyncQueue();
  const batch = options.limit ? queued.slice(0, options.limit) : queued;
  const rejected: PublishOutcome[] = [];
  const failed: PublishOutcome[] = [];
  let uploaded = 0;
  const pool = new SimplePool();

  try {
    for (const [index, entry] of batch.entries()) {
      const snapshot = await resolveRecord(store, entry.address);
      // Gone locally means deleted: publish a tombstone rather than dropping the entry,
      // because an addressable event cannot be withdrawn from an open relay.
      const record = snapshot
        ? { address: snapshot.address, updatedAt: snapshot.updatedAt, payload: snapshot.payload }
        : { address: entry.address, updatedAt: entry.updated_at, deleted: true };

      const outcome = await publishRecord(signer, relayUrl, record, pool, false);
      if (outcome.accepted) {
        // Only now: an unacknowledged publish that cleared the queue would lose the record.
        await store.dequeueSync(entry.address, record.updatedAt);
        uploaded += 1;
      } else if (outcome.failure === 'policy') {
        // Kept in the queue deliberately. A silently vanishing record is the one outcome
        // a backup feature may never produce, even when the relay refuses it.
        rejected.push(outcome);
      } else {
        failed.push(outcome);
      }
      options.onProgress?.(index + 1, batch.length);
    }
  } finally {
    pool.close([relayUrl]);
  }

  return { attempted: batch.length, uploaded, rejected, failed, remaining: (await store.listSyncQueue()).length };
}
