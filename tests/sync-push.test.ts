import { describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { classifyPublish } from '../src/sync/relay';
import { pushQueue } from '../src/sync/push';
import { SETTINGS_ADDRESS, sessionsAddress, sheetAddress } from '../src/sync/addresses';
import { MAX_BUNDLE_BYTES } from '../src/sync/records';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);
let namespace = 0;
const freshStore = () => WorkstrStore.open(`push-${namespace += 1}`);

function fakeSigner(): Signer {
  return {
    type: 'nip07',
    getPublicKey: async () => SELF,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_p: string, plaintext: string) => `enc:${plaintext.length}`,
    nip44Decrypt: async () => '{}'
  };
}

describe('publish classification', () => {
  it('separates a policy rejection from a network failure', () => {
    // strfry's plugin writes this message; it will never succeed unchanged.
    expect(classifyPublish({ status: 'rejected', reason: new Error('blocked: this relay only stores Workstr encrypted backup records (kind 30078)') }))
      .toEqual({ accepted: false, failure: 'policy', reason: expect.stringContaining('blocked:') });
    // nostr-tools resolves an unreachable relay instead of rejecting it.
    expect(classifyPublish({ status: 'fulfilled', value: 'connection failure: ECONNREFUSED' }))
      .toEqual({ accepted: false, failure: 'network', reason: expect.stringContaining('connection failure') });
    expect(classifyPublish({ status: 'rejected', reason: new Error('relay publish timed out') }))
      .toMatchObject({ accepted: false, failure: 'network' });
    expect(classifyPublish({ status: 'fulfilled', value: '' })).toMatchObject({ accepted: true });
  });
});

