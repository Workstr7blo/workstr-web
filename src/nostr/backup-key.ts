import type { SignedNostrEvent, Signer } from '../signer/types';
import { SignerTimeoutError } from '../signer/timeout';

// The one record that is not sealed with the backup key, because it is the backup key.
// It is NIP-44 encrypted to the user's own pubkey, so unwrapping it is the single signer
// round trip a device pays before it can read or write anything else.
export const BACKUP_KEY_ADDRESS = 'workstr:v2:key';

export const KEY_BYTES = 32;

// Raised instead of falling through to key creation. A device that cannot reach the relay,
// or cannot decrypt a key record that exists, knows nothing about whether a key is already
// out there — and inventing a second one silently forks the backup into two halves that
// cannot read each other, with every record written under whichever key lost.
export class BackupKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupKeyUnavailableError';
  }
}

// Fetch resolves to null only when the relay actually answered and held no key. Anything
// that went wrong throws, so "absent" can never be confused with "unknown".
export interface BackupKeyTransport {
  fetchKeyEvent(): Promise<SignedNostrEvent | null>;
  publishKeyEvent(content: string): Promise<{ accepted: boolean; reason: string }>;
}

export interface BackupKeyCache {
  read(): Promise<string | undefined>;
  write(rawBase64: string): Promise<void>;
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    if (binary.length !== KEY_BYTES) return null;
    const bytes = new Uint8Array(KEY_BYTES);
    for (let index = 0; index < KEY_BYTES; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function importBackupKey(rawBase64: string): Promise<CryptoKey | null> {
  const bytes = fromBase64(rawBase64);
  if (!bytes) return null;
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function generateKeyBase64(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

async function unwrap(signer: Signer, event: SignedNostrEvent): Promise<string> {
  let plaintext: string;
  try {
    plaintext = await signer.nip44Decrypt(event.pubkey, event.content);
  } catch (error) {
    // A signer that never answered is a different situation from one that answered no:
    // the first is "go and open your signer app", the second is a broken backup. Passing
    // the timeout through keeps the copy the user can act on, and it still aborts the
    // pass, so a silent signer can no more mint a second key than a refusal can.
    if (error instanceof SignerTimeoutError) throw error;
    throw new BackupKeyUnavailableError(
      `Your signer could not open your backup key: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // A key record that exists but does not hold a key is not an invitation to write a new
  // one over it: the records encrypted under the real key would become unreadable.
  if (!fromBase64(plaintext)) {
    throw new BackupKeyUnavailableError('Your backup key record could not be read. Backup is paused rather than starting a second key.');
  }
  return plaintext;
}

// Returns the key this account's records are sealed with, creating one only when the relay
// has definitively answered that there is none.
//
// The re-fetch after publishing is what makes two fresh devices safe. Both can look, both
// can find nothing, and both can publish to the same address — it is addressable, so one
// silently overwrites the other. Whichever device read its own key back would otherwise
// spend the rest of its life writing records nobody can open. Asking the relay again makes
// its answer the decision, and the loser simply adopts the winner's key before it has
// written anything.
export async function resolveBackupKey(
  signer: Signer,
  transport: BackupKeyTransport,
  cache: BackupKeyCache
): Promise<CryptoKey> {
  const cached = await cache.read();
  if (cached) {
    const key = await importBackupKey(cached);
    if (key) return key;
    // Cached but unusable: fall through and ask the relay rather than minting a new one.
  }

  const existing = await fetchExisting(transport);
  if (existing) {
    const raw = await unwrap(signer, existing);
    await cache.write(raw);
    return (await importBackupKey(raw)) as CryptoKey;
  }

  const minted = generateKeyBase64();
  const wrapped = await wrapForSelf(signer, minted);
  const outcome = await transport.publishKeyEvent(wrapped);
  if (!outcome.accepted) {
    throw new BackupKeyUnavailableError(`Your backup key could not be saved to the relay: ${outcome.reason}`);
  }

  const confirmed = await fetchExisting(transport);
  if (!confirmed) {
    // Published and then not there. Something is wrong at the relay, and writing records
    // against a key it did not keep would lose them.
    throw new BackupKeyUnavailableError('Your backup key did not stay on the relay. Backup is paused until it can be saved.');
  }
  const winner = await unwrap(signer, confirmed);
  await cache.write(winner);
  return (await importBackupKey(winner)) as CryptoKey;
}

async function fetchExisting(transport: BackupKeyTransport): Promise<SignedNostrEvent | null> {
  try {
    return await transport.fetchKeyEvent();
  } catch (error) {
    throw new BackupKeyUnavailableError(
      `Could not check for your backup key: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function wrapForSelf(signer: Signer, rawBase64: string): Promise<string> {
  try {
    return await signer.nip44Encrypt(await signer.getPublicKey(), rawBase64);
  } catch (error) {
    if (error instanceof SignerTimeoutError) throw error;
    throw new BackupKeyUnavailableError(
      `Your signer could not wrap a backup key: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Every device that signs in writes the key record back, not just the one that created it.
// The wrapped key is the only thing standing between the user and an unreadable backup, and
// one record going missing on the relay would otherwise orphan every record that depends on
// it. Republishing is one signer round trip on a device that has already paid one.
export async function republishBackupKey(signer: Signer, transport: BackupKeyTransport, rawBase64: string): Promise<boolean> {
  try {
    const outcome = await transport.publishKeyEvent(await wrapForSelf(signer, rawBase64));
    return outcome.accepted;
  } catch {
    // Best effort by design: the device already holds a working key, so a failure here
    // must not stop it backing up.
    return false;
  }
}
