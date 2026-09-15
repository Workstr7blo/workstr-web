// The device vault: secrets on this device, encrypted under one nine-digit device code, in a
// database of their own. It knows nothing about Nostr or Monero - a module stores its secret
// under a scope such as `nostr.local-key`, and the vault gives each scope its own key.
//
// The unlocked session is memory only. A reload, a closed PWA or `lock()` drops it, and the
// next read needs the code again. What it does not do is stop code running on this origin
// while the vault is open: an unlocked session decrypts for whoever can call it, exactly as a
// signed-in signer signs for whoever can call it.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { base64ToBytes, bytesToBase64 } from '../nostr/envelope';
import { normalizeDevicePin } from './device-pin';
import { DEVICE_VAULT_KDF_PARAMETERS, deriveKeyEncryptionKey } from './device-vault-kdf';
import {
  GCM_NONCE_BYTES,
  importRootKey,
  openSecret,
  randomBytes,
  ROOT_KEY_BYTES,
  SALT_BYTES,
  sameBytes,
  sealSecret,
  unwrapRootKey,
  wrapRootKey,
  WRAPPED_ROOT_KEY_BYTES
} from './device-vault-crypto';
import {
  DEVICE_VAULT_DATABASE,
  DEVICE_VAULT_RECORD_VERSION,
  DEVICE_VAULT_VERSION,
  DeviceVaultError,
  type DeviceVaultErrorCode,
  type DeviceVaultKdfParameters,
  type DeviceVaultMetadata,
  type DeviceVaultSecretRecord
} from './device-vault-types';

const METADATA_ID = 'active';
// Dotted and lower case, `module.purpose`. A bare word is refused so no scope can collide with
// the `root` label the wrapped root key is authenticated under.
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

interface DeviceVaultDB extends DBSchema {
  metadata: { key: string; value: DeviceVaultMetadata };
  secrets: { key: string; value: DeviceVaultSecretRecord };
}

export interface DeviceVault {
  /** True when this device has a vault, locked or not. */
  exists(): Promise<boolean>;
  /** When the vault was created; null when there is none. */
  createdAt(): Promise<number | null>;
  isUnlocked(): boolean;
  create(pin: string): Promise<void>;
  unlock(pin: string): Promise<void>;
  lock(): void;
  listScopes(): Promise<string[]>;
  hasSecret(scope: string): Promise<boolean>;
  putSecret(scope: string, plaintext: string): Promise<void>;
  getSecret(scope: string): Promise<string>;
  deleteSecret(scope: string): Promise<void>;
  changePin(currentPin: string, nextPin: string): Promise<void>;
  /** Deletes every record and the metadata. Irreversible. */
  destroy(): Promise<void>;
}

export function assertVaultScope(scope: string): void {
  if (!SCOPE_PATTERN.test(scope)) throw new DeviceVaultError('scope-not-found', 'That is not a valid vault scope.');
}

interface ParsedMetadata {
  record: DeviceVaultMetadata;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  wrapped: Uint8Array<ArrayBuffer>;
}

function parseMetadata(value: unknown): ParsedMetadata {
  const record = value as Partial<DeviceVaultMetadata> | null;
  if (!record || typeof record !== 'object' || typeof record.version !== 'number') throw new DeviceVaultError('corrupt-metadata');
  if (record.version !== DEVICE_VAULT_VERSION || record.kdf !== 'argon2id') throw new DeviceVaultError('unsupported-version');
  const parameters = record.kdfParameters;
  const salt = typeof record.salt === 'string' ? base64ToBytes(record.salt) : null;
  const nonce = typeof record.wrappingNonce === 'string' ? base64ToBytes(record.wrappingNonce) : null;
  const wrapped = typeof record.wrappedRootKey === 'string' ? base64ToBytes(record.wrappedRootKey) : null;
  if (!parameters || typeof parameters !== 'object' || !salt || salt.length < SALT_BYTES || nonce?.length !== GCM_NONCE_BYTES || wrapped?.length !== WRAPPED_ROOT_KEY_BYTES) {
    throw new DeviceVaultError('corrupt-metadata');
  }
  return { record: record as DeviceVaultMetadata, salt, nonce, wrapped };
}

function parseSecretRecord(record: DeviceVaultSecretRecord): { nonce: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> } {
  if (typeof record.version !== 'number') throw new DeviceVaultError('corrupt-record');
  if (record.version !== DEVICE_VAULT_RECORD_VERSION) throw new DeviceVaultError('unsupported-version');
  const nonce = typeof record.nonce === 'string' ? base64ToBytes(record.nonce) : null;
  const ciphertext = typeof record.ciphertext === 'string' ? base64ToBytes(record.ciphertext) : null;
  if (nonce?.length !== GCM_NONCE_BYTES || !ciphertext?.length) throw new DeviceVaultError('corrupt-record');
  return { nonce, ciphertext };
}

