import { SimplePool, type VerifiedEvent } from 'nostr-tools';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

const CLIENT_SECRET_KEY = 'workstr.nip46.clientSecret';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

function clientSecretKey(): Uint8Array {
  const stored = localStorage.getItem(CLIENT_SECRET_KEY);
  if (stored) return hexToBytes(stored);
  const secret = generateSecretKey();
  localStorage.setItem(CLIENT_SECRET_KEY, bytesToHex(secret));
  return secret;
}

function toSigned(event: VerifiedEvent): SignedNostrEvent {
  return event as SignedNostrEvent;
}

export async function createBunkerSigner(input: string): Promise<Signer> {
  const pointer = await parseBunkerInput(input.trim());
  if (!pointer) {
    throw new Error('Invalid bunker URL or NIP-05 identifier');
  }

  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(clientSecretKey(), pointer, { pool });
  await signer.connect({
    name: 'Workstr Web',
    url: window.location.origin
  });

  return {
    type: 'nip46',
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event: UnsignedNostrEvent) => signer.signEvent(event).then(toSigned),
    nip44Encrypt: (peerPubkey, plaintext) => signer.nip44Encrypt(peerPubkey, plaintext),
    nip44Decrypt: (peerPubkey, ciphertext) => signer.nip44Decrypt(peerPubkey, ciphertext)
  };
}

export function isLikelyBunkerInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('bunker://') || trimmed.includes('@');
}

export function defaultBunkerRelays(): string[] {
  return DEFAULT_RELAYS;
}
