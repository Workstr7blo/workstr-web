import { SimplePool, type VerifiedEvent } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from 'nostr-tools/nip46';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

const CLIENT_SECRET_KEY = 'workstr.nip46.clientSecret';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

interface BunkerOptions {
  onAuthUrl?: (url: string) => void;
}

interface NostrConnectRequest {
  uri: string;
  relays: string[];
  signer: Promise<Signer>;
}

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

function wrapBunkerSigner(signer: BunkerSigner): Signer {
  return {
    type: 'nip46',
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event: UnsignedNostrEvent) => signer.signEvent(event).then(toSigned),
    nip44Encrypt: (peerPubkey, plaintext) => signer.nip44Encrypt(peerPubkey, plaintext),
    nip44Decrypt: (peerPubkey, ciphertext) => signer.nip44Decrypt(peerPubkey, ciphertext)
  };
}

export async function createBunkerSigner(input: string, options: BunkerOptions = {}): Promise<Signer> {
  const pointer = await parseBunkerInput(input.trim());
  if (!pointer) {
    throw new Error('Invalid bunker URL or NIP-05 identifier');
  }

  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(clientSecretKey(), pointer, { pool, onauth: options.onAuthUrl });
  await signer.connect({
    name: 'Workstr Web',
    url: window.location.origin
  });

  return wrapBunkerSigner(signer);
}

export function createNostrConnectSignerRequest(relays = DEFAULT_RELAYS, options: BunkerOptions = {}): NostrConnectRequest {
  const secret = generateSecretKey();
  const clientPubkey = getPublicKey(secret);
  const connectionSecret = bytesToHex(generateSecretKey());
  const cleanRelays = relays.map((relay) => relay.trim()).filter(Boolean);
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: cleanRelays,
    secret: connectionSecret,
    name: 'Workstr Web',
    url: window.location.origin,
    perms: ['get_public_key', 'sign_event', 'nip44_encrypt', 'nip44_decrypt']
  });
  const pool = new SimplePool();
  return {
    uri,
    relays: cleanRelays,
    signer: BunkerSigner.fromURI(secret, uri, { pool, onauth: options.onAuthUrl }, 300000).then(wrapBunkerSigner)
  };
}

export function isLikelyBunkerInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('bunker://') || trimmed.includes('@');
}

export function defaultBunkerRelays(): string[] {
  return DEFAULT_RELAYS;
}
