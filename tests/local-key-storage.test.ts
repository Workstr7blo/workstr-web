// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLocalSecret,
  hasLocalSecret,
  LEGACY_LOCAL_KEY_STORAGE,
  loadLocalSecret,
  LocalKeyStorageError,
  migrateLegacyLocalSecret,
  saveLocalSecret
} from '../src/signer/local-key-storage';

const SECRET = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

beforeEach(async () => {
  localStorage.clear();
  await clearLocalSecret();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local key secure storage', () => {
  it('round-trips a secret through the encrypted store', async () => {
    await saveLocalSecret(SECRET);
    expect(await loadLocalSecret()).toBe(SECRET);
    expect(await hasLocalSecret()).toBe(true);
  });

  it('reports nothing stored before a first save', async () => {
    expect(await loadLocalSecret()).toBeNull();
    expect(await hasLocalSecret()).toBe(false);
  });

  it('replaces the stored secret rather than accumulating', async () => {
    await saveLocalSecret(SECRET);
    await saveLocalSecret(OTHER);
    expect(await loadLocalSecret()).toBe(OTHER);
  });

  it('survives a reload, which is the whole point of persisting it', async () => {
    await saveLocalSecret(SECRET);
    // A page load gets a fresh module holding no state; the non-extractable wrapping key
    // has to come back from IndexedDB for the ciphertext to be readable at all.
    vi.resetModules();
    const reloaded = await import('../src/signer/local-key-storage');
    expect(await reloaded.loadLocalSecret()).toBe(SECRET);
  });

  it('clears both the ciphertext and the wrapping key', async () => {
    await saveLocalSecret(SECRET);
    await clearLocalSecret();
    expect(await loadLocalSecret()).toBeNull();
    expect(await hasLocalSecret()).toBe(false);
  });

  it('stores ciphertext, not the secret', async () => {
    await saveLocalSecret(SECRET);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('workstr-secure-local-key-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = db.transaction('secrets').objectStore('secrets').get('active');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(JSON.stringify(record)).not.toContain(SECRET);
    expect(record.nonce).toBeTruthy();
    expect(record.ciphertext).toBeTruthy();
  });

  it('reports a corrupt record instead of pretending no account exists', async () => {
    // Silently returning null would strand someone on a sign-in screen with their key
    // present but unreadable, and no indication of which of the two had happened.
    await saveLocalSecret(SECRET);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('workstr-secure-local-key-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction('secrets', 'readwrite').objectStore('secrets');
      const request = store.put({ id: 'active', version: 1, nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'bm90LWNpcGhlcnRleHQ=', savedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();

    await expect(loadLocalSecret()).rejects.toThrow(LocalKeyStorageError);
    await expect(loadLocalSecret()).rejects.toMatchObject({ code: 'corrupt_record' });
  });

  it('says storage is unavailable rather than failing obscurely', async () => {
    vi.stubGlobal('indexedDB', undefined);
    // 'unavailable' rather than a generic write/read failure: the caller can tell a
    // browser that cannot do this at all from a store that is present but broken.
    await expect(saveLocalSecret(SECRET)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(loadLocalSecret()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('legacy migration', () => {
  it('moves a plaintext key into the encrypted store and deletes the original', async () => {
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, SECRET);
    expect(await migrateLegacyLocalSecret()).toBe(true);
    expect(await loadLocalSecret()).toBe(SECRET);
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
  });

  it('normalises an uppercase legacy value', async () => {
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, SECRET.toUpperCase());
    expect(await migrateLegacyLocalSecret()).toBe(true);
    expect(await loadLocalSecret()).toBe(SECRET);
  });

  it('does nothing when there is no legacy value', async () => {
    expect(await migrateLegacyLocalSecret()).toBe(false);
    expect(await loadLocalSecret()).toBeNull();
  });

  it('discards a legacy value that is not a 64-character hex key', async () => {
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, 'nonsense');
    expect(await migrateLegacyLocalSecret()).toBe(false);
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
    expect(await loadLocalSecret()).toBeNull();
  });

  it('does not overwrite an encrypted secret when no legacy value remains', async () => {
    await saveLocalSecret(SECRET);
    expect(await migrateLegacyLocalSecret()).toBe(false);
    expect(await loadLocalSecret()).toBe(SECRET);
  });

  it('leaves the plaintext in place if the encrypted write fails', async () => {
    // Removing the original first and then failing to save would destroy the account.
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, SECRET);
    vi.stubGlobal('indexedDB', undefined);
    await expect(migrateLegacyLocalSecret()).rejects.toMatchObject({ code: 'unavailable' });
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBe(SECRET);
  });
});
