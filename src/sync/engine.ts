import type { WorkstrStore } from '../db/store';
import type { Signer } from '../signer/types';
import { runBackfill, seedJournal } from './backfill';
import { pullAndMerge } from './merge';
import { pushQueue } from './push';
import { compactJournal, pushJournal } from './journal';
import { isRecordAddress, newDeviceId, parseAddress } from './addresses';
import { SignerTimeoutError, withSignerTimeout } from '../signer/timeout';
import { BackupKeyUnavailableError, republishBackupKey, resolveBackupKey } from '../nostr/backup-key';
import { fetchKeyEvent, publishKeyEvent } from './relay';
import { createRetrySchedule } from './retry';
import type { RecordCipher } from '../nostr/codecs30078';

// The single backup destination. Not a user preference and never announced: the relay
// accepts only this client's encrypted records, so putting it in the user's kind:10002
// would invite every other Nostr client to publish their notes at a relay that will
// refuse them. It is also never mixed into the catalog or public write relay sets.
export const WORKSTR_RELAY_URL = 'wss://relay.workstr.fit:43736';

// Logging a set writes several records in a burst; one sync afterwards is enough.
export const CHANGE_DEBOUNCE_MS = 4000;

// 5 moves workout history into the append-only log. A device on 4 wrote one record per
// workout; its sessions are seeded into the journal once and travel as chunks from then on.
// The per-workout records it already wrote stay readable and are simply never added to.
export const RECORD_FORMAT = 5;

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
  // A stalled signer with the quick retry already scheduled. Nothing for the user to do:
  // the connection is being rebuilt, and a red line telling them to go and open their
  // signer app is how a four-second recovery gets mistaken for a broken backup.
  reconnecting?: boolean;
}

export interface SyncEngineContext {
  store: WorkstrStore;
  relayUrl?: string;
  // Null when signed out or a NIP-46 connection has died. Sync goes quiet rather than
  // erroring loudly: the user is training, not administering a backup.
  getSigner(): Promise<Signer | null>;
  onStatus(status: SyncStatus): void;
  // Called when a signer stops answering, so the caller can discard the connection it
  // handed over. Without it a dead NIP-46 subscription is retried until the page reloads.
  onSignerStalled?(): void;
  // Called when a pull actually changed the database, so the caller can re-read what it
  // is showing. Restoring into IndexedDB is not enough on its own: the screen renders
  // state read when the namespace opened, and a device that has just signed in and pulled
  // its whole history would otherwise show nothing.
  onRestored?(): void;
  // Injected by tests so a backoff is asserted rather than waited out.
  schedule?(run: () => void, delayMs: number): () => void;
}

export interface SyncEngine {
  start(): Promise<SyncStatus>;
  stop(): void;
  syncNow(): Promise<SyncStatus>;
  status(): SyncStatus;
}

// A signer that stopped answering, wherever it was noticed. Both halves of a pass can
// meet one — a decrypt during restore, a sign during upload — and both mean the same
// thing to the caller, so one check in the catch decides to rebuild the connection.
class StalledSignerError extends Error {
  constructor() {
    super('Your signer did not respond. Open your signer app, then tap Sync now.');
    this.name = 'StalledSignerError';
  }
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
  // Whether the failure that ended the last pass was a signer going quiet: it is the one
  // failure whose next attempt is worth making immediately.
  let stalledLast = false;
  const retry = createRetrySchedule();
  let cancelTimer: (() => void) | null = null;
  // The relay is read once per session. Every later pass is an upload: re-reading the whole
  // history on a timer is wasted work even now that opening a record is local.
  let pulled = false;
  // Resolved once per run and then held: the unwrap is the only signer round trip the
  // backup key ever costs, and every record after it is sealed and opened locally.
  let cipher: RecordCipher | null = null;
  // Whether this run has already confirmed the wrapped key is still on the relay. Only
  // done when the key came from this device's cache, because that path never asks the
  // relay anything and would not notice the one record everything else depends on
  // going missing.
  let keyConfirmed = false;

  async function ensureCipher(signer: Signer): Promise<RecordCipher> {
    if (cipher) return cipher;
    const pubkey = await signer.getPublicKey();
    const transport = {
      fetchKeyEvent: () => fetchKeyEvent(relayUrl, pubkey),
      publishKeyEvent: (content: string) => publishKeyEvent(signer, relayUrl, content)
    };
    if (!(await ctx.store.getSettings()).backup?.device) {
      await ctx.store.saveBackupState({ device: newDeviceId() });
    }
    const cached = (await ctx.store.getSettings()).backup?.key;
    const key = await resolveBackupKey(signer, transport, {
      read: async () => (await ctx.store.getSettings()).backup?.key,
      write: async (raw: string) => { await ctx.store.saveBackupState({ key: raw }); }
    });

    // Cheap in the currency that matters: one relay round trip, and the two signer round
    // trips of a republish only when the record is actually gone.
    if (cached && !keyConfirmed) {
      keyConfirmed = true;
      if (!(await fetchKeyEvent(relayUrl, pubkey).catch(() => null))) {
        await republishBackupKey(signer, transport, cached);
      }
    }

    cipher = { key, pubkey };
    return cipher;
  }

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

