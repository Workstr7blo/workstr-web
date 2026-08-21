// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { WorkstrStore } from '../src/db/store';
import { decodePrivateRecord } from '../src/nostr/codecs30078';
import { fetchRecords, publishRecord } from '../src/sync/relay';
import { pushQueue } from '../src/sync/push';
import { runBackfill, seedJournal } from '../src/sync/backfill';
import { pushJournal } from '../src/sync/journal';
import { pullAndMerge } from '../src/sync/merge';
import { SETTINGS_ADDRESS, newDeviceId, sheetAddress } from '../src/sync/addresses';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

// Opt-in: a real strfry carrying the write policy. Started with the compose stack in
// relay/README.md. Unset in CI, where these are skipped rather than faked — a mocked
// relay cannot prove the policy or NIP-44 interop, which is the only reason to run them.
const RELAY = process.env.WORKSTR_TEST_RELAY;
const suite = RELAY ? describe : describe.skip;

// Real NIP-44 with a real key, so ciphertext on the wire is genuinely ciphertext.
function keySigner(secret = generateSecretKey()): Signer {
  const pubkey = getPublicKey(secret);
  return {
    type: 'nip07',
    getPublicKey: async () => pubkey,
    signEvent: async (event: UnsignedNostrEvent) => finalizeEvent({ ...event, pubkey } as never, secret) as never,
    nip44Encrypt: async (peer: string, plaintext: string) => nip44.encrypt(plaintext, nip44.getConversationKey(secret, peer)),
    nip44Decrypt: async (peer: string, ciphertext: string) => nip44.decrypt(ciphertext, nip44.getConversationKey(secret, peer))
  };
}

// A real backup key, so what goes over the wire is exactly what the app publishes.
async function liveCipher(pubkey: string) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, pubkey };
}

let namespace = 0;
const freshStore = () => WorkstrStore.open(`relay-int-${namespace += 1}`);

