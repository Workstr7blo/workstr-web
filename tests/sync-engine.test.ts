import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { createSyncEngine, RECORD_FORMAT, RETRY_BASE_MS, type SyncStatus } from '../src/sync/engine';
import { sessionAddress, sessionsAddress, sheetAddress } from '../src/sync/addresses';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import { withSignerTimeout } from '../src/signer/timeout';
import type { PrivateRecord } from '../src/nostr/codecs30078';

const SELF = 'ab'.repeat(32);

// An in-memory relay behind the real transport module, so the engine drives the actual
// backfill, push, codec and merge code. Only the socket is fake.
const relay = vi.hoisted(() => ({
  events: new Map<string, { event: unknown }>(),
  failure: null as null | 'policy' | 'network',
  // Real event ids are content hashes, so republishing an address produces a different
  // one. The seen ledger keys on that, so a double that reused ids would never be tested.
  seq: 0
}));

vi.mock('../src/sync/relay', async () => {
  const { encodePrivateRecord } = await import('../src/nostr/codecs30078');
  return {
    PUBLISH_TIMEOUT_MS: 10000,
    FETCH_TIMEOUT_MS: 15000,
    classifyPublish: () => ({ accepted: true, reason: 'ok' }),
    async publishRecord(signer: Signer, _url: string, record: PrivateRecord) {
      if (relay.failure) return { address: record.address, accepted: false, failure: relay.failure, reason: `${relay.failure} failure` };
      try {
        const unsigned = await encodePrivateRecord(signer, record);
        const id = `id-${record.address}-${relay.seq += 1}`;
        // Addressable: republishing an address replaces it, exactly like a real relay.
        relay.events.set(record.address, { event: { ...unsigned, id, pubkey: SELF, sig: 'sig' } });
        return { address: record.address, accepted: true, reason: 'ok', eventId: id, createdAt: unsigned.created_at };
      } catch (error) {
        // Mirrors the real publishRecord: encoding and signing happen before anything is
        // sent, so a throw here is the signer. A double that lets it escape instead hides
        // the very handling these tests exist to check.
        return { address: record.address, accepted: false, failure: 'signer', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async fetchRecords() {
      return [...relay.events.values()].map((entry) => entry.event);
    }
  };
});

// Round-trips through the real codec without real keys: the "ciphertext" is the plaintext.
function fakeSigner(): Signer {
  return {
    type: 'nip07',
    getPublicKey: async () => SELF,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_peer: string, plaintext: string) => plaintext,
    nip44Decrypt: async (_peer: string, ciphertext: string) => ciphertext
  };
}

let namespace = 0;
const freshStore = () => WorkstrStore.open(`engine-${namespace += 1}`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// The engine deliberately runs its passes in the background, so tests wait on the
// condition rather than on a fixed number of microtask turns.
async function until(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Harness {
  store: WorkstrStore;
  statuses: SyncStatus[];
  timers: { run: () => void; delayMs: number }[];
}

async function harness(store: WorkstrStore, signer: Signer | null = fakeSigner(), onSignerStalled?: () => void) {
  const state: Harness = { store, statuses: [], timers: [] };
  const engine = createSyncEngine({
    store,
    relayUrl: 'ws://memory',
    getSigner: async () => signer,
    onStatus: (status) => state.statuses.push({ ...status }),
    onSignerStalled,
    schedule: (run, delayMs) => { state.timers.push({ run, delayMs }); return () => {}; }
  });
  return { engine, state };
}

async function populate(store: WorkstrStore): Promise<void> {
  await store.saveSheet({ name: 'Push Day', exercises: [{ exercise_slug: 'bench', position: 0, sets: 3, reps: '8' }] });
  const id = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z', sheet_name: 'Push Day' });
  await store.addSessionSet({ session_id: id, exercise_slug: 'bench', set_number: 1, reps: 8, weight_kg: 60, completed_at: '2026-08-01T10:05:00.000Z' });
  await store.finishSession(id, '2026-08-01T11:00:00.000Z');
  await store.logBody({ date: '2026-08-01', weight_kg: 80 });
}

beforeEach(() => {
  relay.events.clear();
  relay.failure = null;
  relay.seq = 0;
});

describe('turning backup on', () => {
  it('uploads the history that already exists and reports up to date', async () => {
    const store = await freshStore();
    await populate(store);
    const { engine } = await harness(store);

    const status = await engine.start();

    expect(status.state).toBe('idle');
    expect(status.pending).toBe(0);
    expect(status.lastSyncAt).toBeTruthy();
    expect([...relay.events.keys()]).toContain(sheetAddress('push-day'));
    // Sheet, session, bodyweight, settings and the manifest.
    expect(relay.events.size).toBe(5);
    expect(await store.listSyncQueue()).toHaveLength(0);
  });

  it('records the backfill as complete so it never runs twice', async () => {
    const store = await freshStore();
    await populate(store);
    const { engine } = await harness(store);
    await engine.start();

    const backup = (await store.getSettings()).backup;
    expect(backup?.enabled).toBe(false);
    expect(backup?.backfillCursor).toBe(backup?.backfillTotal);
    expect(backup?.backfillTotal).toBe(5);
  });

  it('resumes an interrupted first run instead of restarting it', async () => {
    const store = await freshStore();
    await populate(store);
    // A previous run got three records in before it was cut off.
    await store.saveBackupState({ recordFormat: RECORD_FORMAT, backfillCursor: 3, backfillTotal: 5 });
    const { engine } = await harness(store);

    await engine.start();

    // Only the tail was enqueued; the first three are not re-sent.
    expect(relay.events.size).toBe(2);
  });
});

describe('opening the app again', () => {
  it('does not ask the signer to decrypt a backup it has already read', async () => {
    const store = await freshStore();
    await populate(store);
    const signer = fakeSigner();
    const decrypt = vi.spyOn(signer, 'nip44Decrypt');

    const first = await harness(store, signer);
    await first.engine.start();
    first.engine.stop();
    expect(relay.events.size).toBeGreaterThan(0);

    // A fresh engine, exactly as a reopened PWA builds one. Everything on the relay is
    // this device's own upload, and the seen ledger recognises all of it.
    decrypt.mockClear();
    const second = await harness(store, signer);
    const status = await second.engine.start();

    expect(status.state).toBe('idle');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('reads only what changed elsewhere', async () => {
    const store = await freshStore();
    await populate(store);
    const signer = fakeSigner();
    const decrypt = vi.spyOn(signer, 'nip44Decrypt');
    const first = await harness(store, signer);
    await first.engine.start();
    first.engine.stop();

    // One record rewritten by another device, at an address this one already knows.
    const settings = relay.events.get('workstr:v1:settings')!;
    relay.events.set('workstr:v1:settings', { event: { ...(settings.event as Record<string, unknown>), id: 'from-another-device' } });

    decrypt.mockClear();
    const second = await harness(store, signer);
    await second.engine.start();

    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});

describe('a device that last synced before bundling', () => {
  it('re-sends its history as month bundles and drops the per-session queue', async () => {
    const store = await freshStore();
    await populate(store);
    const uid = (await store.listSessions())[0].uid as string;
    // The pre-bundle client left an entry per session in the queue and recorded no
    // record format, which is what marks the device as needing the migration.
    await store.saveBackupState({ enabled: true, backfillCursor: 4, backfillTotal: 4 });
    await store.enqueueSync(sessionAddress(uid), '2026-08-01T11:00:00.000Z');

    const { engine } = await harness(store);
    await engine.start();

    expect([...relay.events.keys()]).toContain(sessionsAddress('2026-08'));
    // The per-session address is not uploaded again: the month it belongs to carries it.
    expect([...relay.events.keys()]).not.toContain(sessionAddress(uid));
    expect(await store.listSyncQueue()).toHaveLength(0);
    expect((await store.getSettings()).backup?.recordFormat).toBe(RECORD_FORMAT);
  });

  it('keeps a queued deletion, which no bundle can express', async () => {
    const store = await freshStore();
    await populate(store);
    const [session] = await store.listSessions();
    await store.saveBackupState({ enabled: true, backfillCursor: 4, backfillTotal: 4 });
    await store.enqueueSync(sessionAddress(session.uid as string), '2026-08-02T11:00:00.000Z');
    // Deleted locally, so the queued address is a tombstone rather than a stale upload.
    await store.deleteSession(session.id as number);

    const { engine } = await harness(store);
    await engine.start();

    expect([...relay.events.keys()]).toContain(sessionAddress(session.uid as string));
  });
});

describe('staying in sync', () => {
  it('queues a local change and syncs it on the next scheduled pass', async () => {
    const store = await freshStore();
    const { engine, state } = await harness(store);
    await engine.start();
    relay.events.clear();

    await store.saveSheet({ name: 'Leg Day', exercises: [] });
    await until(() => state.timers.length > 0, 'the debounced sync to be scheduled');

    expect(state.timers.at(-1)?.delayMs).toBe(4000);
    expect(await store.listSyncQueue()).toHaveLength(1);

    state.timers.at(-1)!.run();
    await until(() => engine.status().state !== 'syncing', 'the scheduled sync to finish');
    expect([...relay.events.keys()]).toEqual([sheetAddress('leg-day')]);
  });

  it('restores onto a device that has never seen the data', async () => {
    const phone = await freshStore();
    await populate(phone);
    const first = await harness(phone);
    await first.engine.start();

    const laptop = await freshStore();
    expect(await laptop.listSheets()).toHaveLength(0);
    const second = await harness(laptop);
    await second.engine.start();

    const sheets = await laptop.listSheets();
    expect(sheets.map((sheet) => sheet.name)).toContain('Push Day');
    expect((await laptop.listBody()).map((entry) => entry.weight_kg)).toEqual([80]);
  });

  it('does not re-upload what it just restored', async () => {
    const phone = await freshStore();
    await populate(phone);
    await (await harness(phone)).engine.start();

    const laptop = await freshStore();
    const { engine } = await harness(laptop);
    await engine.start();
    // The merge wrote every record locally; none of it is a local edit.
    const queued = await laptop.listSyncQueue();
    expect(queued.filter((entry) => entry.address.includes('sheet'))).toHaveLength(0);
  });
});

describe('when the relay or signer will not cooperate', () => {
  it('reports a network failure and backs off further each time', async () => {
    const store = await freshStore();
    await populate(store);
    relay.failure = 'network';
    const { engine, state } = await harness(store);

    const first = await engine.start();
    expect(first.state).toBe('error');
    expect(state.timers.at(-1)?.delayMs).toBe(RETRY_BASE_MS);

    state.timers.at(-1)!.run();
    await until(() => engine.status().state !== 'syncing', 'the retry to finish');
    expect(state.timers.at(-1)?.delayMs).toBe(RETRY_BASE_MS * 2);
  });

  it('keeps a policy-rejected record queued and says so', async () => {
    const store = await freshStore();
    await populate(store);
    relay.failure = 'policy';
    const { engine } = await harness(store);

    const status = await engine.start();

    expect(status.state).toBe('error');
    expect(status.lastError).toContain('Relay rejected');
    // The one outcome a backup may never produce is a record that quietly disappears.
    expect((await store.listSyncQueue()).length).toBeGreaterThan(0);
  });

  it('does not hang forever when the signer never answers', async () => {
    // The iPhone bug: a NIP-46 signer that goes silent used to leave the pass wedged with
    // the status stuck on "syncing", no error, and Sync now returning the same dead promise.
    const store = await freshStore();
    await populate(store);
    const silent: Signer = {
      type: 'nip46',
      getPublicKey: async () => SELF,
      signEvent: () => new Promise(() => {}),
      nip44Encrypt: () => new Promise(() => {}),
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine, state } = await harness(store, withSignerTimeout(silent, 20));

    const status = await engine.start();

    expect(status.state).toBe('error');
    expect(status.lastError).toContain('signer did not respond');
    // And it schedules a retry rather than sitting there.
    expect(state.timers.at(-1)?.delayMs).toBe(RETRY_BASE_MS);
    // The queue is intact, so nothing was lost while the signer was away.
    expect((await store.listSyncQueue()).length).toBeGreaterThan(0);
  });

  // A phone that backgrounds the app kills the websocket a NIP-46 signer's answers come
  // back on, and the signer keeps reporting itself open. Retrying into that same dead
  // connection can only fail, so the pass tells its caller to throw the signer away.
  it('asks for a fresh connection when the signer stops answering', async () => {
    const store = await freshStore();
    await populate(store);
    const stalled = vi.fn();
    const silent: Signer = {
      type: 'nip46',
      getPublicKey: async () => SELF,
      signEvent: () => new Promise(() => {}),
      nip44Encrypt: () => new Promise(() => {}),
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine } = await harness(store, withSignerTimeout(silent, 20), stalled);

    await engine.start();

    expect(stalled).toHaveBeenCalled();
  });

  it('reports a stalled signer in words rather than naming the call that timed out', async () => {
    const store = await freshStore();
    await populate(store);
    const stalled = vi.fn();
    // The reported failure: the first call of a pass is reading the public key, so a dead
    // connection surfaced as "did not respond to getPublicKey within 45s".
    const mute: Signer = {
      type: 'nip46',
      getPublicKey: () => new Promise(() => {}),
      signEvent: () => new Promise(() => {}),
      nip44Encrypt: () => new Promise(() => {}),
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine } = await harness(store, withSignerTimeout(mute, 20), stalled);

    const status = await engine.start();

    expect(status.lastError).toBe('Your signer did not respond. Open your signer app, then tap Sync now.');
    expect(status.lastError).not.toContain('getPublicKey');
    expect(stalled).toHaveBeenCalled();
  });

  it('stops at the first unanswered record instead of waiting out every one', async () => {
    // Five records with a dead signer is five timeouts if the loop keeps going.
    const store = await freshStore();
    await populate(store);
    let attempts = 0;
    const silent: Signer = {
      type: 'nip46',
      getPublicKey: async () => SELF,
      signEvent: () => new Promise(() => {}),
      nip44Encrypt: () => { attempts += 1; return new Promise(() => {}); },
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine } = await harness(store, withSignerTimeout(silent, 20));
    await engine.start();
    expect(attempts).toBe(1);
  });

  it('goes quiet rather than failing loudly when the signer is gone', async () => {
    const store = await freshStore();
    await populate(store);
    const { engine } = await harness(store, null);

    const status = await engine.start();

    expect(status.state).toBe('error');
    expect(status.lastError).toContain('Signer connection was lost');
    expect(relay.events.size).toBe(0);
  });

  it('persists the last error so the panel can show it after a reload', async () => {
    const store = await freshStore();
    await populate(store);
    relay.failure = 'network';
    const { engine } = await harness(store);
    await engine.start();

    expect((await store.getSettings()).backup?.lastError).toContain('network failure');
  });
});

describe('turning backup off', () => {
  it('stops syncing and leaves both sides intact', async () => {
    const store = await freshStore();
    await populate(store);
    const { engine } = await harness(store);
    await engine.start();
    const uploaded = relay.events.size;

    engine.stop();
    await store.saveSheet({ name: 'After Off', exercises: [] });
    await flush();
    await flush();

    expect(engine.status().state).toBe('off');
    // Nothing deleted on the relay, and a later change is not queued behind its back.
    expect(relay.events.size).toBe(uploaded);
    expect(await store.listSyncQueue()).toHaveLength(0);
  });

  it('does not duplicate records when it is turned back on', async () => {
    const store = await freshStore();
    await populate(store);
    const { engine } = await harness(store);
    await engine.start();
    const uploaded = relay.events.size;

    engine.stop();
    await engine.start();

    expect(relay.events.size).toBe(uploaded);
  });
});