    // Before anything reads or writes a record. Nothing in a pass can proceed without it,
    // and it must never be improvised: see `resolveBackupKey`.
    const active = await ensureCipher(signer);

    if (!pulled) {
      // Before uploading anything: a device that has just signed in may be the empty one,
      // and last-write-wins protects a populated one.
      const merged = await pullAndMerge(ctx.store, signer, active, relayUrl, {
        onProgress: (done, total) => report({ progress: { phase: 'restore', done, total } })
      });
      pulled = true;
      report({ progress: undefined });
      if (merged.applied > 0 || merged.deleted > 0) ctx.onRestored?.();
      if (merged.unreadable > 0) report({ lastError: `${merged.unreadable} backup record(s) could not be read` });
    }

    if ((backup?.recordFormat ?? 0) < RECORD_FORMAT) {
      // The previous version left `workstr:v1:` addresses in the queue. This client cannot
      // resolve them, so they would publish as tombstones the relay refuses and hold the
      // engine in an error state no retry clears. Dropped once, here, before anything else.
      await ctx.store.purgeUnpublishableQueue();
      // Per-workout addresses queued by the previous format. They resolve to valid records,
      // but sending them would write history to the very addresses the log replaces.
      for (const entry of await ctx.store.listSyncQueue()) {
        if (parseAddress(entry.address)?.kind === 'session') await ctx.store.dequeueSync(entry.address, entry.updated_at);
      }
      await seedJournal(ctx.store);
      await ctx.store.saveBackupState({
        recordFormat: RECORD_FORMAT,
        v2StartedAt: backup?.v2StartedAt || new Date().toISOString(),
        backfillCursor: 0,
        backfillTotal: undefined
      });
      report({ progress: undefined });
    }

    // Recounted every pass rather than captured once at the cutover: deleting an old
    // workout, or importing an archive, changes how many are held back from the relay, and
    // a number frozen at the cutover would keep reporting the count from before.
    const counts = await ctx.store.countSessionBackupEra();
    if (counts.localOnly !== backup?.localOnlyHistoryCount) {
      await ctx.store.saveBackupState({ localOnlyHistoryCount: counts.localOnly });
    }

    const refreshed = await ctx.store.getSettings();
    const currentBackup = refreshed.backup;
    if (currentBackup?.backfillTotal === undefined || (currentBackup.backfillCursor ?? 0) < currentBackup.backfillTotal) {
      const progress = await runBackfill(ctx.store, currentBackup?.backfillCursor ?? 0, async ({ cursor, total }) => {
        await ctx.store.saveBackupState({ backfillCursor: cursor, backfillTotal: total });
        report({ progress: { phase: 'prepare', done: cursor, total } });
      });
      await ctx.store.saveBackupState({ backfillCursor: progress.cursor, backfillTotal: progress.total });
      report({ progress: undefined });
    }

    // One signer round trip per record now — the signature. Reported per record so a long
    // upload is visibly moving rather than indistinguishable from a hang.
    const renewSigner = async (): Promise<Signer | null> => {
      ctx.onSignerStalled?.();
      const renewed = await ctx.getSigner();
      return renewed ? withSignerTimeout(renewed) : null;
    };

    // Sheets and settings travel by address; workout history travels as log chunks. Both
    // are one signature per record, and both report through the same progress line.
    const result = await pushQueue(ctx.store, signer, active, relayUrl, {
      onProgress: (done, total) => report({ progress: { phase: 'upload', done, total } }),
      // Rebuilt through the same path a stalled signer takes between passes, so one press
      // of Sync now carries a long upload across a socket that closes partway.
      renewSigner
    });

    // Checked before the log is touched. A signer that has already stopped answering would
    // otherwise cost a second full round of timeouts here, which is the exact cost the
    // early stop inside a push exists to avoid.
    const signerFailure = result.failed.find((outcome) => outcome.failure === 'signer');
    if (signerFailure) {
      report({ progress: undefined });
      throw new StalledSignerError();
    }

    const log = await pushJournal(ctx.store, signer, active, relayUrl, 'log', {
      onProgress: (done, total) => report({ progress: { phase: 'upload', done, total } }),
      renewSigner
    });
    // The body log only after the workout log, so a stalled signer costs one round of
    // timeouts rather than two.
    const body = log.failed.length === 0
      ? await pushJournal(ctx.store, signer, active, relayUrl, 'body', {
        onProgress: (done, total) => report({ progress: { phase: 'upload', done, total } }),
        renewSigner
      })
      : { published: 0, skipped: 0, rejected: [], failed: [] };
    report({ progress: undefined });

