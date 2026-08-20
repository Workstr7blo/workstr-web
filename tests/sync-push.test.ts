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

  // The reported flow: one record goes through, the next one's encrypt is met with
  // silence, and the pass gives up — so a month of eight records took eight presses of
  // Sync now. A closed socket is the ordinary reason for that silence, and the cure is to
  // rebuild the connection and carry on rather than to hand the work back to the user.
  it('rebuilds the connection mid-pass instead of giving up on the month', async () => {
    const store = await freshStore();
    for (const slug of ['a', 'b', 'c', 'd']) await store.enqueueSync(sheetAddress(slug), '2026-08-20T10:00:00.000Z');
    for (const slug of ['a', 'b', 'c', 'd']) await store.saveSheet({ name: slug, exercises: [] });

    const relay = await import('../src/sync/relay');
    let sent = 0;
    // Every other record meets a dead socket, the way a relay that closes between
    // requests does.
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => {
      sent += 1;
      return sent % 2 === 0
        ? { address: record.address, accepted: false, failure: 'signer', reason: 'Signer did not respond' }
        : { address: record.address, accepted: true, reason: 'ok', eventId: `id-${sent}`, createdAt: sent };
    });

    let renewals = 0;
    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test', {
      renewSigner: async () => { renewals += 1; return fakeSigner(); }
    });

    // Everything queued goes up in one pass, and the queue is empty afterwards.
    expect(summary.uploaded).toBe(4);
    expect(await store.listSyncQueue()).toHaveLength(0);
    expect(renewals).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('gives up on a signer that is gone rather than rebuilding forever', async () => {
    const store = await freshStore();
    for (const slug of ['a', 'b', 'c', 'd']) await store.enqueueSync(sheetAddress(slug), '2026-08-20T10:00:00.000Z');
    for (const slug of ['a', 'b', 'c', 'd']) await store.saveSheet({ name: slug, exercises: [] });

    const relay = await import('../src/sync/relay');
    let attempts = 0;
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => {
      attempts += 1;
      return { address: record.address, accepted: false, failure: 'signer', reason: 'Signer did not respond' };
    });

    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test', { renewSigner: async () => fakeSigner() });

    expect(summary.uploaded).toBe(0);
    // One rebuild and one retry on the first record, then it stops rather than paying a
    // timeout for every record in the queue.
    expect(attempts).toBe(2);
    expect(await store.listSyncQueue()).toHaveLength(4);
    spy.mockRestore();
  });

  // "Sync now" said syncing with no count beside it for minutes. Progress was reported
  // between queue entries, so a month that is eight records reported nothing at all until
  // the whole month was done — indistinguishable from a hang, on exactly the months that
  // take longest.
  it('counts progress in records, so a long month visibly moves', async () => {
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
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => (
      { address: record.address, accepted: true, reason: 'ok', eventId: 'id', createdAt: 1 }
    ));

    const seen: string[] = [];
    await pushQueue(store, fakeSigner(), 'ws://relay.test', { onProgress: (done, total) => seen.push(`${done}/${total}`) });

    // One queued month, several records: the count has to move within it, not jump from
    // nothing straight to done.
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0]).toMatch(/^0\//);
    const [done, total] = seen[seen.length - 1].split('/').map(Number);
    expect(done).toBe(total);
    expect(total).toBeGreaterThan(3);
    spy.mockRestore();
  }, 30000);

  // A month of real training is several parts, each costing two signer round trips, so a
  // pass that runs out of time or loses its connection partway is normal. Without this the
  // month restarted from part one every time: the parts that had already landed were sent
  // again, the later ones were never reached, and the same two addresses went to the
  // signer over and over while the month never finished.
  it('does not send a part that is already on the relay unchanged', async () => {
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
    const sent: string[] = [];
    // Fails from the third part on, the way a screen lock or a lost connection does.
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => {
      sent.push(record.address);
      return sent.length > 2
        ? { address: record.address, accepted: false, failure: 'network', reason: 'offline' }
        : { address: record.address, accepted: true, reason: 'ok', eventId: `id-${sent.length}`, createdAt: sent.length };
    });

    await pushQueue(store, fakeSigner(), 'ws://relay.test');
    const firstPass = [...sent];
    expect(firstPass.length).toBeGreaterThan(2);
    expect(await store.listSyncQueue()).toHaveLength(1);

    sent.length = 0;
    await pushQueue(store, fakeSigner(), 'ws://relay.test');

    // The two that landed are not sent again, so the retry starts where it stopped.
    expect(sent).not.toContain(firstPass[0]);
    expect(sent).not.toContain(firstPass[1]);
    expect(sent[0]).toBe(firstPass[2]);
    spy.mockRestore();
  }, 30000);

  // A month that outgrew one event and later shrank back leaves its extra part on the
  // relay. Nothing overwrites it, so it has to be tombstoned or a restore reads sessions
  // out of it that this device has deleted.
  it('tombstones a part the month no longer fills', async () => {
    const store = await freshStore();
    await store.createSession({ started_at: '2026-08-05T10:00:00.000Z', sheet_name: 'Push Day' });
    // What a bigger version of this month published last time.
    await store.noteSeen(sessionsAddress('2026-08'), 'id-1', 1);
    await store.noteSeen(sessionsAddress('2026-08', 2), 'id-2', 1);
    await store.noteSeen(sessionsAddress('2026-07', 2), 'id-3', 1);
    await store.enqueueSync(sessionsAddress('2026-08'), '2026-08-05T10:05:00.000Z');

    const relay = await import('../src/sync/relay');
    const published: { address: string; deleted?: boolean }[] = [];
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => {
      published.push({ address: record.address, deleted: record.deleted });
      return { address: record.address, accepted: true, reason: 'ok', eventId: 'id', createdAt: 2 };
    });

    const summary = await pushQueue(store, fakeSigner(), 'ws://relay.test');

    expect(summary.uploaded).toBe(1);
    // July's spare part is none of August's business: only the month being published is
    // ever tombstoned, so a queue entry cannot reach into a month it does not name.
    expect(published).toEqual([
      { address: sessionsAddress('2026-08'), deleted: undefined },
      { address: sessionsAddress('2026-08', 2), deleted: true }
    ]);
    spy.mockRestore();
  });

  it('tombstones every part of a month whose sessions are all gone', async () => {
    const store = await freshStore();
    await store.noteSeen(sessionsAddress('2026-08'), 'id-1', 1);
    await store.noteSeen(sessionsAddress('2026-08', 2), 'id-2', 1);
    await store.enqueueSync(sessionsAddress('2026-08'), '2026-08-09T10:00:00.000Z');

    const relay = await import('../src/sync/relay');
    const published: { address: string; deleted?: boolean }[] = [];
    const spy = vi.spyOn(relay, 'publishRecord').mockImplementation(async (_s, _r, record) => {
      published.push({ address: record.address, deleted: record.deleted });
      return { address: record.address, accepted: true, reason: 'ok', eventId: 'id', createdAt: 2 };
    });

    await pushQueue(store, fakeSigner(), 'ws://relay.test');

    expect(published).toEqual([
      { address: sessionsAddress('2026-08'), deleted: true },
      { address: sessionsAddress('2026-08', 2), deleted: true }
    ]);
    expect(await store.listSyncQueue()).toHaveLength(0);
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
