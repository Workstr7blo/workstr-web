import { nip19 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44DecryptPayload, encrypt as nip44EncryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

const LOCAL_KEY_STORAGE = 'workstr.localNsec.hex';

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

function secretFromStorage(): Uint8Array | null {
  const stored = localStorage.getItem(LOCAL_KEY_STORAGE);
  if (!stored) return null;
  try {
    return normalizeSecretKey(stored);
  } catch {
    localStorage.removeItem(LOCAL_KEY_STORAGE);
    return null;
  }
}

export function createLocalAccount(): { nsec: string; pubkey: string; signer: Signer } {
  const secretKey = generateSecretKey();
  persistLocalSecretKey(secretKey);
  return { nsec: nip19.nsecEncode(secretKey), pubkey: getPublicKey(secretKey), signer: createLocalKeySigner(secretKey) };
}

export function importLocalAccount(input: string): { pubkey: string; signer: Signer } {
  const secretKey = normalizeSecretKey(input);
  persistLocalSecretKey(secretKey);
  return { pubkey: getPublicKey(secretKey), signer: createLocalKeySigner(secretKey) };
}

export function createCachedLocalKeySigner(): Signer | null {
  const secretKey = secretFromStorage();
  return secretKey ? createLocalKeySigner(secretKey) : null;
}

export function clearLocalKey(): void {
  localStorage.removeItem(LOCAL_KEY_STORAGE);
}

export function hasLocalKey(): boolean {
  return Boolean(secretFromStorage());
}

function persistLocalSecretKey(secretKey: Uint8Array): void {
  localStorage.setItem(LOCAL_KEY_STORAGE, bytesToHex(secretKey));
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