    // A stalled signer means the same thing whichever half of the pass met it, so it gets
    // the same words the user can act on rather than the name of the call that timed out.
    if ([...log.failed, ...body.failed].some((outcome) => outcome.failure === 'signer')) throw new StalledSignerError();
    if (result.rejected.length > 0) {
      // The relay refused the record itself. Retrying unchanged cannot fix it, and the
      // entry stays queued rather than vanishing, so say so plainly.
      throw new Error(`Relay rejected ${result.rejected.length} record(s): ${result.rejected[0].reason}`);
    }
    const chunkRejected = [...log.rejected, ...body.rejected];
    if (chunkRejected.length > 0) throw new Error(`Relay rejected ${chunkRejected.length} record(s): ${chunkRejected[0].reason}`);
    if (result.failed.length > 0) throw new Error(result.failed[0].reason);
    const chunkFailed = [...log.failed, ...body.failed];
    if (chunkFailed.length > 0) throw new Error(chunkFailed[0].reason);

    // Reclaims sealed chunks that later entries have mostly replaced. Decided entirely from
    // this device's own journal, so it costs nothing until there is something to reclaim,
    // and it is the last thing a pass does: a backup that is larger than it needs to be is
    // still a working backup, so this must never be the reason a pass fails.
    for (const chunked of ['log', 'body'] as const) {
      await compactJournal(ctx.store, signer, active, relayUrl, chunked);
    }
  }

  async function runSync(): Promise<SyncStatus> {
    if (!running) return status;
    if (inFlight) { again = true; return inFlight; }

    clearTimer();
    report({ state: 'syncing', reconnecting: undefined });
    inFlight = (async (): Promise<SyncStatus> => {
      try {
        // Wrapped here so every downstream call — encrypt, decrypt, sign — is bounded.
        // One unwrapped signer call is enough to hang a pass forever.
        const resolved = await ctx.getSigner();
        const signer = resolved ? withSignerTimeout(resolved) : null;
        if (!signer) {
          failures += 1;
          stalledLast = false;
          return report({ state: 'error', lastError: 'Signer connection was lost. Sign in again to resume backup.' });
        }
        await pass(signer);
        failures = 0;
        stalledLast = false;
        retry.reset();
        const lastSyncAt = new Date().toISOString();
        await ctx.store.saveBackupState({ lastSyncAt, lastError: undefined });
        return report({ state: 'idle', pending: (await ctx.store.listSyncQueue()).length, lastSyncAt, lastError: undefined, reconnecting: undefined });
      } catch (error) {
        failures += 1;
        // A timeout on any single call means the same as a failed publish: the connection
        // is no longer answering. Say so in words the user can act on rather than naming
        // the internal call that happened to be first, and let the caller rebuild it so
        // the retry is not aimed at the same dead socket.
        // Never retried into a new key. The pass stops, the queue keeps its place, and the
        // user is told — inventing a second key here is the one failure that loses data.
        if (error instanceof BackupKeyUnavailableError) {
          stalledLast = false;
          await ctx.store.saveBackupState({ lastError: error.message });
          return report({ state: 'error', pending: (await ctx.store.listSyncQueue()).length, lastError: error.message, reconnecting: undefined });
        }
        const stalled = error instanceof StalledSignerError || error instanceof SignerTimeoutError;
        stalledLast = stalled;
        if (stalled) ctx.onSignerStalled?.();
        const message = stalled ? new StalledSignerError().message : error instanceof Error ? error.message : String(error);
        await ctx.store.saveBackupState({ lastError: message });
        // Never thrown onward: a failed backup is a status line, not an interrupted workout.
        // Only for the attempt the quick retry is scheduled for. Past that the signer has
        // had its second chance and is genuinely away, which is a thing to say plainly.
        return report({ state: 'error', pending: (await ctx.store.listSyncQueue()).length, lastError: message, reconnecting: stalled && failures === 1 });
      }
    })();

    try {
      const settled = await inFlight;
      return settled;
    } finally {
      inFlight = null;
      if (!running) clearTimer();
      else if (again) { again = false; scheduleSync(0); }
      else if (failures > 0) scheduleSync(retry.delayMs(failures, stalledLast));
    }
  }

  return {
    async start(): Promise<SyncStatus> {
      if (running) return status;
      running = true;
      failures = 0;
      stalledLast = false;
      retry.reset();
      ctx.store.setChangeListener((address, updatedAt) => {
        // A log entry reports itself so a pass gets scheduled, but it is not an address:
        // which chunk it lands in is not decided until the chunk is packed. Queueing one
        // would resolve to a tombstone at an address the relay refuses, which is precisely
        // how a pass gets wedged — the journal already records what to send.
        const queued = isRecordAddress(address)
          ? ctx.store.enqueueSync(address, updatedAt)
          : Promise.resolve();
        void queued.then(async () => {
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
      cipher = null;
      keyConfirmed = false;
      clearTimer();
      ctx.store.setChangeListener(null);
      // Both sides are left intact: the queue keeps its entries and the relay keeps its
      // records, so turning backup back on resumes rather than starting over.
      report({ state: 'off' });
    },

    syncNow(): Promise<SyncStatus> {
      failures = 0;
      retry.reset();
      return runSync();
    },

    status: () => status
  };
}
