import { describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { classifyPublish } from '../src/sync/relay';
import { pushQueue } from '../src/sync/push';
import { SETTINGS_ADDRESS, sheetAddress } from '../src/sync/addresses';
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
