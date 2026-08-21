import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { PULL_OVERLAP_SEC, pullAndMerge, pullRecords } from '../src/sync/merge';
import { SETTINGS_ADDRESS, sessionAddress, sessionsAddress, sheetAddress } from '../src/sync/addresses';
import { buildPrivateRecordEvent, encodePrivateRecord } from '../src/nostr/codecs30078';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);

const relay = vi.hoisted(() => ({ events: [] as unknown[], since: undefined as number | undefined }));

vi.mock('../src/sync/relay', () => ({
  async fetchRecords(_url: string, _pubkey: string, _pool: unknown, _own: boolean, since?: number) {
    relay.since = since;
    return relay.events;
  }
}));

// The "ciphertext" is the plaintext, so a decrypt is observable without real keys — which
// is the whole point here: these tests count signer round trips, not bytes.
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
const freshStore = () => WorkstrStore.open(`pull-${namespace += 1}`);

async function event(signer: Signer, address: string, eventId: string, createdAt: number, payload: unknown): Promise<SignedNostrEvent> {
  const unsigned = await encodePrivateRecord(signer, { address, updatedAt: '2026-08-01T10:00:00.000Z', payload });
  return { ...buildPrivateRecordEvent(address, unsigned.content, createdAt), id: eventId, pubkey: SELF, sig: 'sig' };
}

let signer: Signer;
let decrypt: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  relay.events = [];
  relay.since = undefined;
  signer = fakeSigner();
  decrypt = vi.spyOn(signer, 'nip44Decrypt');
});

describe('reading the relay a second time', () => {
  it('never decrypts an event it has already read', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    relay.events = [await event(signer, SETTINGS_ADDRESS, 'settings-1', 2_000_000, { unit: 'lbs' })];
    decrypt.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer);

    expect(records).toHaveLength(0);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('asks the relay only for what could be new', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    await pullRecords(store, 'ws://memory', signer);
    expect(relay.since).toBe(2_000_000 - PULL_OVERLAP_SEC);
  });

  it('asks for everything when it has read nothing yet', async () => {
    const store = await freshStore();
    await pullRecords(store, 'ws://memory', signer);
    expect(relay.since).toBeUndefined();
  });

  it('decrypts a newer event at an address it already knows', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    relay.events = [await event(signer, SETTINGS_ADDRESS, 'settings-2', 2_000_500, { unit: 'kg' })];
    decrypt.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer);

    expect(records).toHaveLength(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});

describe('interrupted restore progress', () => {
  it('records each restored event as seen before moving to the next signer prompt', async () => {
    const store = await freshStore();
    relay.events = [
      await event(signer, sheetAddress('a'), 'sheet-a', 2_000_001, { name: 'A', slug: 'a', exercises: [] }),
      await event(signer, sheetAddress('b'), 'sheet-b', 2_000_002, { name: 'B', slug: 'b', exercises: [] }),
      await event(signer, sheetAddress('c'), 'sheet-c', 2_000_003, { name: 'C', slug: 'c', exercises: [] })
    ];

    await expect(pullAndMerge(store, signer, 'ws://memory', {
      onProgress: (done) => { if (done === 2) throw new Error('page closed'); }
    })).rejects.toThrow('page closed');

    expect((await store.listSeen()).map((entry) => entry.address).sort()).toEqual([sheetAddress('a'), sheetAddress('b')].sort());
    expect(await store.listSheets()).toHaveLength(2);
  });
});

describe('per-session records written by an earlier version', () => {
  it('retires one the month bundle has superseded, without decrypting it', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    const uid = (await store.getSession(id))!.uid as string;
    // The bundle for that session's month was published after the per-session record, so
    // it carries the same session in newer form and the old event has nothing to add.
    await store.noteSeen(sessionsAddress('2026-08'), 'bundle-1', 2_000_500);
    relay.events = [await event(signer, sessionAddress(uid), 'legacy-1', 2_000_000, { started_at: '2026-08-01T10:00:00.000Z' })];
    decrypt.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer);

    expect(records).toHaveLength(0);
    expect(decrypt).not.toHaveBeenCalled();
    // Recorded as read, so it never costs anything again either.
    expect(await store.listSeen()).toContainEqual({ address: sessionAddress(uid), event_id: 'legacy-1', created_at: 2_000_000 });
  });

  it('still reads one for a session this device does not hold', async () => {
    const store = await freshStore();
    await store.noteSeen(sessionsAddress('2026-08'), 'bundle-1', 2_000_500);
    relay.events = [await event(signer, sessionAddress('uid-from-another-device'), 'legacy-1', 2_000_000, { started_at: '2026-08-01T10:00:00.000Z' })];
    decrypt.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer);

    expect(records).toHaveLength(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('still reads one the bundle predates, because the old record is the newer of the two', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    const uid = (await store.getSession(id))!.uid as string;
    await store.noteSeen(sessionsAddress('2026-08'), 'bundle-1', 2_000_000);
    relay.events = [await event(signer, sessionAddress(uid), 'legacy-1', 2_000_500, { started_at: '2026-08-01T10:00:00.000Z' })];
    decrypt.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer);

    expect(records).toHaveLength(1);
  });
});
