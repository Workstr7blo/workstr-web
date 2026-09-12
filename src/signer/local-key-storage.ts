// Secure storage boundary for a local account's secret key. The nsec is the account: it
// is never written to Workstr settings, JSON export, sync records, logs, or error
// messages, and as of this module it is no longer written to localStorage either.
//
// The usual pattern for a PWA secret: browsers give a PWA no Keychain or
// Keystore, so the closest available thing is a non-extractable AES-GCM CryptoKey held by
// IndexedDB structured clone, with only ciphertext kept beside it in a dedicated
// origin-private database.
//
// Be clear about what that buys, because the file name promises more than the platform can
// deliver. Moving off localStorage removes the easiest reads: a devtools glance, an
// extension enumerating storage, anything that scrapes the store every credential thief
// looks at first. It does NOT defend against script running on this origin — a
// non-extractable key still decrypts for whoever can call it, so an XSS that reaches this
// module reaches the key. Real protection needs a secret the browser does not hold on its
// own, meaning a user passphrase or WebAuthn PRF, and Workstr deliberately has neither.
// This raises the bar; it is not a keystore.
import { openDB, type DBSchema } from 'idb';
import { base64ToBytes, bytesToBase64, NONCE_BYTES } from '../nostr/envelope';

const DB_NAME = 'workstr-secure-local-key-v1';
const DB_VERSION = 1;
const RECORD_ID = 'active';
const AAD_DOMAIN = 'workstr-local-key-secure-storage-v1';

// Where the secret lived before this module. Read once on migration, then removed.
export const LEGACY_LOCAL_KEY_STORAGE = 'workstr.localNsec.hex';

export type LocalKeyStorageErrorCode = 'unavailable' | 'read_failed' | 'write_failed' | 'clear_failed' | 'corrupt_record';

export class LocalKeyStorageError extends Error {
  readonly code: LocalKeyStorageErrorCode;
  constructor(code: LocalKeyStorageErrorCode, message: string) {
    super(message);
    this.name = 'LocalKeyStorageError';
    this.code = code;
  }
}

interface SecureKeyRecord {
  id: string;
  key: CryptoKey;
}

interface SecureSecretRecord {
  id: string;
  version: 1;
  nonce: string;
  ciphertext: string;
  savedAt: number;
}

interface LocalKeySecureDB extends DBSchema {
  keys: { key: string; value: SecureKeyRecord };
  secrets: { key: string; value: SecureSecretRecord };
}

function assertSecureStorageAvailable(): void {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new LocalKeyStorageError('unavailable', 'Secure key storage is unavailable on this device.');
  }
}

async function openSecureDb() {
  assertSecureStorageAvailable();
  try {
    return await openDB<LocalKeySecureDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('keys', { keyPath: 'id' });
        db.createObjectStore('secrets', { keyPath: 'id' });
      }
    });
  } catch {
    throw new LocalKeyStorageError('unavailable', 'Secure key storage could not be opened.');
  }
}

// Generated once and never exported. `false` for extractable is the whole point: the
// wrapping key can encrypt and decrypt but cannot be read back out of the browser.
async function wrappingKey(): Promise<CryptoKey> {
  const db = await openSecureDb();
  try {
    const existing = await db.get('keys', RECORD_ID);
    if (existing?.key) return existing.key;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await db.put('keys', { id: RECORD_ID, key });
    return key;
  } catch {
    throw new LocalKeyStorageError('write_failed', 'Secure key storage could not be prepared.');
  } finally {
    db.close();
  }
}

function aad(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(AAD_DOMAIN);
}

// The secret is stored as the 64-character hex the signer wants, not as an nsec: bech32
// is a display encoding, and keeping it out of storage means a leaked record does not
// carry the exact string a person would recognise and paste somewhere.
export async function saveLocalSecret(secretHex: string): Promise<void> {
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad() },
      await wrappingKey(),
      new TextEncoder().encode(secretHex)
    ));
    const db = await openSecureDb();
    try {
      await db.put('secrets', {
        id: RECORD_ID,
        version: 1,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
        savedAt: Date.now()
      });
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof LocalKeyStorageError) throw error;
    throw new LocalKeyStorageError('write_failed', 'Recovery key could not be saved securely.');
  }
}

// Null when no local account is stored. A record that cannot be decrypted is corrupt
// rather than absent, and says so: silently returning null would strand someone on a
// sign-in screen with no clue that their key is there but unreadable.
export async function loadLocalSecret(): Promise<string | null> {
  let record: SecureSecretRecord | undefined;
  try {
    const db = await openSecureDb();
    try {
      record = await db.get('secrets', RECORD_ID);
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof LocalKeyStorageError) throw error;
    throw new LocalKeyStorageError('read_failed', 'Recovery key could not be loaded securely.');
  }
  if (!record) return null;

  const nonce = base64ToBytes(record.nonce);
  const ciphertext = base64ToBytes(record.ciphertext);
  if (!nonce || !ciphertext || nonce.length !== NONCE_BYTES) {
    throw new LocalKeyStorageError('corrupt_record', 'Saved recovery key could not be read.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad() },
      await wrappingKey(),
      ciphertext
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof LocalKeyStorageError) throw error;
    throw new LocalKeyStorageError('corrupt_record', 'Saved recovery key could not be opened.');
  }
}

export async function hasLocalSecret(): Promise<boolean> {
  try {
    const db = await openSecureDb();
    try {
      return Boolean(await db.get('secrets', RECORD_ID));
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof LocalKeyStorageError) throw error;
    throw new LocalKeyStorageError('read_failed', 'Secure key storage could not be read.');
  }
}

// Signing out. Both halves go: the ciphertext is meaningless without the wrapping key, but
// leaving either behind leaves something that looks like an account on this device.
export async function clearLocalSecret(): Promise<void> {
  try {
    localStorage.removeItem(LEGACY_LOCAL_KEY_STORAGE);
  } catch {
    // A browser refusing localStorage entirely is not a reason to skip the real store.
  }
  try {
    const db = await openSecureDb();
    try {
      const tx = db.transaction(['secrets', 'keys'], 'readwrite');
      await Promise.all([tx.objectStore('secrets').delete(RECORD_ID), tx.objectStore('keys').delete(RECORD_ID), tx.done]);
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof LocalKeyStorageError) throw error;
    throw new LocalKeyStorageError('clear_failed', 'Recovery key could not be cleared securely.');
  }
}

// One-way move for accounts created before this module existed. Runs on every load rather
// than behind a flag, because the flag would be one more thing that can be wrong: once
// localStorage is empty this is a single miss on a key that is not there.
//
// The legacy value is removed only after the encrypted copy is committed. Crashing between
// the two leaves a duplicate, which the next run cleans up; doing it the other way round
// would lose the account.
export async function migrateLegacyLocalSecret(): Promise<boolean> {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE);
  } catch {
    return false;
  }
  if (!legacy) return false;

  const secretHex = legacy.trim();
  // Anything that is not a plain hex secret is not something to re-encrypt and keep; it is
  // a corrupt or foreign value, and carrying it forward would preserve a bug.
  if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) {
    try { localStorage.removeItem(LEGACY_LOCAL_KEY_STORAGE); } catch { /* nothing to undo */ }
    return false;
  }

  await saveLocalSecret(secretHex.toLowerCase());
  try {
    localStorage.removeItem(LEGACY_LOCAL_KEY_STORAGE);
  } catch {
    // Encrypted copy is committed, so the account is safe. The stale plaintext is removed
    // on the next successful clear or migration.
  }
  return true;
}
