// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createDeviceVault, type DeviceVault } from '../src/security/device-vault';
import { DeviceVaultError } from '../src/security/device-vault-types';
import { createCachedLocalKeySigner, hasLegacyLocalKey, hasLocalKey, migrateLegacyLocalKey, NOSTR_LOCAL_KEY_SCOPE } from '../src/signer/local-key';
import { clearLocalSecret, LEGACY_LOCAL_KEY_STORAGE, loadLocalSecret, saveLocalSecret } from '../src/signer/local-key-storage';

const PIN = '135792468';
let counter = 0;

async function unlockedVault(): Promise<DeviceVault> {
  counter += 1;
  const vault = createDeviceVault({ databaseName: `local-key-migration-${counter}` });
  await vault.create(PIN);
  return vault;
}

function key() {
  const secret = generateSecretKey();
  return { hex: bytesToHex(secret), pubkey: getPublicKey(secret) };
}

beforeEach(async () => {
  localStorage.clear();
  await clearLocalSecret();
});

describe('existing local-key migration', () => {
  it('moves the current encrypted record into the vault and then deletes it', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const vault = await unlockedVault();

    expect(await migrateLegacyLocalKey(account.pubkey, vault)).toBe(account.pubkey);
    expect(await loadLocalSecret()).toBeNull();
    expect(await vault.getSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(account.hex);
    expect(await (await createCachedLocalKeySigner(vault))?.getPublicKey()).toBe(account.pubkey);
  });

  it('refuses a key that is not the signed-in account, and keeps it', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const vault = await unlockedVault();

    await expect(migrateLegacyLocalKey(key().pubkey, vault)).rejects.toMatchObject({ code: 'migration-failed' });
    expect(await loadLocalSecret()).toBe(account.hex);
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(false);
  });

  it('keeps the old record when the vault write fails', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const real = await unlockedVault();
    const failing: DeviceVault = { ...real, putSecret: async () => { throw new DeviceVaultError('encryption-failed'); } };

    await expect(migrateLegacyLocalKey(account.pubkey, failing)).rejects.toMatchObject({ code: 'migration-failed' });
    expect(await loadLocalSecret()).toBe(account.hex);
  });

  it('keeps the old record when the vault copy does not verify', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const real = await unlockedVault();
    const wrongReadBack: DeviceVault = { ...real, getSecret: async () => key().hex };

    await expect(migrateLegacyLocalKey(account.pubkey, wrongReadBack)).rejects.toMatchObject({ code: 'migration-failed' });
    expect(await loadLocalSecret()).toBe(account.hex);
    // The unverified copy is not left behind looking like an account.
    expect(await real.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(false);
  });

  it('deletes the old record only after the vault copy has been read back', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const real = await unlockedVault();
    const legacyAtVerification: (string | null)[] = [];
    const observed: DeviceVault = {
      ...real,
      getSecret: async (scope) => {
        legacyAtVerification.push(await loadLocalSecret());
        return real.getSecret(scope);
      }
    };

    await migrateLegacyLocalKey(account.pubkey, observed);
    expect(legacyAtVerification.length).toBeGreaterThan(0);
    expect(legacyAtVerification.every((value) => value === account.hex)).toBe(true);
    expect(await loadLocalSecret()).toBeNull();
  });

  it('finishes a migration interrupted after the vault write', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const vault = await unlockedVault();
    await vault.putSecret(NOSTR_LOCAL_KEY_SCOPE, account.hex);

    expect(await migrateLegacyLocalKey(account.pubkey, vault)).toBe(account.pubkey);
    expect(await loadLocalSecret()).toBeNull();
    expect(await vault.getSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(account.hex);
  });

  it('does not delete an old key the vault disagrees with', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const vault = await unlockedVault();
    await vault.putSecret(NOSTR_LOCAL_KEY_SCOPE, key().hex);

    await expect(migrateLegacyLocalKey(null, vault)).rejects.toMatchObject({ code: 'migration-failed' });
    expect(await loadLocalSecret()).toBe(account.hex);
  });

  it('needs an unlocked vault and touches nothing without one', async () => {
    const account = key();
    await saveLocalSecret(account.hex);
    const vault = await unlockedVault();
    vault.lock();

    await expect(migrateLegacyLocalKey(account.pubkey, vault)).rejects.toMatchObject({ code: 'locked' });
    expect(await loadLocalSecret()).toBe(account.hex);
  });

  it('still carries a plaintext localStorage key through the older migration first', async () => {
    const account = key();
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, account.hex);

    expect(await hasLegacyLocalKey()).toBe(true);
    expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull();
    const vault = await unlockedVault();
    expect(await hasLocalKey(vault)).toBe(true);
    expect(await migrateLegacyLocalKey(account.pubkey, vault)).toBe(account.pubkey);
    expect(await hasLegacyLocalKey()).toBe(false);
    expect(await hasLocalKey(vault)).toBe(true);
  });
});
