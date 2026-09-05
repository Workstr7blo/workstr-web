// Identity and signer semantics for a local account. Persistence is not here: the secret
// goes through `local-key-storage.ts`, which is the only module that touches where it
// lives. That split is why these functions are async — the storage layer is IndexedDB and
// WebCrypto, neither of which is synchronous.
import { nip19 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44DecryptPayload, encrypt as nip44EncryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { clearLocalSecret, hasLocalSecret, loadLocalSecret, migrateLegacyLocalSecret, saveLocalSecret } from './local-key-storage';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

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

async function secretFromStorage(): Promise<Uint8Array | null> {
  await migrateLegacyLocalSecret();
  const stored = await loadLocalSecret();
  if (!stored) return null;
  try {
    return normalizeSecretKey(stored);
  } catch {
    // Stored but unusable. Clearing it is the honest outcome: keeping a value that cannot
    // produce a signer would leave the app claiming an account it cannot sign for.
    await clearLocalSecret();
    return null;
  }
}

export async function createLocalAccount(): Promise<{ nsec: string; pubkey: string; signer: Signer }> {
  const secretKey = generateSecretKey();
  await persistLocalSecretKey(secretKey);
  return { nsec: nip19.nsecEncode(secretKey), pubkey: getPublicKey(secretKey), signer: createLocalKeySigner(secretKey) };
}

export async function importLocalAccount(input: string): Promise<{ pubkey: string; signer: Signer }> {
  // Restore UI is nsec-only on purpose: accepting bare hex invites users to paste
  // something hex-looking that isn't their key. The stored representation stays hex.
  const value = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('That looks like a raw hex key. Use the nsec recovery key instead (it starts with nsec1).');
  }
  const secretKey = normalizeSecretKey(input);
  await persistLocalSecretKey(secretKey);
  return { pubkey: getPublicKey(secretKey), signer: createLocalKeySigner(secretKey) };
}

export async function createCachedLocalKeySigner(): Promise<Signer | null> {
  const secretKey = await secretFromStorage();
  return secretKey ? createLocalKeySigner(secretKey) : null;
}

// For QR device transfer, and nothing else. Null when this account is held by an external
// signer, which Workstr cannot copy because it never had the key. Callers must not log,
// store or render the result.
export async function exportLocalNsec(): Promise<string | null> {
  const secretKey = await secretFromStorage();
  return secretKey ? nip19.nsecEncode(secretKey) : null;
}

export async function clearLocalKey(): Promise<void> {
  await clearLocalSecret();
}

export async function hasLocalKey(): Promise<boolean> {
  await migrateLegacyLocalSecret();
  return hasLocalSecret();
}

async function persistLocalSecretKey(secretKey: Uint8Array): Promise<void> {
  await saveLocalSecret(bytesToHex(secretKey));
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
