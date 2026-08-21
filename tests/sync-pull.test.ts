import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { PULL_OVERLAP_SEC, pullAndMerge, pullRecords } from '../src/sync/merge';
import { SETTINGS_ADDRESS, sheetAddress } from '../src/sync/addresses';
import { buildPrivateRecordEvent, encodePrivateRecord } from '../src/nostr/codecs30078';
import { testCipher } from './cipher';
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
  const unsigned = await encodePrivateRecord(await testCipher(), { address, updatedAt: '2026-08-01T10:00:00.000Z', payload });
  return { ...buildPrivateRecordEvent(address, unsigned.content, createdAt), id: eventId, pubkey: SELF, sig: 'sig' };
}

let signer: Signer;
// Opening a record is local now, so what counts a record read is the AES unwrap, not a
// call to the signer. The ledger's whole job is to keep this number down.
let opens: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  relay.events = [];
  relay.since = undefined;
  signer = fakeSigner();
  opens = vi.spyOn(crypto.subtle, 'decrypt');
});

afterEach(() => {
  opens.mockRestore();
});

describe('reading the relay a second time', () => {
  it('never opens an event it has already read', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    relay.events = [await event(signer, SETTINGS_ADDRESS, 'settings-1', 2_000_000, { unit: 'lbs' })];
    opens.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer, await testCipher());

    expect(records).toHaveLength(0);
    expect(opens).not.toHaveBeenCalled();
  });

  it('asks the relay only for what could be new', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    await pullRecords(store, 'ws://memory', signer, await testCipher());
    expect(relay.since).toBe(2_000_000 - PULL_OVERLAP_SEC);
  });

  it('asks for everything when it has read nothing yet', async () => {
    const store = await freshStore();
    await pullRecords(store, 'ws://memory', signer, await testCipher());
    expect(relay.since).toBeUndefined();
  });

  it('opens a newer event at an address it already knows', async () => {
    const store = await freshStore();
    await store.noteSeen(SETTINGS_ADDRESS, 'settings-1', 2_000_000);
    relay.events = [await event(signer, SETTINGS_ADDRESS, 'settings-2', 2_000_500, { unit: 'kg' })];
    opens.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer, await testCipher());

    expect(records).toHaveLength(1);
    expect(opens).toHaveBeenCalledTimes(1);
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

    await expect(pullAndMerge(store, signer, await testCipher(), 'ws://memory', {
      onProgress: (done) => { if (done === 2) throw new Error('page closed'); }
    })).rejects.toThrow('page closed');

    expect((await store.listSeen()).map((entry) => entry.address).sort()).toEqual([sheetAddress('a'), sheetAddress('b')].sort());
    expect(await store.listSheets()).toHaveLength(2);
  });
});

describe('obsolete V1 relay records', () => {
  it('ignores old V1 records without decrypting them', async () => {
    const store = await freshStore();
    relay.events = [{
      ...buildPrivateRecordEvent('workstr:v1:session:legacy', '{}', 2_000_000),
      id: 'legacy-1', pubkey: SELF, sig: 'sig'
    }];
    opens.mockClear();

    const { records } = await pullRecords(store, 'ws://memory', signer, await testCipher());

    expect(records).toHaveLength(0);
    expect(opens).not.toHaveBeenCalled();
  });
});
