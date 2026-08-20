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

// A BunkerSigner opens the subscription its answers arrive on and then publishes the
// request straight away, both on sockets that are still being dialled. A permissioned
// signer answers immediately, so on a cold connection the answer reaches the relay before
// the subscription does — and an answer nobody is listening for is gone for good. The
// request itself lands, which is why the signer app shows it handled while the client sits
// there until it times out.
//
// Waiting on the same relay connections the subscription is waiting on fixes the order:
// `subscribe` asked for them first, so its REQ is on the wire before this resolves and
// before any request that needs an answer is published.
// How long that is worth waiting for. A request sent late still gets an answer; a request
// never sent cannot, so this wait is capped on every path rather than trusted to end.
const RELAY_OPEN_TIMEOUT_MS = 4000;

async function openRelays(pool: SimplePool, relays: string[]): Promise<void> {
  // `connectionTimeout` is not optional in practice: nostr-tools only arms a timer when it
  // is given one, so a socket that stalls mid-handshake — routine on a phone — leaves the
  // connection pending for good. Waiting on that means never sending the request at all.
  const opening = relays.map((relay) => pool.ensureRelay(relay, { connectionTimeout: RELAY_OPEN_TIMEOUT_MS }));
  // Rejections are expected and handled by the cap below, not by failing the wait.
  opening.forEach((attempt) => attempt.catch(() => null));
  await Promise.race([
    // One open relay is enough to receive an answer, and waiting for the slowest of them
    // would let a single bad relay decide when anything gets sent.
    Promise.any(opening).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, RELAY_OPEN_TIMEOUT_MS))
  ]);
}

// `knownPubkey` is the key this device is already signed in as. Asking the bunker to
// repeat it costs a full round trip out to a signer app and back, and it is the first call
// of every sync pass — so on a connection that has gone quiet it is also the call that
// fails, reporting a stalled signer as a problem with reading a public key.
function wrapBunkerSigner(signer: BunkerSigner, ready: () => Promise<void>, knownPubkey?: string): Signer {
  // Before every request, not only the first. A connection that carried one record and
  // then dropped — a relay closing an idle or rate-limited socket is ordinary — leaves
  // nostr-tools to re-open the subscription inside the next `sendRequest` and publish
  // immediately after it, which is the same lost-answer race as a cold start, one record
  // in. Re-opening here first means the subscription goes out on a socket that is already
  // up. On a healthy connection this resolves at once and costs nothing.
  const whenReady = <T>(run: () => Promise<T>): Promise<T> => ready().then(run);
  return {
    type: 'nip46',
    getPublicKey: () => (knownPubkey ? Promise.resolve(knownPubkey) : whenReady(() => signer.getPublicKey())),
    signEvent: (event: UnsignedNostrEvent) => whenReady(() => signer.signEvent(event).then(toSigned)),
    nip44Encrypt: (peerPubkey, plaintext) => whenReady(() => signer.nip44Encrypt(peerPubkey, plaintext)),
    nip44Decrypt: (peerPubkey, ciphertext) => whenReady(() => signer.nip44Decrypt(peerPubkey, ciphertext))
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
  // Before `connect`, not after: that request needs an answer like any other.
  await openRelays(pool, pointer.relays);
  await signer.connect({
    name: 'Workstr',
    url: window.location.origin
  });
  cacheConnection(secret, pointer);

  return wrapBunkerSigner(signer, () => openRelays(pool, pointer.relays));
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
        signer: wrapBunkerSigner(signer, () => openRelays(pool, signer.bp.relays))
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
  // Every reconnection starts cold, and this is the path a stalled signer is rebuilt on,
  // so without the wait a retry loses its first answer exactly like the attempt before it.
  return wrapBunkerSigner(signer, () => openRelays(pool, cached.bunker.relays), knownPubkey);
}

export function isLikelyBunkerInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('bunker://') || trimmed.includes('@');
}

export function defaultBunkerRelays(): string[] {
  return DEFAULT_RELAYS;
}
