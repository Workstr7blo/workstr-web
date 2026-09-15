import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { createDeviceVault } from '../src/security/device-vault';
import { importRootKey, openSecret, randomBytes, sealSecret } from '../src/security/device-vault-crypto';
import { isDevicePin, joinDevicePinGroups, normalizeDevicePin } from '../src/security/device-pin';
import { DeviceVaultError } from '../src/security/device-vault-types';

const PIN = '024681357';
const OTHER_PIN = '975318642';
const SECRET = 'ab'.repeat(32);
const NOSTR = 'nostr.local-key';
const OTHER_SCOPE = 'monero.hot-wallet';

let counter = 0;
function freshVault() {
  counter += 1;
  const databaseName = `device-vault-test-${counter}`;
  return { databaseName, vault: createDeviceVault({ databaseName }) };
}

// Everything the vault wrote, as one string, so assertions can ask whether a value appears
// anywhere in storage rather than in one field someone thought to check.
async function dump(databaseName: string): Promise<string> {
  const db = await openDB(databaseName, 1);
  try {
    return JSON.stringify({ metadata: await db.getAll('metadata'), secrets: await db.getAll('secrets') });
  } finally {
    db.close();
  }
}

async function rewrite(databaseName: string, store: 'metadata' | 'secrets', edit: (records: Record<string, unknown>[]) => Record<string, unknown>[]): Promise<void> {
  const db = await openDB(databaseName, 1);
  try {
    const records = edit(await db.getAll(store) as Record<string, unknown>[]);
    await db.clear(store);
    for (const record of records) await db.put(store, record);
  } finally {
    db.close();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('device code format', () => {
  it('accepts exactly nine ASCII digits, leading zeroes included', () => {
    expect(isDevicePin('000000000')).toBe(true);
    expect(isDevicePin('999999999')).toBe(true);
    expect(normalizeDevicePin('001234567')).toBe('001234567');
    expect(joinDevicePinGroups(['001', '234', '567'])).toBe('001234567');
  });

  it.each(['12345678', '1234567890', '123 456 789', '123-456-789', '12345678a', '１２３４５６７８９', ''])('rejects %j', (value) => {
    expect(isDevicePin(value)).toBe(false);
    expect(() => normalizeDevicePin(value)).toThrow(DeviceVaultError);
  });
});

describe('device vault', () => {
  it('creates a vault that the same code unlocks after a reload', async () => {
    const { databaseName, vault } = freshVault();
    expect(await vault.exists()).toBe(false);
    await vault.create(PIN);
    expect(vault.isUnlocked()).toBe(true);
    await vault.putSecret(NOSTR, SECRET);

    const reloaded = createDeviceVault({ databaseName });
    expect(await reloaded.exists()).toBe(true);
    expect(reloaded.isUnlocked()).toBe(false);
    await reloaded.unlock(PIN);
    expect(await reloaded.getSecret(NOSTR)).toBe(SECRET);
  });

  it('accepts a code with leading zeroes', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create('000000007');
    const reloaded = createDeviceVault({ databaseName });
    await reloaded.unlock('000000007');
    expect(reloaded.isUnlocked()).toBe(true);
  });

  it('rejects malformed codes on create and unlock', async () => {
    const { vault } = freshVault();
    await expect(vault.create('1234')).rejects.toMatchObject({ code: 'invalid-pin' });
    expect(await vault.exists()).toBe(false);
    await vault.create(PIN);
    vault.lock();
    await expect(vault.unlock('12345678a')).rejects.toMatchObject({ code: 'invalid-pin' });
  });

  it('does not unlock with an incorrect code and says only that it is incorrect', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    const reloaded = createDeviceVault({ databaseName });
    const error = await reloaded.unlock(OTHER_PIN).catch((caught) => caught);
    expect(error).toMatchObject({ code: 'incorrect-pin', message: 'That device code is incorrect.' });
    expect(reloaded.isUnlocked()).toBe(false);
    await expect(reloaded.getSecret(NOSTR)).rejects.toMatchObject({ code: 'locked' });
  });

  it('refuses to create a second vault over an existing one', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    await expect(vault.create(OTHER_PIN)).rejects.toMatchObject({ code: 'vault-exists' });
  });

  it('writes neither the code, the secret nor the root key to storage', async () => {
    const produced: Uint8Array[] = [];
    const real = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const out = real(array as never) as unknown as Uint8Array;
      produced.push(out.slice());
      return out as unknown as T;
    });
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);

    const stored = await dump(databaseName);
    expect(stored).not.toContain(PIN);
    expect(stored).not.toContain(SECRET);
    const rootCandidates = produced.filter((bytes) => bytes.length === 32);
    expect(rootCandidates.length).toBeGreaterThan(0);
    for (const bytes of rootCandidates) {
      expect(stored).not.toContain(Buffer.from(bytes).toString('base64'));
      expect(stored).not.toContain(Buffer.from(bytes).toString('hex'));
    }
  });

  it('keeps nothing usable in a lock: the session is gone and reads refuse', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.getSecret(NOSTR)).rejects.toMatchObject({ code: 'locked' });
    await expect(vault.putSecret(NOSTR, SECRET)).rejects.toMatchObject({ code: 'locked' });
    // Locking discards the session, not the records.
    expect(await vault.hasSecret(NOSTR)).toBe(true);
    await vault.unlock(PIN);
    expect(await vault.getSecret(NOSTR)).toBe(SECRET);
  });

  it('starts locked in a fresh page load', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    vi.resetModules();
    const reloadedModule = await import('../src/security/device-vault');
    const reloaded = reloadedModule.createDeviceVault({ databaseName });
    expect(reloaded.isUnlocked()).toBe(false);
    expect(reloadedModule.deviceVault.isUnlocked()).toBe(false);
  });

  it('reports a missing scope rather than an empty secret', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    await expect(vault.getSecret(NOSTR)).rejects.toMatchObject({ code: 'scope-not-found' });
    await expect(vault.putSecret('root', SECRET)).rejects.toMatchObject({ code: 'scope-not-found' });
  });

  it('stores scopes independently and deletes one without touching another', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    await vault.putSecret(OTHER_SCOPE, 'other secret');
    expect((await vault.listScopes()).sort()).toEqual([OTHER_SCOPE, NOSTR].sort());
    await vault.deleteSecret(NOSTR);
    expect(await vault.listScopes()).toEqual([OTHER_SCOPE]);
    expect(await vault.getSecret(OTHER_SCOPE)).toBe('other secret');
  });

  it('fails authentication when ciphertext is moved to another scope', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    await vault.putSecret(OTHER_SCOPE, 'other secret');
    await rewrite(databaseName, 'secrets', (records) => {
      const nostr = records.find((record) => record.scope === NOSTR)!;
      return records.map((record) => (record.scope === OTHER_SCOPE ? { ...nostr, scope: OTHER_SCOPE } : record));
    });
    await expect(vault.getSecret(OTHER_SCOPE)).rejects.toMatchObject({ code: 'decryption-failed' });
    expect(await vault.getSecret(NOSTR)).toBe(SECRET);
  });

  it('derives a different key for each scope', async () => {
    const root = await importRootKey(randomBytes(32));
    const nonce = randomBytes(12);
    const plaintext = new TextEncoder().encode(SECRET);
    const nostr = await sealSecret(root, NOSTR, 1, plaintext, nonce);
    const other = await sealSecret(root, OTHER_SCOPE, 1, plaintext, nonce);
    // Same root, same nonce, same plaintext: identical ciphertext would mean a shared key.
    expect(Buffer.from(nostr.ciphertext).equals(Buffer.from(other.ciphertext))).toBe(false);
    await expect(openSecret(root, OTHER_SCOPE, 1, nonce, nostr.ciphertext)).rejects.toMatchObject({ code: 'decryption-failed' });
    await expect(openSecret(root, NOSTR, 2, nonce, nostr.ciphertext)).rejects.toMatchObject({ code: 'decryption-failed' });
  });

  it('changes the code without re-encrypting any secret', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    const before = JSON.parse(await dump(databaseName)).secrets;

    await vault.changePin(PIN, OTHER_PIN);
    expect(JSON.parse(await dump(databaseName)).secrets).toEqual(before);

    const reloaded = createDeviceVault({ databaseName });
    await expect(reloaded.unlock(PIN)).rejects.toMatchObject({ code: 'incorrect-pin' });
    await reloaded.unlock(OTHER_PIN);
    expect(await reloaded.getSecret(NOSTR)).toBe(SECRET);
  });

  it('refuses a code change when the current code is wrong', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await expect(vault.changePin(OTHER_PIN, '111111111')).rejects.toMatchObject({ code: 'incorrect-pin' });
    const reloaded = createDeviceVault({ databaseName });
    await reloaded.unlock(PIN);
  });

  it('keeps the old code working when the rewrap cannot be written', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(vault.changePin(PIN, OTHER_PIN)).rejects.toMatchObject({ code: 'encryption-failed' });
    IDBObjectStore.prototype.put = put;

    const reloaded = createDeviceVault({ databaseName });
    await expect(reloaded.unlock(OTHER_PIN)).rejects.toMatchObject({ code: 'incorrect-pin' });
    await reloaded.unlock(PIN);
    expect(await reloaded.getSecret(NOSTR)).toBe(SECRET);
  });

  it('reports corrupt metadata instead of treating the vault as absent', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await rewrite(databaseName, 'metadata', (records) => records.map((record) => ({ ...record, wrappedRootKey: 'not base64!' })));
    const reloaded = createDeviceVault({ databaseName });
    expect(await reloaded.exists()).toBe(true);
    await expect(reloaded.unlock(PIN)).rejects.toMatchObject({ code: 'corrupt-metadata' });
  });

  it('refuses a vault or record from an unknown version', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    await rewrite(databaseName, 'secrets', (records) => records.map((record) => ({ ...record, version: 2 })));
    await expect(vault.getSecret(NOSTR)).rejects.toMatchObject({ code: 'unsupported-version' });
    await rewrite(databaseName, 'metadata', (records) => records.map((record) => ({ ...record, version: 2 })));
    await expect(createDeviceVault({ databaseName }).unlock(PIN)).rejects.toMatchObject({ code: 'unsupported-version' });
  });

  it('reports a damaged record as corrupt', async () => {
    const { databaseName, vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    await rewrite(databaseName, 'secrets', (records) => records.map((record) => ({ ...record, nonce: 'AAAA' })));
    await expect(vault.getSecret(NOSTR)).rejects.toMatchObject({ code: 'corrupt-record' });
  });

  it('destroys every record and locks', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    await vault.putSecret(NOSTR, SECRET);
    await vault.destroy();
    expect(vault.isUnlocked()).toBe(false);
    expect(await vault.exists()).toBe(false);
    expect(await vault.listScopes()).toEqual([]);
  });

  it('says storage is unavailable rather than failing obscurely', async () => {
    const { vault } = freshVault();
    vi.stubGlobal('indexedDB', undefined);
    await expect(vault.exists()).rejects.toMatchObject({ code: 'unavailable' });
    vi.unstubAllGlobals();
  });
});