suite('against a real strfry running the write policy', () => {
  it('round-trips an encrypted record through the relay', async () => {
    const signer = keySigner();
    const cipher = await liveCipher(await signer.getPublicKey());
    const outcome = await publishRecord(signer, cipher, RELAY!, {
      address: SETTINGS_ADDRESS,
      updatedAt: '2026-08-20T10:00:00.000Z',
      payload: { unit: 'lbs', ownedEquipment: ['barbell'] }
    });
    expect(outcome).toMatchObject({ accepted: true });

    const events = await fetchRecords(RELAY!, await signer.getPublicKey());
    expect(events.length).toBeGreaterThan(0);
    // The payload must be unreadable to anyone reading the open relay.
    expect(events[0].content).not.toContain('barbell');
    const decoded = await decodePrivateRecord<{ unit: string }>(cipher, events[0]);
    expect(decoded?.payload).toEqual({ unit: 'lbs', ownedEquipment: ['barbell'] });
  }, 30000);

  it('another pubkey cannot read what it fetches', async () => {
    const owner = keySigner();
    const ownerCipher = await liveCipher(await owner.getPublicKey());
    await publishRecord(owner, ownerCipher, RELAY!, { address: SETTINGS_ADDRESS, updatedAt: '2026-08-20T10:00:00.000Z', payload: { unit: 'kg' } });
    const events = await fetchRecords(RELAY!, await owner.getPublicKey());
    // Reads are open by design, so the stranger gets the bytes. They stay opaque.
    const stranger = keySigner();
    expect(await decodePrivateRecord(await liveCipher(await stranger.getPublicKey()), events[0])).toBeNull();
  }, 30000);

  it('pushes a whole backfilled database and empties the queue', async () => {
    const store = await freshStore();
    const signer = keySigner();
    await store.saveSheet({ name: 'Push Day', exercises: [{ exercise_slug: 'bench', position: 0, sets: 3 }] });
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    await store.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    await store.logBody({ date: '2026-08-01', weight_kg: 80 });

    const { total } = await runBackfill(store);
    const summary = await pushQueue(store, signer, await liveCipher(await signer.getPublicKey()), RELAY!);
    expect(summary.uploaded).toBe(total);
    expect(summary.rejected).toHaveLength(0);
    expect(summary.failed).toHaveLength(0);
    expect(await store.listSyncQueue()).toHaveLength(0);

    const events = await fetchRecords(RELAY!, await signer.getPublicKey());
    const addresses = events.map((event) => event.tags.find((tag) => tag[0] === 'd')?.[1]);
    expect(addresses).toContain(sheetAddress('push-day'));
    expect(addresses.every((address) => String(address).startsWith('workstr:v2:'))).toBe(true);
  }, 60000);

  it('is refused when it publishes something the policy rejects', async () => {
    const secret = generateSecretKey();
    const signer = keySigner(secret);
    // Bypasses the codec guard on purpose: this asserts the *relay* refuses it, not us.
    const event = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello' } as never, secret);
    const { SimplePool } = await import('nostr-tools');
    const pool = new SimplePool();
    const results = await Promise.allSettled(pool.publish([RELAY!], event));
    pool.close([RELAY!]);
    expect(results[0].status).toBe('rejected');
    expect(String((results[0] as PromiseRejectedResult).reason?.message)).toContain('blocked:');
    expect(await signer.getPublicKey()).toHaveLength(64);
  }, 30000);

  it('restores a device from nothing: phone -> relay -> laptop', async () => {
    // One identity, two databases. The second is a laptop that has never seen this data.
    const secret = generateSecretKey();
    const phone = await freshStore();
    const laptop = await freshStore();
    const signer = keySigner(secret);

    await phone.saveSheet({ name: 'Push Day', exercises: [{ exercise_slug: 'bench', position: 0, sets: 3, reps: '8' }] });
    const sessionId = await phone.createSession({ started_at: '2026-08-01T10:00:00.000Z', sheet_name: 'Push Day' });
    await phone.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 1, reps: 8, weight_kg: 60, completed_at: '2026-08-01T10:05:00.000Z' });
    await phone.finishSession(sessionId, '2026-08-01T11:00:00.000Z');
    await phone.logBody({ date: '2026-08-01', weight_kg: 80 });
    await phone.saveSettings({ ...(await phone.getSettings()), unit: 'lbs', ownedEquipment: ['barbell'] });
    const uid = (await phone.getSession(sessionId))!.uid!;

    const shared = await liveCipher(await signer.getPublicKey());
    await phone.saveBackupState({ device: newDeviceId() });
    // Programs and settings travel by address; workout history and the body log travel as
    // chunks of the append-only log, so a real restore needs both halves published.
    await runBackfill(phone);
    await seedJournal(phone);
    expect((await pushQueue(phone, signer, shared, RELAY!)).failed).toHaveLength(0);
    expect((await pushJournal(phone, signer, shared, RELAY!, 'log')).failed).toHaveLength(0);
    expect((await pushJournal(phone, signer, shared, RELAY!, 'body')).failed).toHaveLength(0);

    expect(await laptop.listSheets()).toHaveLength(0);
    // The laptop opens what the phone sealed because both hold the account's backup key.
    const merged = await pullAndMerge(laptop, signer, shared, RELAY!);
    expect(merged.applied).toBeGreaterThanOrEqual(4);

    const sheets = await laptop.listSheets();
    expect(sheets.map((sheet) => sheet.name)).toContain('Push Day');
    expect(sheets.find((sheet) => sheet.slug === 'push-day')!.exercises[0].exercise_slug).toBe('bench');
    const restored = await laptop.getSessionByUid(uid);
    expect(restored?.finished_at).toBe('2026-08-01T11:00:00.000Z');
    const sets = await laptop.listSessionSets(restored!.id!);
    expect(sets).toHaveLength(1);
    expect(sets[0].weight_kg).toBe(60);
    expect((await laptop.listBody()).map((entry) => entry.weight_kg)).toEqual([80]);
    expect((await laptop.getSettings()).unit).toBe('lbs');
  }, 90000);

  it('uploads what was logged offline once the relay is reachable again', async () => {
    const signer = keySigner();
    const store = await freshStore();
    store.setChangeListener((address, updatedAt) => { void store.enqueueSync(address, updatedAt); });

    // Offline: a dead relay address, so the publish genuinely fails.
    await store.saveSheet({ name: 'Logged Offline', exercises: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cipher = await liveCipher(await signer.getPublicKey());
    const offline = await pushQueue(store, signer, cipher, 'ws://127.0.0.1:9');
    expect(offline.uploaded).toBe(0);
    expect(offline.failed.length).toBeGreaterThan(0);
    // The work is still queued: local logging never depends on the relay.
    expect((await store.listSyncQueue()).length).toBeGreaterThan(0);
    expect((await store.listSheets())[0].name).toBe('Logged Offline');

    const online = await pushQueue(store, signer, cipher, RELAY!);
    expect(online.uploaded).toBeGreaterThan(0);
    expect(await store.listSyncQueue()).toHaveLength(0);
  }, 60000);
});