describe('push queue', () => {
  it('clears an entry only once the relay acknowledges it', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Push Day', exercises: [] });
    await store.enqueueSync(sheetAddress('push-day'), '2026-08-20T10:00:00.000Z');

    const relay = await import('../src/sync/relay');
    const spy = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValueOnce({ address: sheetAddress('push-day'), accepted: false, failure: 'network', reason: 'offline' });
    const offline = await pushQueue(store, fakeSigner(), 'ws://relay.test');
    expect(offline.uploaded).toBe(0);
    expect(offline.failed).toHaveLength(1);
    expect(await store.listSyncQueue()).toHaveLength(1);

    spy.mockResolvedValueOnce({ address: sheetAddress('push-day'), accepted: true, reason: 'ok' });
    const online = await pushQueue(store, fakeSigner(), 'ws://relay.test');
    expect(online.uploaded).toBe(1);
    expect(await store.listSyncQueue()).toHaveLength(0);
    spy.mockRestore();
  });

  it('keeps a policy-rejected record in the queue instead of losing it', async () => {
    const store = await freshStore();
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-20T10:00:00.000Z');
    const relay = await import('../src/sync/relay');
    const spy = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValue({ address: SETTINGS_ADDRESS, accepted: false, failure: 'policy', reason: 'blocked: nope' });
    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test');
    expect(summary.rejected).toHaveLength(1);
    expect(summary.uploaded).toBe(0);
    // A backup feature may never silently drop a record, even one the relay refuses.
    expect(await store.listSyncQueue()).toHaveLength(1);
    spy.mockRestore();
  });

  it('publishes a tombstone for an address whose record is gone', async () => {
    const store = await freshStore();
    const sheetId = await store.saveSheet({ name: 'Push Day', exercises: [] });
    await store.deleteSheet(sheetId);
    await store.enqueueSync(sheetAddress('push-day'), '2026-08-20T12:00:00.000Z');
    const relay = await import('../src/sync/relay');
    const spy = vi.spyOn(relay, 'publishRecord').mockResolvedValue({ address: sheetAddress('push-day'), accepted: true, reason: 'ok' });
    await pushQueue(store, fakeSigner(), 'ws://relay.test');
    expect(spy.mock.calls[0][2]).toMatchObject({ address: sheetAddress('push-day'), deleted: true });
    expect(spy.mock.calls[0][2].payload).toBeUndefined();
    spy.mockRestore();
  });

  it('publishes every part of a month that outgrew one event, under one queue entry', async () => {
    const store = await freshStore();
    // Enough training in one month that it cannot travel as a single record.
    for (let day = 1; day <= 24; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      const id = await store.createSession({ started_at: `${date}T10:00:00.000Z`, sheet_name: 'Upper Body Hypertrophy Block A' });
      for (let n = 1; n <= 24; n += 1) {
        await store.addSessionSet({
          session_id: id, exercise_slug: 'barbell-bench-press-medium-grip', set_number: n,
          reps: 8, weight_kg: 82.5, completed_at: `${date}T10:${String(n).padStart(2, '0')}:00.000Z`
        });
      }
    }
    await store.enqueueSync(sessionsAddress('2026-08'), '2026-08-24T10:24:00.000Z');

    const relay = await import('../src/sync/relay');
    const published: { address: string; bytes: number }[] = [];
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_signer, _url, record) => {
      published.push({ address: record.address, bytes: JSON.stringify(record.payload ?? {}).length });
      return { address: record.address, accepted: true, reason: 'ok', eventId: `id-${record.address}`, createdAt: 1 };
    });

    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test');

    expect(published.length).toBeGreaterThan(1);
    expect(published[0].address).toBe(sessionsAddress('2026-08'));
    expect(published[1].address).toBe(sessionsAddress('2026-08', 2));
    for (const record of published) expect(record.bytes).toBeLessThan(MAX_BUNDLE_BYTES * 1.2);
    // One entry in, one entry out: the parts are an upload detail, not queue entries.
    expect(summary.uploaded).toBe(1);
    expect(await store.listSyncQueue()).toHaveLength(0);
    // Each part is recorded on its own address, so the next pull recognises all of them.
    expect((await store.listSeen()).map((entry) => entry.address).sort()).toEqual(published.map((record) => record.address).sort());
    spy.mockRestore();
  }, 30000);

  it('keeps a month queued when one of its parts does not land', async () => {
    const store = await freshStore();
    for (let day = 1; day <= 24; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      const id = await store.createSession({ started_at: `${date}T10:00:00.000Z`, sheet_name: 'Upper Body Hypertrophy Block A' });
      for (let n = 1; n <= 24; n += 1) {
        await store.addSessionSet({
          session_id: id, exercise_slug: 'barbell-bench-press-medium-grip', set_number: n,
          reps: 8, weight_kg: 82.5, completed_at: `${date}T10:${String(n).padStart(2, '0')}:00.000Z`
        });
      }
    }
    await store.enqueueSync(sessionsAddress('2026-08'), '2026-08-24T10:24:00.000Z');

    const relay = await import('../src/sync/relay');
    const spy = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValueOnce({ address: sessionsAddress('2026-08'), accepted: true, reason: 'ok', eventId: 'id-1', createdAt: 1 })
      .mockResolvedValueOnce({ address: sessionsAddress('2026-08', 2), accepted: false, failure: 'network', reason: 'offline' });

    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test');

    expect(summary.uploaded).toBe(0);
    // A half-uploaded month is retried whole rather than left with nothing recording it.
    expect(await store.listSyncQueue()).toHaveLength(1);
    spy.mockRestore();
  }, 30000);

  it('bounds a pass so a long backfill cannot block the UI', async () => {
    const store = await freshStore();
    for (const slug of ['a', 'b', 'c', 'd']) await store.enqueueSync(sheetAddress(slug), '2026-08-20T10:00:00.000Z');
    const relay = await import('../src/sync/relay');
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => ({ address: record.address, accepted: true, reason: 'ok' }));
    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test', { limit: 2 });
    expect(summary.attempted).toBe(2);
    expect(summary.uploaded).toBe(2);
    expect(summary.remaining).toBe(2);
    spy.mockRestore();
  });
});
