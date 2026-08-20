import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import { retireLegacySessionQueue, runBackfill } from './backfill';
import { pullAndMerge } from './merge';
import { pushQueue } from './push';
import { withSignerTimeout } from '../signer/timeout';

// The single backup destination. Not a user preference and never announced: the relay
// accepts only this client's encrypted records, so putting it in the user's kind:10002
// would invite every other Nostr client to publish their notes at a relay that will
// refuse them. It is also never mixed into the catalog or public write relay sets.
export const WORKSTR_RELAY_URL = 'wss://relay.workstr.fit:43736';

// Failure is normal on a phone: a tunnel drops, a signer sleeps. Retry gets slower
// rather than hammering a relay that is not answering, and never gives up entirely.
export const RETRY_BASE_MS = 30000;
export const RETRY_MAX_MS = 900000;
// Logging a set writes several records in a burst; one sync afterwards is enough.
export const CHANGE_DEBOUNCE_MS = 4000;

// The record layout this client writes. Bumping it makes every device re-run its backfill
// once, in the new shape. See `BackupSettings.recordFormat`.
export const RECORD_FORMAT = 2;

export type SyncState = 'off' | 'idle' | 'syncing' | 'error';

// Which half of a pass is running. A first sync on a real history is minutes of work, and
// without this the status line reads the same whether it is uploading or wedged.
export interface SyncProgress {
  phase: 'restore' | 'prepare' | 'upload';
  done: number;
  total: number;
}

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt?: string;
  lastError?: string;
  progress?: SyncProgress;
}

export interface SyncEngineContext {
  store: WorkstrStore;
  relayUrl?: string;
  // Null when signed out or a NIP-46 connection has died. Sync goes quiet rather than
  // erroring loudly: the user is training, not administering a backup.
  getSigner(): Promise<Signer | null>;
  onStatus(status: SyncStatus): void;
  // Injected by tests so a backoff is asserted rather than waited out.
  schedule?(run: () => void, delayMs: number): () => void;
}

export interface SyncEngine {
  start(): Promise<SyncStatus>;
  stop(): void;
  syncNow(): Promise<SyncStatus>;
  status(): SyncStatus;
}

const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

