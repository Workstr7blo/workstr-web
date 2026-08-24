import { SimplePool } from 'nostr-tools';
import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import type { RecordCipher } from '../nostr/codecs30078';
import { loadSessionEntries, resolveRecord, type SessionEntry } from './backfill';
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
  // Builds a fresh connection to the signer. A remote signer is reached over a relay
  // socket that is allowed to close whenever it likes, and a month is many records, so a
  // pass that gave up at the first silence uploaded one record per press of Sync now.
  renewSigner?: () => Promise<Signer | null>;
}

// How many times one pass will rebuild the connection before it accepts that the signer is
// really gone. Enough to carry a month of records through a flaky socket; not so many that
// a signer that is genuinely away costs minutes of timeouts before it says so.
const MAX_RECONNECTS = 6;

async function recordsFor(
  store: WorkstrStore,
  entry: { address: string; updated_at: string },
  sessions: SessionEntry[]
): Promise<{ records: PrivateRecord[]; updatedAt: string }> {
  const snapshot = await resolveRecord(store, entry.address, sessions);
  // Gone locally means deleted: publish a tombstone rather than dropping the entry,
  // because an addressable event cannot be withdrawn from an open relay.
  return snapshot
    ? { records: [{ address: snapshot.address, updatedAt: snapshot.updatedAt, payload: snapshot.payload }], updatedAt: snapshot.updatedAt }
    : { records: [{ address: entry.address, updatedAt: entry.updated_at, deleted: true }], updatedAt: entry.updated_at };
}

// Uploads queued records one at a time. Serial on purpose: a burst of parallel publishes
// to a single relay buys nothing and makes a partial failure harder to reason about.
export async function pushQueue(store: WorkstrStore, signer: Signer, cipher: RecordCipher, relayUrl: string, options: PushOptions = {}): Promise<PushSummary> {
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
  // What this device has already put on the relay, by address.
  const seen = new Map((await store.listSeen()).map((entry) => [entry.address, entry]));

  // Counted in records so the status reflects accepted relay writes.
  let sent = 0;
  const report = (remainingEntries: number, remainingHere: number): void =>
    options.onProgress?.(sent, sent + remainingHere + remainingEntries);

  // Replaced in place when the connection is rebuilt mid-pass, so the records after the
  // one that failed are sent over the new connection rather than the dead one.
  let active = signer;
  let reconnects = 0;

  try {
    for (const [index, entry] of batch.entries()) {
      const { records, updatedAt } = await recordsFor(store, entry, sessions);
      report(batch.length - index - 1, records.length);
      let complete = true;
      let signerIsGone = false;

      for (const [position, record] of records.entries()) {
        // Already on the relay, unchanged since it went there.
        if (seen.get(record.address)?.updated_at === record.updatedAt) {
          sent += 1;
          report(batch.length - index - 1, records.length - position - 1);
          continue;
        }
        let outcome = await publishRecord(active, cipher, relayUrl, record, pool, false);
        // A silent signer is usually a closed socket rather than an absent user. Rebuild
        // and retry this record once before leaving it queued.
        if (!outcome.accepted && outcome.failure === 'signer' && options.renewSigner && reconnects < MAX_RECONNECTS) {
          reconnects += 1;
          const renewed = await options.renewSigner();
          if (renewed) {
            active = renewed;
            outcome = await publishRecord(active, cipher, relayUrl, record, pool, false);
          }
        }
        if (outcome.accepted) {
          // The device already holds what it just sent, so the next pull recognises this
          // event in the relay's answer and skips decrypting its own upload back to itself.
          if (outcome.eventId && outcome.createdAt) await store.noteSeen(record.address, outcome.eventId, outcome.createdAt, record.updatedAt);
          sent += 1;
          report(batch.length - index - 1, records.length - position - 1);
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
      report(batch.length - index - 1, 0);
      if (signerIsGone) break;
    }
  } finally {
    pool.close([relayUrl]);
  }

  return { attempted: batch.length, uploaded, rejected, failed, remaining: (await store.listSyncQueue()).length };
}
