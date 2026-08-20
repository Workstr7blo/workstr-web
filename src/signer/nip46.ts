import { SimplePool, type VerifiedEvent } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BunkerSigner, createNostrConnectURI, parseBunkerInput, type BunkerPointer } from 'nostr-tools/nip46';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

const CLIENT_SECRET_KEY = 'workstr.nip46.clientSecret';
const CACHED_CONNECTION_KEY = 'workstr.nip46.connection';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

interface BunkerOptions {
  onAuthUrl?: (url: string) => void;
}

interface ConnectedBunkerSigner {
  pubkey: string;
  signer: Signer;
}

interface CachedConnection {
  clientSecret: string;
  bunker: BunkerPointer;
}

interface NostrConnectRequest {
  uri: string;
  relays: string[];
  signer: Promise<ConnectedBunkerSigner>;
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

// `knownPubkey` is the key this device is already signed in as. Asking the bunker to
// repeat it costs a full round trip out to a signer app and back, and it is the first call
// of every sync pass — so on a connection that has gone quiet it is also the call that
// fails, reporting a stalled signer as a problem with reading a public key.
function wrapBunkerSigner(signer: BunkerSigner, knownPubkey?: string): Signer {
  return {
    type: 'nip46',
    getPublicKey: () => (knownPubkey ? Promise.resolve(knownPubkey) : signer.getPublicKey()),
    signEvent: (event: UnsignedNostrEvent) => signer.signEvent(event).then(toSigned),
    nip44Encrypt: (peerPubkey, plaintext) => signer.nip44Encrypt(peerPubkey, plaintext),
    nip44Decrypt: (peerPubkey, ciphertext) => signer.nip44Decrypt(peerPubkey, ciphertext)
  };
}

function cacheConnection(clientSecret: Uint8Array, bunker: BunkerPointer): void {
  localStorage.setItem(CACHED_CONNECTION_KEY, JSON.stringify({
    clientSecret: bytesToHex(clientSecret),
    bunker
  } satisfies CachedConnection));
}

function readCachedConnection(): CachedConnection | null {
  try {
    const raw = localStorage.getItem(CACHED_CONNECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedConnection;
    const validSecret = /^[a-f0-9]{64}$/i.test(parsed.clientSecret || '');
    const validBunker = parsed.bunker
      && /^[a-f0-9]{64}$/i.test(parsed.bunker.pubkey || '')
      && Array.isArray(parsed.bunker.relays)
      && parsed.bunker.relays.length > 0;
    return validSecret && validBunker ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCachedNip46Signer(): void {
  localStorage.removeItem(CACHED_CONNECTION_KEY);
}

export async function createBunkerSigner(input: string, options: BunkerOptions = {}): Promise<Signer> {
  const pointer = await parseBunkerInput(input.trim());
  if (!pointer) {
    throw new Error('Invalid bunker URL or NIP-05 identifier');
  }

  const secret = clientSecretKey();
  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(secret, pointer, { pool, onauth: options.onAuthUrl });
  await signer.connect({
    name: 'Workstr',
    url: window.location.origin
  });
  cacheConnection(secret, pointer);

  return wrapBunkerSigner(signer);
}

export function createNostrConnectSignerRequest(relays = DEFAULT_RELAYS, options: BunkerOptions = {}): NostrConnectRequest {
  // The remote signer authorizes this client pubkey. Persisting the client
  // secret lets Workstr recreate the same NIP-46 client after a tab/app close
  // instead of appearing connected while publish paths have no live signer.
  const secret = clientSecretKey();
  const clientPubkey = getPublicKey(secret);
  const connectionSecret = bytesToHex(generateSecretKey());
  const cleanRelays = relays.map((relay) => relay.trim()).filter(Boolean);
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: cleanRelays,
    secret: connectionSecret,
    name: 'Workstr',
    url: window.location.origin,
    perms: ['get_public_key', 'sign_event', 'nip44_encrypt', 'nip44_decrypt']
  });
  const pool = new SimplePool();
  return {
    uri,
    relays: cleanRelays,
    signer: BunkerSigner.fromURI(secret, uri, { pool, onauth: options.onAuthUrl }, 300000).then((signer) => {
      cacheConnection(secret, signer.bp);
      return {
        pubkey: signer.bp.pubkey,
        signer: wrapBunkerSigner(signer)
      };
    })
  };
}

// Rebuilt rather than reused when a connection stalls: the subscription this opens is the
// only path a bunker's answers come back on, and a websocket that died while the app was
// backgrounded leaves the signer looking connected while nothing it is asked ever returns.
export function createCachedNip46Signer(knownPubkey?: string, options: BunkerOptions = {}): Signer | null {
  const cached = readCachedConnection();
  if (!cached) return null;
  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(hexToBytes(cached.clientSecret), cached.bunker, { pool, onauth: options.onAuthUrl });
  return wrapBunkerSigner(signer, knownPubkey);
}

export function isLikelyBunkerInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('bunker://') || trimmed.includes('@');
}

export function defaultBunkerRelays(): string[] {
  return DEFAULT_RELAYS;
}
