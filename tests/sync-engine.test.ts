import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { createSyncEngine, RECORD_FORMAT, type SyncStatus } from '../src/sync/engine';
import { RETRY_BASE_MS, STALL_RETRY_MS } from '../src/sync/retry';
import { SETTINGS_ADDRESS, sessionAddress, sheetAddress } from '../src/sync/addresses';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import { withSignerTimeout } from '../src/signer/timeout';
import { forgetAutoApprove } from '../src/signer/auto-approve';
import { decodePrivateRecord, type PrivateRecord, type RecordCipher } from '../src/nostr/codecs30078';

const SELF = 'ab'.repeat(32);

// An in-memory relay behind the real transport module, so the engine drives the actual
// backfill, push, codec and merge code. Only the socket is fake.
const relay = vi.hoisted(() => ({
  events: new Map<string, { event: unknown }>(),
  // The wrapped backup key, held apart from the records because it is not one: it is
  // NIP-44 to the user's own pubkey and is resolved before a pass can start.
  keyEvent: null as null | { content: string },
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
    async publishRecord(signer: Signer, cipher: RecordCipher, _url: string, record: PrivateRecord) {
      if (relay.failure) return { address: record.address, accepted: false, failure: relay.failure, reason: `${relay.failure} failure` };
      try {
        // Signing still goes through the signer, which is what lets these tests keep
        // exercising a signer that stalls partway through an upload.
        await signer.signEvent({ kind: 30078, created_at: 0, tags: [['d', record.address]], content: '' });
        const unsigned = await encodePrivateRecord(cipher, record);
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
    },
    async fetchKeyEvent() {
      if (relay.failure === 'network') throw new Error('relay query timed out');
      return relay.keyEvent
        ? { ...relay.keyEvent, id: 'key-event', pubkey: SELF, sig: 'sig', kind: 30078, created_at: 1, tags: [['d', 'workstr:v2:key']] }
        : null;
    },
    async publishKeyEvent(_signer: Signer, _url: string, content: string) {
      if (relay.failure) return { accepted: false, reason: `${relay.failure} failure` };
      relay.keyEvent = { content };
      return { accepted: true, reason: 'ok' };
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

// A backup key already cached on the device. Most of these tests are about syncing, not
// about bootstrapping the key, and a device that has synced before has one.
const CACHED_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));

async function cipherOf(store: WorkstrStore): Promise<RecordCipher> {
  const raw = (await store.getSettings()).backup?.key as string;
  const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  return { key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']), pubkey: SELF };
}

function fakeSignerWith(overrides: Partial<Signer>): Signer {
  return { ...fakeSigner(), ...overrides };
}

let namespace = 0;
const freshStore = async (): Promise<WorkstrStore> => {
  const store = await WorkstrStore.open(`engine-${namespace += 1}`);
  await store.saveBackupState({ key: CACHED_KEY });
  return store;
};
// For the bootstrap tests below, which are about a device that has no key yet.
const keylessStore = () => WorkstrStore.open(`engine-keyless-${namespace += 1}`);
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

async function harness(store: WorkstrStore, signer: Signer | null = fakeSigner(), onSignerStalled?: () => void, onRestored?: () => void) {
  const state: Harness = { store, statuses: [], timers: [] };
  const engine = createSyncEngine({
    store,
    relayUrl: 'ws://memory',
    getSigner: async () => signer,
    onStatus: (status) => state.statuses.push({ ...status }),
    onSignerStalled,
    onRestored,
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
  relay.keyEvent = null;
  relay.failure = null;
  relay.seq = 0;
  // Remembered across page loads in the browser, and so across tests here.
  forgetAutoApprove();
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
    // Sheet and settings by address, plus a workout-log chunk and a body-log chunk.
    // No manifest: nothing ever read it.
    expect(relay.events.size).toBe(4);
    expect([...relay.events.keys()].filter((address) => address.includes(':log:'))).toHaveLength(1);
    expect([...relay.events.keys()].filter((address) => address.includes(':body:'))).toHaveLength(1);
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
    expect(backup?.backfillTotal).toBe(2);
  });

  it('resumes an interrupted first run instead of restarting it', async () => {
    const store = await freshStore();
    await populate(store);
    // A previous run got one record in before it was cut off.
    await store.saveBackupState({ recordFormat: RECORD_FORMAT, backfillCursor: 1, backfillTotal: 2 });
    const { engine } = await harness(store);

    await engine.start();

    // Only the tail was enqueued; what already went is not re-sent. The log chunks are
    // published from the journal rather than the queue, so they are here regardless.
    expect([...relay.events.keys()].filter((address) => !address.includes(':log:') && !address.includes(':body:'))).toHaveLength(1);
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
    const settings = relay.events.get(SETTINGS_ADDRESS)!;
    relay.events.set(SETTINGS_ADDRESS, { event: { ...(settings.event as Record<string, unknown>), id: 'from-another-device' } });

    // Opening a record is local, so the signer no longer measures anything here. What the
    // ledger must still prove is that only the changed record was read again.
    const opens = vi.spyOn(crypto.subtle, 'decrypt');
    const second = await harness(store, signer);
    await second.engine.start();

    expect(opens).toHaveBeenCalledTimes(1);
    opens.mockRestore();
    void decrypt;
  });
});

describe('a device from the old local-only era', () => {
  it('drops the queue entries it can no longer publish instead of wedging on them', async () => {
    const store = await freshStore();
    // What the previous client left behind when its last pass did not drain. This client
    // cannot resolve a v1 address, so it would publish a tombstone the relay refuses and
    // report an error on every pass from then on.
    await store.enqueueSync('workstr:v1:sessions:2026-08', '2026-08-01T10:05:00.000Z');
    await store.enqueueSync('workstr:v1:session:9f1c', '2026-08-01T10:05:00.000Z');

    const { engine } = await harness(store);
    const status = await engine.start();

    expect(status.state).toBe('idle');
    expect(status.lastError).toBeUndefined();
    expect((await store.listSyncQueue()).map((entry) => entry.address)).not.toContain('workstr:v1:sessions:2026-08');
    expect([...relay.events.keys()].some((address) => address.startsWith('workstr:v1:'))).toBe(false);
  });


  it('does not migrate local-only history into V2 relay backup', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z', backup_version: 1 });
    const uid = (await store.getSession(id))!.uid as string;
    await store.addSessionSet({ session_id: id, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    await store.saveBackupState({ enabled: true, backfillCursor: 0, backfillTotal: undefined });

    const { engine } = await harness(store);
    await engine.start();

    expect([...relay.events.keys()].some((address) => address.includes(':sessions:'))).toBe(false);
    expect([...relay.events.keys()]).not.toContain(sessionAddress(uid));
    expect((await store.getSettings()).backup?.recordFormat).toBe(RECORD_FORMAT);
  });

  it('drops per-workout addresses left by the previous format', async () => {
    const store = await freshStore();
    await populate(store);
    const [session] = await store.listSessions();
    // A device on the previous format queued history by address. Sending those would write
    // workout history to the very addresses the log replaces.
    await store.enqueueSync(sessionAddress(session.uid as string), '2026-08-02T11:00:00.000Z');

    const { engine } = await harness(store);
    await engine.start();

    expect([...relay.events.keys()]).not.toContain(sessionAddress(session.uid as string));
    expect(await store.listSyncQueue()).toHaveLength(0);
    // The session is not lost: seeding puts it into the log, which is what gets published.
    expect([...relay.events.keys()].some((address) => address.startsWith('workstr:v2:log:'))).toBe(true);
  });

  it('carries a deletion into the log, because absence cannot express one', async () => {
    const store = await freshStore();
    await populate(store);
    const [session] = await store.listSessions();
    const { engine } = await harness(store);
    await engine.start();

    await store.deleteSession(session.id as number);
    await vi.waitFor(async () => expect((await store.listJournal('log')).some((row) => row.deleted)).toBe(true));
    await engine.syncNow();

    const chunk = [...relay.events.keys()].find((address) => address.startsWith('workstr:v2:log:'))!;
    const decoded = await decodePrivateRecord(await cipherOf(store), relay.events.get(chunk)!.event as never);
    const entries = (decoded!.payload as { entries: { uid: string; deleted?: boolean }[] }).entries;
    expect(entries.find((entry) => entry.uid === session.uid)?.deleted).toBe(true);
  });
});

describe('staying in sync', () => {
  it('queues a local change and syncs it on the next scheduled pass', async () => {
    const store = await freshStore();
    const { engine, state } = await harness(store);
    await engine.start();
    relay.events.clear();
    relay.keyEvent = null;

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

  // Restoring into the database is not the whole job. What the screen draws is read when
  // the namespace opens, so a device that signs in and pulls its whole history showed
  // nothing at all and looked as though the restore had not happened — it had, and only
  // reloading the page revealed it.
  it('tells the app to re-read what it is showing after a restore', async () => {
    const phone = await freshStore();
    await populate(phone);
    await (await harness(phone)).engine.start();

    const laptop = await freshStore();
    const restored = vi.fn();
    const second = await harness(laptop, fakeSigner(), undefined, restored);
    await second.engine.start();

    expect(restored).toHaveBeenCalled();
    expect(await laptop.listSheets()).not.toHaveLength(0);
  });

  it('does not announce a restore when the relay had nothing new', async () => {
    const laptop = await freshStore();
    const restored = vi.fn();
    const { engine } = await harness(laptop, fakeSigner(), undefined, restored);
    await engine.start();

    expect(restored).not.toHaveBeenCalled();
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
    // And it schedules a retry rather than sitting there — quickly, because rebuilding
    // the connection is the whole fix and waiting out a backoff first only shows the user
    // an error they cannot act on.
    expect(state.timers.at(-1)?.delayMs).toBe(STALL_RETRY_MS);
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

  it('rebuilds a stalled connection within seconds rather than waiting out a backoff', async () => {
    // The desktop complaint: the pass spends its whole budget finding out the signer went
    // quiet, and then a full backoff on top before the retry that fixes it — long enough
    // that the only sane move looks like pressing Sync now.
    const store = await freshStore();
    await populate(store);
    const silent: Signer = {
      type: 'nip46',
      getPublicKey: async () => SELF,
      signEvent: () => new Promise(() => {}),
      nip44Encrypt: () => new Promise(() => {}),
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine, state } = await harness(store, withSignerTimeout(silent, 20), vi.fn());

    const first = await engine.start();
    // Not something to hand the user a job over while the retry is four seconds away.
    expect(first.reconnecting).toBe(true);
    expect(state.timers.at(-1)?.delayMs).toBe(STALL_RETRY_MS);

    state.timers.at(-1)!.run();
    await until(() => engine.status().state !== 'syncing', 'the quick retry to finish');

    // It did not work, so the signer is genuinely away: say so and back off from the top
    // of the normal curve rather than skipping a rung because the first wait was short.
    expect(engine.status().reconnecting).toBeFalsy();
    expect(engine.status().lastError).toContain('did not respond');
    expect(state.timers.at(-1)?.delayMs).toBe(RETRY_BASE_MS);
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
    // Every queued record with a dead signer is one timeout each if the loop keeps going.
    const store = await freshStore();
    await populate(store);
    let attempts = 0;
    const silent: Signer = {
      type: 'nip46',
      // Sealing is local, so the signature is the only thing left that can hang.
      signEvent: () => { attempts += 1; return new Promise(() => {}); },
      getPublicKey: async () => SELF,
      nip44Encrypt: () => new Promise(() => {}),
      nip44Decrypt: () => new Promise(() => {})
    };
    const { engine } = await harness(store, withSignerTimeout(silent, 20));
    await engine.start();

    // Silence is usually a lost answer rather than an absent user, so one record is retried
    // a few times inside a single budget and the connection is rebuilt once. What matters
    // is that it then stops: a signer that is genuinely away must not cost a fresh budget
    // for every record in the queue.
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThan(12);
    expect((await store.listSyncQueue()).length).toBeGreaterThan(0);
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

describe('a device bootstrapping its backup key', () => {
  it('mints and publishes one when the relay has none, then seals records with it', async () => {
    const store = await keylessStore();
    await populate(store);
    const { engine } = await harness(store);

    const status = await engine.start();

    expect(status.state).toBe('idle');
    expect(relay.keyEvent).not.toBeNull();
    // Cached, so the next launch costs the signer nothing to read the backup.
    expect((await store.getSettings()).backup?.key).toBeTruthy();
    expect(relay.events.size).toBeGreaterThan(0);
  });

  it('adopts the key already on the relay instead of starting a second one', async () => {
    const store = await keylessStore();
    // Another device got there first. The NIP-44 double is an identity function, so the
    // wrapped key is readable here exactly as the signer would return it.
    const existing = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));
    relay.keyEvent = { content: existing };

    const { engine } = await harness(store);
    await engine.start();

    expect((await store.getSettings()).backup?.key).toBe(existing);
  });

  it('stops rather than inventing a key when the relay cannot be asked', async () => {
    const store = await keylessStore();
    await populate(store);
    relay.failure = 'network';

    const { engine } = await harness(store);
    const status = await engine.start();

    expect(status.state).toBe('error');
    expect(status.lastError).toContain('backup key');
    // The one outcome that must never happen: a second key, written over data that was
    // sealed with the first, on a device that simply could not reach the relay.
    expect(relay.keyEvent).toBeNull();
    expect(relay.events.size).toBe(0);
  });

  it('does not ask the signer again once the key is cached', async () => {
    const store = await freshStore();
    await populate(store);
    const decrypt = vi.fn(async (_peer: string, ciphertext: string) => ciphertext);
    await (await harness(store, fakeSignerWith({ nip44Decrypt: decrypt }))).engine.start();

    expect(decrypt).not.toHaveBeenCalled();
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