export function createSyncEngine(ctx: SyncEngineContext): SyncEngine {
  const relayUrl = ctx.relayUrl || WORKSTR_RELAY_URL;
  const schedule = ctx.schedule || defaultSchedule;

  let status: SyncStatus = { state: 'off', pending: 0 };
  let running = false;
  let inFlight: Promise<SyncStatus> | null = null;
  // A change that lands mid-sync must not be lost to the pass that is already reading
  // the queue, so it asks for another one instead of being folded into this one.
  let again = false;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;
  // The relay is read once per session. Every later pass is an upload: re-decrypting the
  // whole history on a timer would put a NIP-46 round trip per record on the user's path.
  let pulled = false;

  const report = (next: Partial<SyncStatus>): SyncStatus => {
    status = { ...status, ...next };
    ctx.onStatus(status);
    return status;
  };

  const clearTimer = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const scheduleSync = (delayMs: number): void => {
    if (!running) return;
    clearTimer();
    cancelTimer = schedule(() => { cancelTimer = null; void runSync(); }, delayMs);
  };

  async function pass(signer: Signer): Promise<void> {
    const settings = await ctx.store.getSettings();
    const backup = settings.backup;

    if (!pulled) {
      // Before uploading anything: a device that has just signed in may be the empty one,
      // and last-write-wins protects a populated one.
      const merged = await pullAndMerge(ctx.store, signer, relayUrl, {
        onProgress: (done, total) => report({ progress: { phase: 'restore', done, total } })
      });
      pulled = true;
      report({ progress: undefined });
      if (merged.unreadable > 0) report({ lastError: `${merged.unreadable} backup record(s) could not be read` });
    }

    // A device that last synced in the per-session layout re-enqueues its history as month
    // bundles. Its old events stay on the relay and stay readable; nothing is deleted to
    // make this work, so an interrupted migration leaves a device that still restores.
    const migrating = (backup?.recordFormat ?? 1) < RECORD_FORMAT;
    if (migrating) {
      await retireLegacySessionQueue(ctx.store);
      await ctx.store.saveBackupState({ recordFormat: RECORD_FORMAT, backfillCursor: 0, backfillTotal: undefined });
    }

    // Resumable: an interrupted first run continues from its cursor rather than
    // re-enqueueing history it already sent.
    if (migrating || backup?.backfillTotal === undefined || (backup.backfillCursor ?? 0) < backup.backfillTotal) {
      const progress = await runBackfill(ctx.store, migrating ? 0 : backup?.backfillCursor ?? 0, async ({ cursor, total }) => {
        await ctx.store.saveBackupState({ backfillCursor: cursor, backfillTotal: total });
        report({ progress: { phase: 'prepare', done: cursor, total } });
      });
      await ctx.store.saveBackupState({ backfillCursor: progress.cursor, backfillTotal: progress.total });
      report({ progress: undefined });
    }

    // The slow half on a first run: two signer round trips per record. Reported per record
    // so a long upload is visibly moving rather than indistinguishable from a hang.
    const result = await pushQueue(ctx.store, signer, relayUrl, {
      onProgress: (done, total) => report({ progress: { phase: 'upload', done, total } })
    });
    report({ progress: undefined });
    const signerFailure = result.failed.find((outcome) => outcome.failure === 'signer');
    if (signerFailure) {
      throw new Error('Your signer did not respond. Open your signer app, then tap Sync now.');
    }
    if (result.rejected.length > 0) {
      // The relay refused the record itself. Retrying unchanged cannot fix it, and the
      // entry stays queued rather than vanishing, so say so plainly.
      throw new Error(`Relay rejected ${result.rejected.length} record(s): ${result.rejected[0].reason}`);
    }
    if (result.failed.length > 0) throw new Error(result.failed[0].reason);
  }

  async function runSync(): Promise<SyncStatus> {
    if (!running) return status;
    if (inFlight) { again = true; return inFlight; }

    clearTimer();
    report({ state: 'syncing' });
    inFlight = (async (): Promise<SyncStatus> => {
      try {
        // Wrapped here so every downstream call — encrypt, decrypt, sign — is bounded.
        // One unwrapped signer call is enough to hang a pass forever.
        const resolved = await ctx.getSigner();
        const signer = resolved ? withSignerTimeout(resolved) : null;
        if (!signer) {
          failures += 1;
          return report({ state: 'error', lastError: 'Signer connection was lost. Sign in again to resume backup.' });
        }
        await pass(signer);
        failures = 0;
        const lastSyncAt = new Date().toISOString();
        await ctx.store.saveBackupState({ lastSyncAt, lastError: undefined });
        return report({ state: 'idle', pending: (await ctx.store.listSyncQueue()).length, lastSyncAt, lastError: undefined });
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        await ctx.store.saveBackupState({ lastError: message });
        // Never thrown onward: a failed backup is a status line, not an interrupted workout.
        return report({ state: 'error', pending: (await ctx.store.listSyncQueue()).length, lastError: message });
      }
    })();

    try {
      const settled = await inFlight;
      return settled;
    } finally {
      inFlight = null;
      if (!running) clearTimer();
      else if (again) { again = false; scheduleSync(0); }
      else if (failures > 0) scheduleSync(Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
    }
  }

  return {
    async start(): Promise<SyncStatus> {
      if (running) return status;
      running = true;
      failures = 0;
      ctx.store.setChangeListener((address, updatedAt) => {
        void ctx.store.enqueueSync(address, updatedAt).then(async () => {
          report({ pending: (await ctx.store.listSyncQueue()).length });
          scheduleSync(CHANGE_DEBOUNCE_MS);
        });
      });
      report({ state: 'idle', pending: (await ctx.store.listSyncQueue()).length });
      return runSync();
    },

    stop(): void {
      running = false;
      again = false;
      pulled = false;
      clearTimer();
      ctx.store.setChangeListener(null);
      // Both sides are left intact: the queue keeps its entries and the relay keeps its
      // records, so turning backup back on resumes rather than starting over.
      report({ state: 'off' });
    },

    syncNow(): Promise<SyncStatus> {
      failures = 0;
      return runSync();
    },

    status: () => status
  };
}
