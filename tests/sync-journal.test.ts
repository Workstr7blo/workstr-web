import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { compactJournal, COMPACT_THRESHOLD, pushJournal } from '../src/sync/journal';
import { logAddress } from '../src/sync/addresses';
import { testCipher, TEST_PUBKEY } from './cipher';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const relay = vi.hoisted(() => ({
  events: new Map<string, { updatedAt: string; content: string }>(),
  signatures: 0,
  failure: null as null | 'policy' | 'signer',
  seq: 0
}));

vi.mock('../src/sync/relay', async () => {
  const { encodePrivateRecord } = await import('../src/nostr/codecs30078');
  return {
    PUBLISH_TIMEOUT_MS: 10000,
    FETCH_TIMEOUT_MS: 15000,
    async publishRecord(_signer: Signer, cipher: never, _url: string, record: { address: string; updatedAt: string }) {
      if (relay.failure) return { address: record.address, accepted: false, failure: relay.failure, reason: `${relay.failure} failure` };
      const unsigned = await encodePrivateRecord(cipher, record as never);
      // One signature per published record: the number this whole design exists to keep down.
      relay.signatures += 1;
      relay.events.set(record.address, { updatedAt: record.updatedAt, content: unsigned.content });
      return { address: record.address, accepted: true, reason: 'ok', eventId: `id-${relay.seq += 1}`, createdAt: 1 };
    }
  };
});

function fakeSigner(): Signer {
  return {
    type: 'nip07',
    getPublicKey: async () => TEST_PUBKEY,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: TEST_PUBKEY, sig: 'sig' }),
    nip44Encrypt: async (_peer: string, plaintext: string) => plaintext,
    nip44Decrypt: async (_peer: string, ciphertext: string) => ciphertext
  };
}

let namespace = 0;
const DEVICE = '7f3a1b2c';

async function freshStore(): Promise<WorkstrStore> {
  const store = await WorkstrStore.open(`journal-${namespace += 1}`);
  await store.saveBackupState({ device: DEVICE });
  return store;
}

// A finished workout with enough sets to be worth compressing.
async function logWorkout(store: WorkstrStore, day: number): Promise<string> {
  const date = `2026-08-${String(day).padStart(2, '0')}`;
  const id = await store.createSession({ started_at: `${date}T10:00:00.000Z` });
  for (let set = 1; set <= 6; set += 1) {
    await store.addSessionSet({ session_id: id, exercise_slug: `barbell-lift-${set}`, set_number: set, reps: 8, weight_kg: 80 + set, completed_at: `${date}T10:0${set}:00.000Z` });
  }
  await store.finishSession(id, `${date}T11:00:00.000Z`);
  const uid = (await store.getSession(id))!.uid as string;
  await vi.waitFor(async () => expect((await store.listJournal('log')).some((row) => row.uid === uid)).toBe(true));
  return uid;
}

const push = async (store: WorkstrStore, budgetBytes?: number) =>
  pushJournal(store, fakeSigner(), await testCipher(), 'ws://memory', 'log', { budgetBytes });

beforeEach(() => {
  relay.events.clear();
  relay.signatures = 0;
  relay.failure = null;
  relay.seq = 0;
});

describe('publishing the log', () => {
  it('puts pending entries in the tail chunk and records where they went', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);

    const summary = await push(store);

    expect(summary.published).toBe(1);
    expect([...relay.events.keys()]).toEqual([logAddress(DEVICE, 0)]);
    // Every row now knows its chunk, which is what stops it being sent twice.
    expect((await store.listJournal('log')).every((row) => row.seq === 0)).toBe(true);
    expect((await store.getSettings()).backup?.logOpenSeq).toBe(0);
  });

  it('rewrites the tail as it fills, at the same address', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);
    await push(store);
    await logWorkout(store, 2);

    await push(store);

    // Still one chunk: the tail grew rather than a second address appearing.
    expect([...relay.events.keys()]).toEqual([logAddress(DEVICE, 0)]);
    expect(relay.signatures).toBe(2);
  });

  it('never signs a sealed chunk again', async () => {
    const store = await freshStore();
    // A small budget rather than a hundred workouts: what is under test is the sealing,
    // not the size the budget happens to ship at.
    const budget = 900;
    for (let day = 1; day <= 8; day += 1) await logWorkout(store, day);
    await push(store, budget);

    const addresses = [...relay.events.keys()];
    expect(addresses.length).toBeGreaterThan(1);
    const sealed = addresses.slice(0, -1);
    const sealedContent = sealed.map((address) => relay.events.get(address)!.content);

    // Another workout, then another pass: only the tail may move.
    relay.signatures = 0;
    await logWorkout(store, 9);
    await push(store, budget);

    expect(relay.signatures).toBe(1);
    // Byte-identical, which is the difference between a sealed chunk and a month bundle.
    expect(sealed.map((address) => relay.events.get(address)!.content)).toEqual(sealedContent);
  });

  it('costs nothing at all when there is nothing new', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);
    await push(store);

    relay.signatures = 0;
    const summary = await push(store);

    expect(summary).toMatchObject({ published: 0, skipped: 0 });
    expect(relay.signatures).toBe(0);
  });

  it('carries a deletion as an entry rather than by going quiet', async () => {
    const store = await freshStore();
    const uid = await logWorkout(store, 1);
    await push(store);
    const session = await store.getSessionByUid(uid);
    await store.deleteSession(session!.id as number);
    await vi.waitFor(async () => expect((await store.listJournal('log')).some((row) => row.deleted)).toBe(true));

    await push(store);

    const { decodePrivateRecord } = await import('../src/nostr/codecs30078');
    const content = relay.events.get(logAddress(DEVICE, 0))!.content;
    const decoded = await decodePrivateRecord(await testCipher(), {
      kind: 30078, content, pubkey: TEST_PUBKEY, id: 'x', sig: 's', created_at: 1,
      tags: [['d', logAddress(DEVICE, 0)], ['client', 'workstr']]
    } as never);
    const entries = (decoded!.payload as { entries: { uid: string; deleted?: boolean }[] }).entries;
    expect(entries.some((entry) => entry.uid === uid && entry.deleted)).toBe(true);
  });
});

