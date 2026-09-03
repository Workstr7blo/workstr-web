import { SimplePool, type VerifiedEvent } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44DecryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BunkerSigner, createNostrConnectURI, parseBunkerInput, type BunkerPointer } from 'nostr-tools/nip46';
import { PRIVATE_RECORD_KIND } from '../nostr/codecs30078';
import { CREATOR_PROGRAM_KIND } from '../nostr/creator-programs';
import { PAYMENT_TARGETS_KIND } from '../nostr/payment-targets';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

// Everything Workstr ever asks a signer to do, named as narrowly as NIP-46 allows.
// Requested once, at connection: a signer that has not been told up front asks the user
// about every request instead, and a backup is one request per record — several per month
// of training, twice over, since each record is encrypted and then signed.
//
// These kinds are the whole surface: 30078 is the encrypted sync record
// (`src/nostr/codecs30078.ts`), kind 1 the workout summary a user chooses to share
// (`src/nostr/share.ts`), kind 9734 the NIP-57 zap request a user signs before the app can
// request a creator invoice, 33402 a published creator program
// (`src/nostr/program-publish.ts`) and 10133 the public payment target
// (`src/nostr/payment-targets.ts`). Naming them rather than asking for blanket
// `sign_event` means a signer can show what it is granting, and Workstr cannot quietly
// sign anything else.
//
// Every kind the app signs has to be listed. A signer holds the user to what it was
// granted, so an unlisted kind is not a silent success: the request waits on a human who
// was never shown a prompt — the signer app is in a pocket, not in front of them — and the
// publish fails on a timeout with nothing to act on.
export const SIGNER_PERMS = [
  'get_public_key',
  'nip44_encrypt',
  'nip44_decrypt',
  `sign_event:${PRIVATE_RECORD_KIND}`,
  'sign_event:1',
  'sign_event:9734',
  `sign_event:${CREATOR_PROGRAM_KIND}`,
  `sign_event:${PAYMENT_TARGETS_KIND}`
];

const CLIENT_SECRET_KEY = 'workstr.nip46.clientSecret';
const CACHED_CONNECTION_KEY = 'workstr.nip46.connection';
const GRANTED_PERMS_KEY = 'workstr.nip46.grantedPerms';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const NOSTR_CONNECT_KIND = 24133;
const CONNECT_WAIT_MS = 300000;
const CONNECT_POLL_MS = 2000;

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
  ready: Promise<void>;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectionPointerFromEvent(event: VerifiedEvent, clientSecret: Uint8Array, connectionSecret: string, relays: string[]): BunkerPointer | null {
  try {
    const decrypted = nip44DecryptPayload(event.content, getConversationKey(clientSecret, event.pubkey));
    const response = JSON.parse(decrypted) as { result?: string };
    return response.result === connectionSecret ? { pubkey: event.pubkey, relays, secret: connectionSecret } : null;
  } catch {
    return null;
  }
}

