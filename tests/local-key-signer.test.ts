// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { clearLocalKey, createCachedLocalKeySigner, createLocalAccount, hasLocalKey, importLocalAccount } from '../src/signer/local-key';
import { LEGACY_LOCAL_KEY_STORAGE } from '../src/signer/local-key-storage';

const hexOf = (nsec: string) => bytesToHex(nip19.decode(nsec).data as Uint8Array);

beforeEach(async () => {
  localStorage.clear();
  await clearLocalKey();
});

describe('device-local Nostr key signer', () => {
  it('creates a recoverable local account and caches only on this browser profile', async () => {
    const account = await createLocalAccount();
    expect(account.nsec).toMatch(/^nsec1/);
    expect(account.pubkey).toMatch(/^[0-9a-f]{64}$/);

    const cached = await createCachedLocalKeySigner();
    expect(cached?.type).toBe('local');
    expect(await cached?.getPublicKey()).toBe(account.pubkey);

    const signed = await cached!.signEvent({ kind: 1, created_at: 1, tags: [], content: 'workstr' });
    expect(signed.pubkey).toBe(account.pubkey);
    expect(verifyEvent(signed)).toBe(true);
  });

  it('imports an nsec recovery key and supports fast local NIP-44 encryption', async () => {
    const first = await createLocalAccount();
    await clearLocalKey();
    const restored = await importLocalAccount(first.nsec);
    expect(restored.pubkey).toBe(first.pubkey);

    const ciphertext = await restored.signer.nip44Encrypt(first.pubkey, 'training data');
    await expect(restored.signer.nip44Decrypt(first.pubkey, ciphertext)).resolves.toBe('training data');
  });

  it('forgets the cached private key when asked', async () => {
    await createLocalAccount();
    expect(await createCachedLocalKeySigner()).toBeTruthy();
    await clearLocalKey();
    expect(await createCachedLocalKeySigner()).toBeNull();
  });

  it('rejects a raw 64-character hex key at restore time', async () => {
    const account = await createLocalAccount();
    const hex = hexOf(account.nsec);
    await clearLocalKey();
    await expect(importLocalAccount(hex)).rejects.toThrow(/raw hex key/);
    expect(await createCachedLocalKeySigner()).toBeNull();
    const restored = await importLocalAccount(account.nsec);
    expect(restored.pubkey).toBe(account.pubkey);
  });

  // The secret used to live here in plaintext. This is the assertion that keeps it out.
  it('never writes the secret to localStorage', async () => {
    const account = await createLocalAccount();
    const hex = hexOf(account.nsec);
    for (let i = 0; i < localStorage.length; i += 1) {
      const value = localStorage.getItem(localStorage.key(i)!) || '';
      expect(value).not.toContain(hex);
      expect(value).not.toContain(account.nsec);
    }
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
  });
});

describe('migration off plaintext localStorage', () => {
  it('adopts a legacy key on first read and removes the plaintext copy', async () => {
    const account = await createLocalAccount();
    const hex = hexOf(account.nsec);
    // Reproduce a pre-migration device: plaintext in localStorage, nothing encrypted.
    await clearLocalKey();
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, hex);

    const signer = await createCachedLocalKeySigner();
    expect(await signer?.getPublicKey()).toBe(account.pubkey);
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();

    // Still there on the next load, now from the encrypted store alone.
    const again = await createCachedLocalKeySigner();
    expect(await again?.getPublicKey()).toBe(account.pubkey);
  });

  it('reports a legacy account as present before anything reads the signer', async () => {
    const account = await createLocalAccount();
    const hex = hexOf(account.nsec);
    await clearLocalKey();
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, hex);

    expect(await hasLocalKey()).toBe(true);
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
  });

  it('discards a legacy value that is not a key rather than carrying it forward', async () => {
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, 'not-a-key');
    expect(await createCachedLocalKeySigner()).toBeNull();
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
  });

  it('leaves an already-migrated account alone', async () => {
    const account = await createLocalAccount();
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
    const signer = await createCachedLocalKeySigner();
    expect(await signer?.getPublicKey()).toBe(account.pubkey);
  });
});