describe('when a chunk does not land', () => {
  it('leaves the rows unassigned so the next pass sends them again', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);
    relay.failure = 'signer';

    const failed = await push(store);
    expect(failed.published).toBe(0);
    expect(failed.failed).toHaveLength(1);
    // No sequence assigned and no open sequence moved: nothing was sealed over a chunk
    // the relay never received.
    expect((await store.listJournal('log')).every((row) => row.seq === null)).toBe(true);
    expect((await store.getSettings()).backup?.logOpenSeq).toBeUndefined();

    relay.failure = null;
    const retried = await push(store);
    expect(retried.published).toBe(1);
    expect([...relay.events.keys()]).toEqual([logAddress(DEVICE, 0)]);
  });

  it('reports a policy rejection separately, because retrying cannot fix it', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);
    relay.failure = 'policy';

    const summary = await push(store);

    expect(summary.rejected).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
  });
});

describe('compacting a sealed chunk', () => {
  // Seeds a journal directly: what compaction reads is this device's own record of what it
  // put in each chunk, so no relay round trip is needed to decide what is dead.
  async function journalled(store: WorkstrStore, rows: { uid: string; updatedAt: string; seq: number | null }[]): Promise<void> {
    for (const row of rows) {
      await store.noteJournal('log', row.uid, row.updatedAt);
      const pending = (await store.listJournal('log')).filter((entry) => entry.seq === null);
      if (row.seq !== null) await store.assignJournalSeq(pending.map((entry) => entry.id as number), row.seq);
    }
  }

  const compact = async (store: WorkstrStore) =>
    compactJournal(store, fakeSigner(), await testCipher(), 'ws://memory', 'log');

  it('rewrites one that later entries have mostly replaced', async () => {
    const store = await freshStore();
    await store.saveBackupState({ logOpenSeq: 2 });
    await journalled(store, [
      { uid: 'a', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'b', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'a', updatedAt: '2026-09-01T10:00:00.000Z', seq: 1 },
      { uid: 'b', updatedAt: '2026-09-01T10:00:00.000Z', seq: 1 }
    ]);

    const summary = await compact(store);

    expect(summary).toMatchObject({ rewritten: 1, reclaimed: 2 });
    expect(relay.events.has(logAddress(DEVICE, 0))).toBe(true);
  });

  it('leaves a chunk alone while most of it is still live', async () => {
    const store = await freshStore();
    await store.saveBackupState({ logOpenSeq: 2 });
    await journalled(store, [
      { uid: 'a', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'b', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'c', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'a', updatedAt: '2026-09-01T10:00:00.000Z', seq: 1 }
    ]);

    const summary = await compact(store);

    expect(1 / 3).toBeLessThan(COMPACT_THRESHOLD);
    expect(summary.rewritten).toBe(0);
    expect(relay.signatures).toBe(0);
  });

  it('never touches the tail, which is still being appended to', async () => {
    const store = await freshStore();
    await store.saveBackupState({ logOpenSeq: 1 });
    await journalled(store, [
      { uid: 'a', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      { uid: 'b', updatedAt: '2026-08-01T10:00:00.000Z', seq: 0 },
      // Everything in the tail supersedes the sealed chunk, and the tail is still off limits.
      { uid: 'a', updatedAt: '2026-09-01T10:00:00.000Z', seq: 1 },
      { uid: 'b', updatedAt: '2026-09-01T10:00:00.000Z', seq: 1 }
    ]);

    await compact(store);

    expect(relay.events.has(logAddress(DEVICE, 0))).toBe(true);
    expect(relay.events.has(logAddress(DEVICE, 1))).toBe(false);
  });

  it('does nothing on a device that has published no sealed chunk yet', async () => {
    const store = await freshStore();
    await logWorkout(store, 1);
    await push(store);

    expect(await compact(store)).toMatchObject({ rewritten: 0, reclaimed: 0 });
  });
});
