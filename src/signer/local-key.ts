// Identity and signer semantics for a local account. The secret lives in the device vault
// under `nostr.local-key`, encrypted under the user's device code, and this module never
// writes it anywhere else.
//
// Nothing here persists a key on its own initiative. Creating, restoring and receiving an
// account produce a key in memory; it reaches storage only through `saveLocalAccount`, which
// needs a vault the user has already unlocked or created. Closing any of those flows before
// the device code is set leaves nothing behind.
import { nip19 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44DecryptPayload, encrypt as nip44EncryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { deviceVault, type DeviceVault } from '../security/device-vault';
import { DeviceVaultError } from '../security/device-vault-types';
import { clearLocalSecret, hasLocalSecret, loadLocalSecret, migrateLegacyLocalSecret } from './local-key-storage';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

export const NOSTR_LOCAL_KEY_SCOPE = 'nostr.local-key';

/** A key held in memory, not yet stored. */
export interface LocalAccountKey {
  nsec: string;
  pubkey: string;
}

function normalizeSecretKey(input: string): Uint8Array {
  const value = input.trim();
  if (!value) throw new Error('Enter a recovery key.');
  if (value.startsWith('nsec1')) {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) throw new Error('That is not a valid nsec.');
    return decoded.data;
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value);
  throw new Error('Use an nsec recovery key or 64-character hex private key.');
}

export function generateLocalAccount(): LocalAccountKey {
  const secretKey = generateSecretKey();
  return { nsec: nip19.nsecEncode(secretKey), pubkey: getPublicKey(secretKey) };
}

export function parseRecoveryKey(input: string): LocalAccountKey {
  // Restore UI is nsec-only on purpose: accepting bare hex invites users to paste
  // something hex-looking that isn't their key. The stored representation stays hex.
  const value = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('That looks like a raw hex key. Use the nsec recovery key instead (it starts with nsec1).');
  }
  const secretKey = normalizeSecretKey(value);
  return { nsec: nip19.nsecEncode(secretKey), pubkey: getPublicKey(secretKey) };
}

// Stored as the 64-character hex the signer wants, not as an nsec: bech32 is a display
// encoding, and keeping it out of storage keeps the string a person would recognise out too.
async function readVaultSecretKey(vault: DeviceVault): Promise<Uint8Array | null> {
  if (!(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE))) return null;
  const stored = await vault.getSecret(NOSTR_LOCAL_KEY_SCOPE);
  try {
    return normalizeSecretKey(stored);
  } catch {
    // Decrypted but not a key. Corrupt, not absent: clearing it would hide the problem.
    throw new DeviceVaultError('corrupt-record');
  }
}

// Writes into an unlocked vault, reads the record back, and proves it opens to the account
// being signed into before anyone signs with it. A record that fails that is removed again, so
// a half-written key never looks like an account.
export async function saveLocalAccount(account: LocalAccountKey, vault: DeviceVault = deviceVault): Promise<Signer> {
  const secretKey = normalizeSecretKey(account.nsec);
  if (getPublicKey(secretKey) !== account.pubkey) throw new DeviceVaultError('encryption-failed', 'The recovery key does not match this account.');
  await vault.putSecret(NOSTR_LOCAL_KEY_SCOPE, bytesToHex(secretKey));
  const stored = await readVaultSecretKey(vault).catch(() => null);
  if (!stored || getPublicKey(stored) !== account.pubkey) {
    await vault.deleteSecret(NOSTR_LOCAL_KEY_SCOPE).catch(() => undefined);
    throw new DeviceVaultError('encryption-failed', 'The protected key could not be verified.');
  }
  return createLocalKeySigner(stored);
}

// Null while the vault is locked as well as when there is no local key: signing is simply not
// available until the device code has been entered.
export async function createCachedLocalKeySigner(vault: DeviceVault = deviceVault): Promise<Signer | null> {
  if (!vault.isUnlocked()) return null;
  const secretKey = await readVaultSecretKey(vault);
  return secretKey ? createLocalKeySigner(secretKey) : null;
}

// For QR device transfer, and nothing else. Null when this account is held by an external
// signer, which Workstr cannot copy because it never had the key; throws `locked` when there
// is a key but the vault is closed. Callers must not log, store or render the result.
export async function exportLocalNsec(vault: DeviceVault = deviceVault): Promise<string | null> {
  if (!(await vault.exists()) || !(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE))) return null;
  if (!vault.isUnlocked()) throw new DeviceVaultError('locked');
  const secretKey = await readVaultSecretKey(vault);
  return secretKey ? nip19.nsecEncode(secretKey) : null;
}

// Signing out removes the Nostr key and nothing else in the vault. A vault left holding no
// secrets protects nothing, so it goes too, rather than asking for a code on the next launch.
export async function clearLocalKey(vault: DeviceVault = deviceVault): Promise<void> {
  await clearLocalSecret();
  if (!(await vault.exists())) return;
  await vault.deleteSecret(NOSTR_LOCAL_KEY_SCOPE);
  if (!(await vault.listScopes()).length) await vault.destroy();
}

export async function hasLocalKey(vault: DeviceVault = deviceVault): Promise<boolean> {
  if ((await vault.exists()) && (await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE))) return true;
  return hasLegacyLocalKey();
}

// A key from before the device vault: in the automatically unlocked store, or still in
// plaintext localStorage, which is moved into that store first exactly as it always was.
export async function hasLegacyLocalKey(): Promise<boolean> {
  await migrateLegacyLocalSecret();
  return hasLocalSecret();
}

// Moves a pre-vault key into an unlocked vault. The old record is deleted last, and only once
// the vault's copy has been read back and shown to be the same account; every failure before
// that point leaves it exactly where it was. Safe to run again after an interruption: a vault
// that already holds the matching key just finishes the job.
export async function migrateLegacyLocalKey(expectedPubkey: string | null, vault: DeviceVault = deviceVault): Promise<string | null> {
  if (!vault.isUnlocked()) throw new DeviceVaultError('locked');
  let legacy: string | null;
  try {
    legacy = await loadLocalSecret();
  } catch {
    throw new DeviceVaultError('migration-failed');
  }
  if (!legacy) return null;

  let account: LocalAccountKey;
  try {
    const secretKey = normalizeSecretKey(legacy);
    account = { nsec: nip19.nsecEncode(secretKey), pubkey: getPublicKey(secretKey) };
  } catch {
    throw new DeviceVaultError('migration-failed');
  }
  if (expectedPubkey && account.pubkey !== expectedPubkey) throw new DeviceVaultError('migration-failed');

  try {
    const existing = await readVaultSecretKey(vault);
    if (existing) {
      if (getPublicKey(existing) !== account.pubkey) throw new DeviceVaultError('migration-failed');
    } else {
      await saveLocalAccount(account, vault);
    }
  } catch {
    throw new DeviceVaultError('migration-failed');
  }
  await clearLocalSecret();
  return account.pubkey;
}

function createLocalKeySigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey);
  return {
    type: 'local',
    getPublicKey: async () => pubkey,
    signEvent: async (event: UnsignedNostrEvent): Promise<SignedNostrEvent> => finalizeEvent(event, secretKey) as SignedNostrEvent,
    nip44Encrypt: async (peerPubkey: string, plaintext: string): Promise<string> => nip44EncryptPayload(plaintext, getConversationKey(secretKey, peerPubkey)),
    nip44Decrypt: async (peerPubkey: string, ciphertext: string): Promise<string> => nip44DecryptPayload(ciphertext, getConversationKey(secretKey, peerPubkey))
  };
}
