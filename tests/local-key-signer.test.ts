// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { clearLocalKey, createCachedLocalKeySigner, createLocalAccount, importLocalAccount } from '../src/signer/local-key';

beforeEach(() => {
  localStorage.clear();
});

describe('device-local Nostr key signer', () => {
  it('creates a recoverable local account and caches only on this browser profile', async () => {
    const account = createLocalAccount();
    expect(account.nsec).toMatch(/^nsec1/);
    expect(account.pubkey).toMatch(/^[0-9a-f]{64}$/);

    const cached = createCachedLocalKeySigner();
    expect(cached?.type).toBe('local');
    expect(await cached?.getPublicKey()).toBe(account.pubkey);

    const signed = await cached!.signEvent({ kind: 1, created_at: 1, tags: [], content: 'workstr' });
    expect(signed.pubkey).toBe(account.pubkey);
    expect(verifyEvent(signed)).toBe(true);
  });

  it('imports an nsec recovery key and supports fast local NIP-44 encryption', async () => {
    const first = createLocalAccount();
    clearLocalKey();
    const restored = importLocalAccount(first.nsec);
    expect(restored.pubkey).toBe(first.pubkey);

    const ciphertext = await restored.signer.nip44Encrypt(first.pubkey, 'training data');
    await expect(restored.signer.nip44Decrypt(first.pubkey, ciphertext)).resolves.toBe('training data');
  });

  it('forgets the cached private key when asked', () => {
    createLocalAccount();
    expect(createCachedLocalKeySigner()).toBeTruthy();
    clearLocalKey();
    expect(createCachedLocalKeySigner()).toBeNull();
  });

  it('rejects a raw 64-character hex key at restore time', () => {
    const account = createLocalAccount();
    const hex = localStorage.getItem('workstr.localNsec.hex')!;
    clearLocalKey();
    expect(() => importLocalAccount(hex)).toThrow(/raw hex key/);
    expect(createCachedLocalKeySigner()).toBeNull();
    const restored = importLocalAccount(account.nsec);
    expect(restored.pubkey).toBe(account.pubkey);
  });
});
