import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import {
  clearNwcConnection,
  getNwcConnection,
  hasActiveNwcConnection,
  loadNwcConnection,
  NwcSecureStorageError,
  saveNwcConnection
} from '../src/nostr/nwc-storage';
import { syncedSettings } from '../src/sync/records';

const WALLET_PUBKEY = 'c'.repeat(64);
const SECRET = 'd'.repeat(64);
const VALID = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;

let counter = 0;
const freshStore = () => WorkstrStore.open(`nwc-${counter += 1}`);
const freshNamespace = () => `nwc-secure-${counter += 1}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NWC connection storage', () => {
  it('round-trips a valid connection through secure storage', async () => {
    const namespace = freshNamespace();
    const saved = await saveNwcConnection(namespace, VALID);
    expect(saved.connection.walletPubkey).toBe(WALLET_PUBKEY);
    expect(saved.metadata.walletPubkey).toBe(WALLET_PUBKEY);
    expect(saved.metadata.relays).toEqual(['wss://relay.example.com']);
    expect(JSON.stringify(saved.metadata)).not.toContain(SECRET);
    const loaded = await loadNwcConnection(namespace);
    expect(loaded?.connection.secret).toBe(SECRET);
    expect(await getNwcConnection(namespace)).toMatchObject({ walletPubkey: WALLET_PUBKEY, secret: SECRET });
    expect(await hasActiveNwcConnection(namespace)).toBe(true);
  });

  it('rejects an invalid string before anything is stored', async () => {
    const namespace = freshNamespace();
    await expect(saveNwcConnection(namespace, 'user@wallet.com')).rejects.toThrowError();
    expect(await getNwcConnection(namespace)).toBeNull();
  });

  it('clearNwcConnection removes the stored string', async () => {
    const namespace = freshNamespace();
    await saveNwcConnection(namespace, VALID);
    await clearNwcConnection(namespace);
    expect(await getNwcConnection(namespace)).toBeNull();
    expect(await hasActiveNwcConnection(namespace)).toBe(false);
  });

  it('survives reopening the normal app database without using settings', async () => {
    const namespace = freshNamespace();
    await saveNwcConnection(namespace, VALID);
    const first = await WorkstrStore.open(namespace);
    expect(await first.getSettings()).not.toHaveProperty('nwc');
    first.close();
    const reopened = await WorkstrStore.open(namespace);
    expect(await getNwcConnection(namespace)).toMatchObject({ walletPubkey: WALLET_PUBKEY, secret: SECRET });
    expect(await reopened.getSettings()).not.toHaveProperty('nwc');
    reopened.close();
  });

  it('is excluded from normal settings and the synced settings payload', async () => {
    const store = await freshStore();
    await saveNwcConnection(`secure-${counter}`, VALID);
    expect(await store.getSettings()).not.toHaveProperty('nwc');
    const synced = syncedSettings(await store.getSettings());
    expect(JSON.stringify(synced)).not.toContain(SECRET);
    expect(JSON.stringify(synced)).not.toContain('nwc');
    store.close();
  });

  it('surfaces unavailable secure storage as a typed storage error without secrets', async () => {
    const original = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    await expect(saveNwcConnection(freshNamespace(), VALID)).rejects.toMatchObject({
      name: 'NwcSecureStorageError',
      code: 'unavailable'
    });
    try {
      await saveNwcConnection(freshNamespace(), VALID);
    } catch (error) {
      expect(error).toBeInstanceOf(NwcSecureStorageError);
      expect(String(error)).not.toContain(SECRET);
      expect(String(error)).not.toContain(VALID);
    } finally {
      vi.stubGlobal('indexedDB', original);
    }
  });
});
