// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createDeviceVault, type DeviceVault } from '../src/security/device-vault';
import {
  clearLocalKey,
  createCachedLocalKeySigner,
  exportLocalNsec,
  generateLocalAccount,
  hasLocalKey,
  NOSTR_LOCAL_KEY_SCOPE,
  parseRecoveryKey,
  saveLocalAccount
} from '../src/signer/local-key';
import { clearLocalSecret, hasLocalSecret } from '../src/signer/local-key-storage';

const PIN = '000123456';
const hexOf = (nsec: string) => bytesToHex(nip19.decode(nsec).data as Uint8Array);
let counter = 0;

function vaultPair(): { databaseName: string; vault: DeviceVault } {
  counter += 1;
  const databaseName = `local-key-signer-${counter}`;
  return { databaseName, vault: createDeviceVault({ databaseName }) };
}

beforeEach(async () => {
  localStorage.clear();
  await clearLocalSecret();
});

describe('device-local Nostr key signer', () => {
  it('generates an account in memory without persisting anything', async () => {
    const { vault } = vaultPair();
    const account = generateLocalAccount();
    expect(account.nsec).toMatch(/^nsec1/);
    expect(account.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(await vault.exists()).toBe(false);
    expect(await hasLocalSecret()).toBe(false);
    expect(await hasLocalKey(vault)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('validates a recovery key without persisting it, and refuses raw hex', async () => {
    const account = generateLocalAccount();
    expect(parseRecoveryKey(`  ${account.nsec} `)).toEqual(account);
    expect(() => parseRecoveryKey(hexOf(account.nsec))).toThrow(/raw hex key/);
    expect(() => parseRecoveryKey('nonsense')).toThrow();
    expect(await hasLocalSecret()).toBe(false);
  });

  it('cannot store a key until the vault is unlocked', async () => {
    const { vault } = vaultPair();
    await vault.create(PIN);
    vault.lock();
    await expect(saveLocalAccount(generateLocalAccount(), vault)).rejects.toMatchObject({ code: 'locked' });
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(false);
  });

  it('rebuilds the same signer after a reload and an unlock', async () => {
    const { databaseName, vault } = vaultPair();
    const account = generateLocalAccount();
    await vault.create(PIN);
    const signer = await saveLocalAccount(account, vault);
    expect(await signer.getPublicKey()).toBe(account.pubkey);

    const reloaded = createDeviceVault({ databaseName });
    expect(await hasLocalKey(reloaded)).toBe(true);
    // Locked: there is a key, and nothing can sign with it.
    expect(await createCachedLocalKeySigner(reloaded)).toBeNull();
    await expect(exportLocalNsec(reloaded)).rejects.toMatchObject({ code: 'locked' });

    await reloaded.unlock(PIN);
    const cached = await createCachedLocalKeySigner(reloaded);
    expect(await cached?.getPublicKey()).toBe(account.pubkey);
    const signed = await cached!.signEvent({ kind: 1, created_at: 1, tags: [], content: 'workstr' });
    expect(signed.pubkey).toBe(account.pubkey);
    expect(verifyEvent(signed)).toBe(true);
    expect(await exportLocalNsec(reloaded)).toBe(account.nsec);
  });

  it('supports local NIP-44 encryption for sync', async () => {
    const { vault } = vaultPair();
    const account = generateLocalAccount();
    await vault.create(PIN);
    const signer = await saveLocalAccount(account, vault);
    const ciphertext = await signer.nip44Encrypt(account.pubkey, 'training data');
    await expect(signer.nip44Decrypt(account.pubkey, ciphertext)).resolves.toBe('training data');
  });

  it('refuses an account whose key does not match its public key', async () => {
    const { vault } = vaultPair();
    await vault.create(PIN);
    const mismatched = { nsec: generateLocalAccount().nsec, pubkey: generateLocalAccount().pubkey };
    await expect(saveLocalAccount(mismatched, vault)).rejects.toMatchObject({ code: 'encryption-failed' });
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(false);
  });

  it('signing out removes only the Nostr scope', async () => {
    const { vault } = vaultPair();
    await vault.create(PIN);
    await saveLocalAccount(generateLocalAccount(), vault);
    await vault.putSecret('monero.hot-wallet', 'kept');

    await clearLocalKey(vault);
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(false);
    expect(await vault.exists()).toBe(true);
    expect(await vault.getSecret('monero.hot-wallet')).toBe('kept');
  });

  it('removes a vault that no longer protects anything', async () => {
    const { vault } = vaultPair();
    await vault.create(PIN);
    await saveLocalAccount(generateLocalAccount(), vault);
    await clearLocalKey(vault);
    expect(await vault.exists()).toBe(false);
    expect(await createCachedLocalKeySigner(vault)).toBeNull();
  });

  it('has nothing to export for an account held by an external signer', async () => {
    const { vault } = vaultPair();
    expect(await exportLocalNsec(vault)).toBeNull();
  });

  it('never writes the secret to localStorage', async () => {
    const { vault } = vaultPair();
    const account = generateLocalAccount();
    await vault.create(PIN);
    await saveLocalAccount(account, vault);
    const hex = hexOf(account.nsec);
    for (let i = 0; i < localStorage.length; i += 1) {
      const value = localStorage.getItem(localStorage.key(i)!) || '';
      expect(value).not.toContain(hex);
      expect(value).not.toContain(account.nsec);
      expect(value).not.toContain(PIN);
    }
  });
});
