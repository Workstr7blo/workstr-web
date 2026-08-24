import { describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { classifyPublish } from '../src/sync/relay';
import { pushQueue } from '../src/sync/push';
import { testCipher } from './cipher';
import { SETTINGS_ADDRESS, sheetAddress } from '../src/sync/addresses';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);
let namespace = 0;
const freshStore = () => WorkstrStore.open(`push-${namespace += 1}`);

function fakeSigner(): Signer {
  return {
    type: 'nip07', getPublicKey: async () => SELF,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_p: string, plaintext: string) => `enc:${plaintext.length}`,
    nip44Decrypt: async () => '{}'
  };
}

async function queuedSheet(store: WorkstrStore, name: string): Promise<string> {
  await store.saveSheet({ name, exercises: [] });
  const address = sheetAddress(name.toLowerCase().replaceAll(' ', '-'));
  await store.enqueueSync(address, '2026-08-20T10:00:00.000Z');
  return address;
}

describe('publish classification', () => {
  it('separates a policy rejection from a network failure', () => {
    expect(classifyPublish({ status: 'rejected', reason: new Error('blocked: only Workstr records') }))
      .toEqual({ accepted: false, failure: 'policy', reason: expect.stringContaining('blocked:') });
    expect(classifyPublish({ status: 'fulfilled', value: 'connection failure: ECONNREFUSED' }))
      .toEqual({ accepted: false, failure: 'network', reason: expect.stringContaining('connection failure') });
    expect(classifyPublish({ status: 'rejected', reason: new Error('relay publish timed out') }))
      .toMatchObject({ accepted: false, failure: 'network' });
    expect(classifyPublish({ status: 'fulfilled', value: '' })).toMatchObject({ accepted: true });
  });
});

describe('push queue', () => {
  it('clears an entry only after relay acknowledgement', async () => {
    const store = await freshStore();
    const address = await queuedSheet(store, 'Push Day');
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValueOnce({ address, accepted: false, failure: 'network', reason: 'offline' });
    expect((await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test')).uploaded).toBe(0);
    expect(await store.listSyncQueue()).toHaveLength(1);
    publish.mockResolvedValueOnce({ address, accepted: true, reason: 'ok' });
    expect((await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test')).uploaded).toBe(1);
    expect(await store.listSyncQueue()).toHaveLength(0);
    publish.mockRestore();
  });

  it('keeps a policy-rejected record queued', async () => {
    const store = await freshStore();
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-20T10:00:00.000Z');
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValue({ address: SETTINGS_ADDRESS, accepted: false, failure: 'policy', reason: 'blocked: nope' });
    const summary = await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test');
    expect(summary.rejected).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
    expect(await store.listSyncQueue()).toHaveLength(1);
    publish.mockRestore();
  });

  it('publishes a tombstone when a queued object is gone', async () => {
    const store = await freshStore();
    const address = sheetAddress('gone');
    await store.enqueueSync(address, '2026-08-20T10:00:00.000Z');
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _c, _r, record) => {
      expect(record).toMatchObject({ address, deleted: true });
      return { address, accepted: true, reason: 'ok' };
    });
    expect((await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test')).uploaded).toBe(1);
    expect(await store.listSyncQueue()).toHaveLength(0);
    publish.mockRestore();
  });

  it('rebuilds a silent signer connection and retries the same record', async () => {
    const store = await freshStore();
    const address = await queuedSheet(store, 'Push Day');
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord')
      .mockResolvedValueOnce({ address, accepted: false, failure: 'signer', reason: 'silent' })
      .mockResolvedValueOnce({ address, accepted: true, reason: 'ok' });
    const renewSigner = vi.fn(async () => fakeSigner());
    const summary = await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test', { renewSigner });
    expect(summary.uploaded).toBe(1);
    expect(renewSigner).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledTimes(2);
    publish.mockRestore();
  });

  it('stops after a signer remains silent and leaves later records queued', async () => {
    const store = await freshStore();
    await queuedSheet(store, 'One');
    await queuedSheet(store, 'Two');
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord')
      .mockImplementation(async (_s, _c, _r, record) => ({ address: record.address, accepted: false, failure: 'signer', reason: 'silent' }));
    const summary = await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test');
    expect(summary.attempted).toBe(2);
    expect(summary.failed).toHaveLength(1);
    expect(summary.remaining).toBe(2);
    expect(publish).toHaveBeenCalledOnce();
    publish.mockRestore();
  });

  it('reports progress and skips an unchanged acknowledged object', async () => {
    const store = await freshStore();
    const first = await queuedSheet(store, 'One');
    await queuedSheet(store, 'Two');
    const firstUpdatedAt = (await store.listSheets()).find((sheet) => sheet.slug === 'one')!.updated_at;
    await store.noteSeen(first, 'event-1', 1, firstUpdatedAt);
    const relay = await import('../src/sync/relay');
    const sent: string[] = [];
    const publish = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _c, _r, record) => {
      sent.push(record.address);
      return { address: record.address, accepted: true, reason: 'ok' };
    });
    const progress: string[] = [];
    const summary = await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test', {
      onProgress: (done, total) => progress.push(`${done}/${total}`)
    });
    expect(summary.uploaded).toBe(2);
    expect(sent).not.toContain(first);
    expect(progress).toContain('2/2');
    publish.mockRestore();
  });

  it('bounds a pass so a long backfill cannot block the UI', async () => {
    const store = await freshStore();
    for (const name of ['A', 'B', 'C', 'D']) await queuedSheet(store, name);
    const relay = await import('../src/sync/relay');
    const publish = vi.spyOn(relay, 'publishRecord')
      .mockImplementation(async (_s, _c, _r, record) => ({ address: record.address, accepted: true, reason: 'ok' }));
    const summary = await pushQueue(store, fakeSigner(), await testCipher(), 'ws://relay.test', { limit: 2 });
    expect(summary).toMatchObject({ attempted: 2, uploaded: 2, remaining: 2 });
    publish.mockRestore();
  });
});