async function waitForStoredConnectResponse(pool: SimplePool, clientSecret: Uint8Array, relays: string[], clientPubkey: string, connectionSecret: string, since: number, options: BunkerOptions): Promise<BunkerSigner> {
  const deadline = Date.now() + CONNECT_WAIT_MS;
  while (Date.now() < deadline) {
    const events = await pool.querySync(relays, { kinds: [NOSTR_CONNECT_KIND], '#p': [clientPubkey], since }, { maxWait: CONNECT_POLL_MS }).catch(() => [] as VerifiedEvent[]);
    for (const event of events as VerifiedEvent[]) {
      const pointer = connectionPointerFromEvent(event, clientSecret, connectionSecret, relays);
      if (!pointer) continue;
      const signer = BunkerSigner.fromBunker(clientSecret, pointer, { pool, onauth: options.onAuthUrl });
      await Promise.race([sleep(1000), signer.switchRelays()]);
      return signer;
    }
    await sleep(CONNECT_POLL_MS);
  }
  throw new Error('signer did not answer within 5 minutes');
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

// How long a request will wait for a permission grant to be extended before going out
// anyway. The grant needs a human on a signer app, so waiting for it outright would stall
// every request behind a tap that may never come; sending the request regardless only costs
// the prompt the user would have had before this existed.
const GRANT_UPGRADE_TIMEOUT_MS = 15000;

function clientMetadata(): string {
  return JSON.stringify({ name: 'Workstr', url: window.location.origin });
}

// The connect request is what carries `perms`, so it is also the only way to widen a grant
// on a connection that already exists. Params are [remote pubkey, secret, permissions,
// client metadata].
function sendConnect(signer: BunkerSigner, bunker: BunkerPointer): Promise<string> {
  return signer.sendRequest('connect', [bunker.pubkey, bunker.secret || '', SIGNER_PERMS.join(','), clientMetadata()]);
}

function rememberGrantedPerms(): void {
  try {
    localStorage.setItem(GRANTED_PERMS_KEY, SIGNER_PERMS.join(','));
  } catch {
    // Only costs a redundant connect on the next page load.
  }
}

function grantedPermsAreCurrent(): boolean {
  try {
    return localStorage.getItem(GRANTED_PERMS_KEY) === SIGNER_PERMS.join(',');
  } catch {
    return false;
  }
}

// A connection is granted the permissions asked for when it was made, and nothing widens it
// afterwards — so a release that starts signing a new kind leaves every already-connected
// signer unable to sign it, which is exactly how the public payment target failed: the
// request sat unanswered until it timed out, because the bunker was waiting on an approval
// no one was shown.
//
// Re-sending connect asks for the current list on the existing connection. It is tried once
// per signer instance and only while the remembered grant is out of date, so a user who
// approves it is never asked again.
function grantUpgrade(signer: BunkerSigner, bunker: BunkerPointer): () => Promise<void> {
  let attempt: Promise<void> | null = null;
  return () => {
    if (grantedPermsAreCurrent()) return Promise.resolve();
    if (!attempt) {
      const connected = sendConnect(signer, bunker).then(() => { rememberGrantedPerms(); }, () => undefined);
      // Capped rather than awaited: the answer may be a person picking up their phone, and
      // the request behind this is better off sent late than not at all.
      attempt = Promise.race([connected, sleep(GRANT_UPGRADE_TIMEOUT_MS)]).then(() => undefined);
    }
    return attempt;
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
  localStorage.removeItem(GRANTED_PERMS_KEY);
}

// Sign-out wipes every trace of the NIP-46 client: the cached connection, and the
// standalone client secret `clientSecretKey()` would otherwise keep reusing for the next
// connection — dead key material tied to the previous user's client identity.
export function clearNip46State(): void {
  localStorage.removeItem(CACHED_CONNECTION_KEY);
  localStorage.removeItem(CLIENT_SECRET_KEY);
  localStorage.removeItem(GRANTED_PERMS_KEY);
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
  // Not `signer.connect()`: nostr-tools sends an empty permission string there, which asks
  // the signer for nothing and leaves it prompting on every request afterwards.
  await sendConnect(signer, pointer);
  cacheConnection(secret, pointer);
  rememberGrantedPerms();

  return wrapBunkerSigner(signer, () => openRelays(pool, pointer.relays));
}

export function createNostrConnectSignerRequest(relays = DEFAULT_RELAYS, options: BunkerOptions = {}): NostrConnectRequest {
  // The remote signer authorizes this client pubkey. Persisting the client
  // secret lets Workstr recreate the same NIP-46 client after a tab/app close
  // instead of appearing connected while publish paths have no live signer.
  const secret = clientSecretKey();
  const clientPubkey = getPublicKey(secret);
  const connectionSecret = bytesToHex(generateSecretKey());
  const createdSince = Math.floor(Date.now() / 1000) - 60;
  const cleanRelays = relays.map((relay) => relay.trim()).filter(Boolean);
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: cleanRelays,
    secret: connectionSecret,
    name: 'Workstr',
    url: window.location.origin,
    perms: SIGNER_PERMS
  });
  const pool = new SimplePool();
  const ready = openRelays(pool, cleanRelays);
  return {
    uri,
    relays: cleanRelays,
    ready,
    signer: BunkerSigner.fromURI(secret, uri, { pool, onauth: options.onAuthUrl }, CONNECT_WAIT_MS)
      .catch(() => waitForStoredConnectResponse(pool, secret, cleanRelays, clientPubkey, connectionSecret, createdSince, options))
      .catch(() => { throw new Error('signer did not answer within 5 minutes'); }).then((signer) => {
      cacheConnection(secret, signer.bp);
      // The URI the signer scanned carried the current list, so the grant it approved is it.
      rememberGrantedPerms();
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
  const upgrade = grantUpgrade(signer, cached.bunker);
  // Every reconnection starts cold, and this is the path a stalled signer is rebuilt on,
  // so without the wait a retry loses its first answer exactly like the attempt before it.
  // The grant is widened in the same place and for the same reason: both have to happen
  // before a request goes out, or the request is the thing that discovers the problem.
  // A connection whose grant is current is left on exactly the path it was on before.
  const ready = (): Promise<void> => {
    const opening = openRelays(pool, cached.bunker.relays);
    return grantedPermsAreCurrent() ? opening : opening.then(upgrade);
  };
  return wrapBunkerSigner(signer, ready, knownPubkey);
}

export function isLikelyBunkerInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('bunker://') || trimmed.includes('@');
}

export function defaultBunkerRelays(): string[] {
  return DEFAULT_RELAYS;
}