export function createDeviceVault(options: { databaseName?: string } = {}): DeviceVault {
  const databaseName = options.databaseName || DEVICE_VAULT_DATABASE;
  let session: CryptoKey | null = null;

  async function withDb<T>(failure: DeviceVaultErrorCode, run: (db: IDBPDatabase<DeviceVaultDB>) => Promise<T>): Promise<T> {
    if (!globalThis.indexedDB) throw new DeviceVaultError('unavailable');
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new DeviceVaultError('unsupported-crypto');
    let db: IDBPDatabase<DeviceVaultDB>;
    try {
      db = await openDB<DeviceVaultDB>(databaseName, DEVICE_VAULT_VERSION, {
        upgrade(database) {
          database.createObjectStore('metadata', { keyPath: 'id' });
          database.createObjectStore('secrets', { keyPath: 'scope' });
        }
      });
    } catch {
      throw new DeviceVaultError('unavailable');
    }
    try {
      return await run(db);
    } catch (error) {
      if (error instanceof DeviceVaultError) throw error;
      throw new DeviceVaultError(failure);
    } finally {
      db.close();
    }
  }

  const readMetadata = () => withDb('unavailable', (db) => db.get('metadata', METADATA_ID));

  async function requireMetadata(): Promise<ParsedMetadata> {
    const stored = await readMetadata();
    if (!stored) throw new DeviceVaultError('unavailable', 'There is no device vault on this device.');
    return parseMetadata(stored);
  }

  function requireSession(): CryptoKey {
    if (!session) throw new DeviceVaultError('locked');
    return session;
  }

  // Imports a copy and wipes the raw bytes. Best effort only: JavaScript gives no guarantee
  // that an earlier copy is not still sitting in memory somewhere.
  async function openSession(rootKey: Uint8Array<ArrayBuffer>): Promise<void> {
    try {
      session = await importRootKey(rootKey);
    } finally {
      rootKey.fill(0);
    }
  }

  async function wrapUnderPin(pin: string, rootKey: Uint8Array<ArrayBuffer>, parameters: DeviceVaultKdfParameters) {
    const salt = randomBytes(SALT_BYTES);
    const keyEncryptionKey = new Uint8Array(await deriveKeyEncryptionKey(pin, salt, parameters));
    try {
      const { nonce, wrapped } = await wrapRootKey(keyEncryptionKey, rootKey);
      // Proves the wrap opens before anything is written, so a faulty wrap never replaces a
      // working one.
      const check = await unwrapRootKey(keyEncryptionKey, nonce, wrapped).catch(() => null);
      const verified = Boolean(check && sameBytes(check, rootKey));
      check?.fill(0);
      if (!verified) throw new DeviceVaultError('encryption-failed');
      return { salt, nonce, wrapped, keyEncryptionKey: keyEncryptionKey.slice() };
    } finally {
      keyEncryptionKey.fill(0);
    }
  }

  return {
    async exists() {
      return Boolean(await readMetadata());
    },

    async createdAt() {
      const stored = await readMetadata();
      if (!stored) return null;
      // No usable date reads as old, so an empty vault without one is still cleaned up.
      return typeof stored.createdAt === 'number' ? stored.createdAt : 0;
    },

    isUnlocked: () => session !== null,

    async create(pin) {
      normalizeDevicePin(pin);
      if (await readMetadata()) throw new DeviceVaultError('vault-exists');
      const rootKey = randomBytes(ROOT_KEY_BYTES);
      try {
        const { salt, nonce, wrapped, keyEncryptionKey } = await wrapUnderPin(pin, rootKey, DEVICE_VAULT_KDF_PARAMETERS);
        keyEncryptionKey.fill(0);
        const now = Date.now();
        await withDb('encryption-failed', async (db) => {
          // `add`, not `put`: two tabs creating at once must not leave one vault's secrets
          // under the other's root key.
          await db.add('metadata', {
            id: METADATA_ID,
            version: DEVICE_VAULT_VERSION,
            kdf: 'argon2id',
            salt: bytesToBase64(salt),
            kdfParameters: { ...DEVICE_VAULT_KDF_PARAMETERS },
            wrappingNonce: bytesToBase64(nonce),
            wrappedRootKey: bytesToBase64(wrapped),
            createdAt: now,
            updatedAt: now
          });
        });
        await openSession(rootKey.slice());
      } finally {
        rootKey.fill(0);
      }
    },

    async unlock(pin) {
      normalizeDevicePin(pin);
      const { record, salt, nonce, wrapped } = await requireMetadata();
      const keyEncryptionKey = new Uint8Array(await deriveKeyEncryptionKey(pin, salt, record.kdfParameters));
      try {
        await openSession(await unwrapRootKey(keyEncryptionKey, nonce, wrapped));
      } finally {
        keyEncryptionKey.fill(0);
      }
    },

    lock() {
      session = null;
    },

    listScopes: () => withDb('unavailable', async (db) => (await db.getAllKeys('secrets')).map(String)),

    async hasSecret(scope) {
      assertVaultScope(scope);
      return withDb('unavailable', async (db) => Boolean(await db.getKey('secrets', scope)));
    },

    async putSecret(scope, plaintext) {
      assertVaultScope(scope);
      const root = requireSession();
      const bytes = new TextEncoder().encode(plaintext);
      try {
        const { nonce, ciphertext } = await sealSecret(root, scope, DEVICE_VAULT_RECORD_VERSION, bytes);
        await withDb('encryption-failed', async (db) => {
          await db.put('secrets', { scope, version: DEVICE_VAULT_RECORD_VERSION, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext), savedAt: Date.now() });
        });
      } finally {
        bytes.fill(0);
      }
    },

    async getSecret(scope) {
      assertVaultScope(scope);
      const root = requireSession();
      const record = await withDb('unavailable', (db) => db.get('secrets', scope));
      if (!record) throw new DeviceVaultError('scope-not-found');
      const { nonce, ciphertext } = parseSecretRecord(record);
      const bytes = await openSecret(root, scope, record.version, nonce, ciphertext);
      try {
        return new TextDecoder().decode(bytes);
      } finally {
        bytes.fill(0);
      }
    },

    async deleteSecret(scope) {
      assertVaultScope(scope);
      await withDb('unavailable', (db) => db.delete('secrets', scope));
    },

    // Rewraps the root key and nothing else: every record stays exactly as it was, because
    // the keys that encrypt them come from the root, not from the code.
    async changePin(currentPin, nextPin) {
      normalizeDevicePin(currentPin);
      normalizeDevicePin(nextPin);
      const current = await requireMetadata();
      const oldKey = new Uint8Array(await deriveKeyEncryptionKey(currentPin, current.salt, current.record.kdfParameters));
      let rootKey: Uint8Array<ArrayBuffer>;
      try {
        rootKey = await unwrapRootKey(oldKey, current.nonce, current.wrapped);
      } finally {
        oldKey.fill(0);
      }

      try {
        const next = await wrapUnderPin(nextPin, rootKey, DEVICE_VAULT_KDF_PARAMETERS);
        const record: DeviceVaultMetadata = {
          ...current.record,
          salt: bytesToBase64(next.salt),
          kdfParameters: { ...DEVICE_VAULT_KDF_PARAMETERS },
          wrappingNonce: bytesToBase64(next.nonce),
          wrappedRootKey: bytesToBase64(next.wrapped),
          updatedAt: Date.now()
        };
        try {
          await withDb('encryption-failed', async (db) => { await db.put('metadata', record); });
          // Read back what was committed, not what was meant to be. Anything short of the
          // same root key restores the previous record, which the current code still opens.
          const written = parseMetadata(await readMetadata());
          const reopened = await unwrapRootKey(next.keyEncryptionKey, written.nonce, written.wrapped).catch(() => null);
          const verified = Boolean(reopened && sameBytes(reopened, rootKey));
          reopened?.fill(0);
          if (!verified) throw new DeviceVaultError('encryption-failed');
        } catch (error) {
          await withDb('encryption-failed', async (db) => { await db.put('metadata', current.record); }).catch(() => undefined);
          throw error instanceof DeviceVaultError ? error : new DeviceVaultError('encryption-failed');
        } finally {
          next.keyEncryptionKey.fill(0);
        }
        if (!session) await openSession(rootKey.slice());
      } finally {
        rootKey.fill(0);
      }
    },

    async destroy() {
      session = null;
      await withDb('unavailable', async (db) => {
        const tx = db.transaction(['metadata', 'secrets'], 'readwrite');
        await Promise.all([tx.objectStore('metadata').clear(), tx.objectStore('secrets').clear(), tx.done]);
      });
    }
  };
}

// The application's vault. One per page load, which is what makes a reload start locked.
export const deviceVault: DeviceVault = createDeviceVault();
