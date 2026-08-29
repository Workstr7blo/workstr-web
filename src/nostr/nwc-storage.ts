// Secure storage boundary for the active NWC connection. The NWC secret is a
// spending credential: it is never written to Workstr settings, localStorage,
// JSON export, sync records, logs, or error messages. Browsers do not expose a
// native Keychain/Keystore API to PWAs, so this repository uses the platform's
// WebCrypto secure-storage pattern: a non-extractable AES-GCM CryptoKey stored
// by IndexedDB structured clone, with only encrypted credential material kept in
// a dedicated origin-private database.
import { openDB, type DBSchema } from 'idb';
import { base64ToBytes, bytesToBase64, NONCE_BYTES } from './envelope';
import { parseNwcConnectionString, toNwcError, type NwcConnection } from './nwc';

const DB_NAME = 'workstr-secure-nwc-v1';
const DB_VERSION = 1;
const ACTIVE_CONNECTION_ID = 'active';
const AAD_DOMAIN = 'workstr-nwc-secure-storage-v1';

export type NwcSecureStorageErrorCode = 'unavailable' | 'read_failed' | 'write_failed' | 'clear_failed' | 'corrupt_record';

export class NwcSecureStorageError extends Error {
  readonly code: NwcSecureStorageErrorCode;
  constructor(code: NwcSecureStorageErrorCode, message: string) {
    super(message);
    this.name = 'NwcSecureStorageError';
    this.code = code;
  }
}

export interface StoredNwcConnection {
  connection: NwcConnection;
  metadata: {
    walletPubkey: string;
    relays: string[];
    lud16?: string;
    expiresAt?: number;
    savedAt: number;
    lastUsedAt: number;
  };
}

interface SecureKeyRecord {
  id: string;
  key: CryptoKey;
}

interface SecureConnectionRecord {
  id: string;
  version: 1;
  namespace: string;
  nonce: string;
  ciphertext: string;
  metadata: StoredNwcConnection['metadata'];
}

interface NwcSecureDB extends DBSchema {
  keys: { key: string; value: SecureKeyRecord };
  connections: { key: string; value: SecureConnectionRecord };
}

function recordId(namespace: string): string {
  return `${namespace}:${ACTIVE_CONNECTION_ID}`;
}

function assertSecureStorageAvailable(): void {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new NwcSecureStorageError('unavailable', 'Secure wallet storage is unavailable on this device.');
  }
}

async function openSecureDb() {
  assertSecureStorageAvailable();
  try {
    return await openDB<NwcSecureDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('keys', { keyPath: 'id' });
        db.createObjectStore('connections', { keyPath: 'id' });
      }
    });
  } catch {
    throw new NwcSecureStorageError('unavailable', 'Secure wallet storage could not be opened.');
  }
}

async function activeKey(namespace: string): Promise<CryptoKey> {
  const db = await openSecureDb();
  try {
    const id = recordId(namespace);
    const existing = await db.get('keys', id);
    if (existing?.key) return existing.key;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await db.put('keys', { id, key });
    return key;
  } catch {
    throw new NwcSecureStorageError('write_failed', 'Secure wallet storage key could not be prepared.');
  } finally {
    db.close();
  }
}

function aad(namespace: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AAD_DOMAIN}|${namespace}`);
}

function payloadFor(connection: NwcConnection): string {
  return JSON.stringify(connection);
}

function metadataFor(connection: NwcConnection, now: number): StoredNwcConnection['metadata'] {
  return {
    walletPubkey: connection.walletPubkey,
    relays: [...connection.relays],
    lud16: connection.lud16,
    expiresAt: connection.expiresAt,
    savedAt: now,
    lastUsedAt: now
  };
}

async function seal(namespace: string, connection: NwcConnection): Promise<Pick<SecureConnectionRecord, 'nonce' | 'ciphertext'>> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(namespace) },
    await activeKey(namespace),
    new TextEncoder().encode(payloadFor(connection))
  ));
  return { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) };
}

async function openRecord(namespace: string, record: SecureConnectionRecord): Promise<NwcConnection> {
  const nonce = base64ToBytes(record.nonce);
  const ciphertext = base64ToBytes(record.ciphertext);
  if (!nonce || !ciphertext || nonce.length !== NONCE_BYTES) {
    throw new NwcSecureStorageError('corrupt_record', 'Saved wallet connection could not be read.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad(namespace) },
      await activeKey(namespace),
      ciphertext
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as NwcConnection;
    return parseNwcConnectionString(connectionStringFrom(parsed));
  } catch (error) {
    if (error instanceof NwcSecureStorageError) throw error;
    throw new NwcSecureStorageError('corrupt_record', 'Saved wallet connection could not be opened.');
  }
}

function connectionStringFrom(connection: NwcConnection): string {
  const url = new URL(`nostr+walletconnect://${connection.walletPubkey}`);
  for (const relay of connection.relays) url.searchParams.append('relay', relay);
  url.searchParams.set('secret', connection.secret);
  if (connection.lud16) url.searchParams.set('lud16', connection.lud16);
  if (connection.expiresAt) url.searchParams.set('expires_at', String(connection.expiresAt));
  return url.toString();
}

// Save a validated active connection for this account/device namespace. Only the
// parsed minimum NWC fields are encrypted; the original URI is not retained.
export async function saveNwcConnection(namespace: string, connectionString: string): Promise<StoredNwcConnection> {
  const connection = parseNwcConnectionString(connectionString);
  const now = Math.floor(Date.now() / 1000);
  const metadata = metadataFor(connection, now);
  try {
    const db = await openSecureDb();
    try {
      await db.put('connections', { id: recordId(namespace), version: 1, namespace, metadata, ...await seal(namespace, connection) });
    } finally {
      db.close();
    }
    return { connection, metadata };
  } catch (error) {
    if (error instanceof NwcSecureStorageError) throw error;
    throw new NwcSecureStorageError('write_failed', 'Wallet connection could not be saved securely.');
  }
}

// Load the active connection, or null when no wallet is connected.
export async function loadNwcConnection(namespace: string): Promise<StoredNwcConnection | null> {
  try {
    const db = await openSecureDb();
    try {
      const record = await db.get('connections', recordId(namespace));
      if (!record) return null;
      return { connection: await openRecord(namespace, record), metadata: record.metadata };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof NwcSecureStorageError) throw error;
    throw new NwcSecureStorageError('read_failed', 'Wallet connection could not be loaded securely.');
  }
}

export async function getNwcConnection(namespace: string): Promise<NwcConnection | null> {
  return (await loadNwcConnection(namespace))?.connection ?? null;
}

export async function hasActiveNwcConnection(namespace: string): Promise<boolean> {
  try {
    return (await loadNwcConnection(namespace)) !== null;
  } catch (error) {
    if (error instanceof NwcSecureStorageError) throw error;
    throw toNwcError(error);
  }
}

// "Disconnect wallet" — deletes both encrypted credentials and the wrapping key.
export async function clearNwcConnection(namespace: string): Promise<void> {
  try {
    const db = await openSecureDb();
    try {
      const id = recordId(namespace);
      const tx = db.transaction(['connections', 'keys'], 'readwrite');
      await Promise.all([tx.objectStore('connections').delete(id), tx.objectStore('keys').delete(id), tx.done]);
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof NwcSecureStorageError) throw error;
    throw new NwcSecureStorageError('clear_failed', 'Wallet connection could not be cleared securely.');
  }
}
