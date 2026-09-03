import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { DEFAULT_PUBLIC_RELAYS } from './pool';

// NIP-A3 public payment targets. `kind:10133` is a replaceable event whose `payto` tags
// advertise where an author can be paid, so it is read for other people's programs and
// written for the current user.
//
// This module is deliberately Monero-only. A `kind:10133` event may also carry Lightning
// targets, but Workstr resolves Lightning zap recipients from `kind:0` `lud16`/`lud06` and
// must keep doing so — treating a NIP-A3 Lightning target as a zap recipient would silently
// redirect payments away from where NIP-57 says they go.
export const PAYMENT_TARGETS_KIND = 10133;
export const PAYTO_TAG = 'payto';

// NIP-A3 names Monero `monero`. `xmr` is accepted when reading, because other clients may
// already have published it, but Workstr always writes the canonical form.
export const MONERO_METHOD = 'monero';
const MONERO_METHOD_ALIASES = ['monero', 'xmr'];

const FETCH_TIMEOUT_MS = 5000;
const AUTHOR_BATCH_SIZE = 40;
const SIGN_TIMEOUT_MS = 120000;
const PUBLISH_TIMEOUT_MS = 8000;

export interface PaymentTargetsPool {
  get(relays: string[], filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  publish(relays: string[], event: SignedNostrEvent): Array<Promise<string>>;
  close(relays: string[]): void;
}

export interface PublishPaymentTargetResult {
  event: SignedNostrEvent;
  okRelays: string[];
  failedRelays: string[];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export function paymentTargetRelays(configured: string[] = []): string[] {
  return [...new Set([...configured, ...DEFAULT_PUBLIC_RELAYS].map((relay) => relay.trim()).filter(Boolean))];
}

function isMoneroMethod(value: unknown): boolean {
  return typeof value === 'string' && MONERO_METHOD_ALIASES.includes(value.trim().toLowerCase());
}

function isPaytoTag(tag: unknown): tag is string[] {
  return Array.isArray(tag) && typeof tag[0] === 'string' && tag[0] === PAYTO_TAG;
}

// Liberal on the way in: an address published by another client is theirs, not ours, and
// rejecting an unfamiliar-but-valid form would hide a creator's tip target. Whitespace is
// the one thing that cannot be part of an address, and it is how a malformed tag usually
// arrives. Callers that need a stricter check before *writing* use looksLikeMoneroAddress.
function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  return trimmed;
}

// Mainnet standard/subaddresses are 95 characters and integrated addresses 106, over the
// Base58 alphabet, leading `4` or `8`. Exported for the Settings UI to warn before
// publishing; the parser stays lenient on purpose.
export function looksLikeMoneroAddress(value: string): boolean {
  const address = value.trim();
  if (address.length !== 95 && address.length !== 106) return false;
  return /^[48][1-9A-HJ-NP-Za-km-z]+$/.test(address);
}

/**
 * The Monero address advertised by a `kind:10133` event, or null when it carries none.
 * With more than one Monero target, the first valid tag in event order wins — arbitrary but
 * deterministic, so every client that reads the event agrees on the answer.
 */
export function parseMoneroPaymentTarget(event: Pick<SignedNostrEvent, 'kind' | 'tags'> | null | undefined): string | null {
  if (!event || event.kind !== PAYMENT_TARGETS_KIND || !Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (!isPaytoTag(tag) || !isMoneroMethod(tag[1])) continue;
    const address = normalizeAddress(tag[2]);
    if (address) return address;
  }
  return null;
}

/**
 * Replace the Monero target in a tag list, preserving everything else.
 *
 * Workstr is not the exclusive owner of the user's `kind:10133`: it may hold targets for
 * other methods, or tags Workstr knows nothing about, and replaceable events overwrite
 * wholesale. So the existing tags are carried through and only Monero/XMR `payto` entries
 * are dropped. An empty address clears the target without touching the rest.
 */
export function withMoneroPaymentTarget(existingTags: string[][] = [], address: string): string[][] {
  const preserved = (existingTags || []).filter((tag) => !(isPaytoTag(tag) && isMoneroMethod(tag[1])));
  const next = normalizeAddress(address);
  return next ? [...preserved, [PAYTO_TAG, MONERO_METHOD, next]] : preserved;
}

export function buildPaymentTargetsEvent(existingTags: string[][] = [], address: string): UnsignedNostrEvent {
  return {
    kind: PAYMENT_TARGETS_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: withMoneroPaymentTarget(existingTags, address),
    content: ''
  };
}

async function queryPaymentTargetsEvent(relays: string[], pubkey: string, timeoutMs: number): Promise<SignedNostrEvent | null> {
  const pool = new SimplePool();
  try {
    // Connections are opened first, and explicitly. `pool.get` resolves null both when the
    // author publishes no event and when not one relay could be reached, and the caller
    // must not confuse those: a browser that is simply offline would otherwise be told the
    // user has no payment targets, and the next publish would overwrite the ones it never
    // managed to read.
    const connections = await Promise.allSettled(relays.map((relay) => withTimeout(
      pool.ensureRelay(relay, { connectionTimeout: timeoutMs }),
      timeoutMs,
      `${relay} did not answer`
    )));
    const reachable = relays.filter((_relay, index) => connections[index].status === 'fulfilled');
    if (!reachable.length) throw new Error('no relay could be reached for the payment target lookup');
    return await withTimeout(
      pool.get(reachable, { kinds: [PAYMENT_TARGETS_KIND], authors: [pubkey] }) as Promise<SignedNostrEvent | null>,
      timeoutMs,
      'payment target lookup timed out'
    );
  } finally {
    pool.close(relays);
  }
}

// One relay query for many authors, so opening Discover in Monero Mode costs a single
// round trip rather than one per card. `kind:10133` is replaceable, so relays may still
// answer with more than one event per author when they disagree about which is current;
// the newest `created_at` wins, the same rule a relay applies itself.
async function queryAuthorPaymentTargets(relays: string[], pubkeys: string[], timeoutMs: number): Promise<SignedNostrEvent[]> {
  const pool = new SimplePool();
  try {
    return await withTimeout(
      pool.querySync(relays, { kinds: [PAYMENT_TARGETS_KIND], authors: pubkeys }, { maxWait: timeoutMs }) as Promise<SignedNostrEvent[]>,
      timeoutMs,
      'payment target lookup timed out'
    );
  } finally {
    pool.close(relays);
  }
}

export interface PaymentTargetLookupOptions {
  timeoutMs?: number;
  query?: typeof queryPaymentTargetsEvent;
}

export interface AuthorPaymentTargetsOptions {
  timeoutMs?: number;
  query?: typeof queryAuthorPaymentTargets;
  /** Authors per relay query. Relays cap filter sizes, so a long Discover list is chunked. */
  batchSize?: number;
}

/**
 * The author's latest `kind:10133`.
 *
 * Rejects when no relay answered, rather than resolving null, so a caller can tell "this
 * author publishes no Monero target" from "we could not reach anyone". Publishing depends on
 * that difference: treating an unreachable relay as an empty event would drop the user's
 * other payment targets on the next write.
 */
export async function fetchPaymentTargetsEvent(
  pubkey: string,
  relays: string[] = DEFAULT_PUBLIC_RELAYS,
  options: PaymentTargetLookupOptions = {}
): Promise<SignedNostrEvent | null> {
  const query = options.query || queryPaymentTargetsEvent;
  return query(paymentTargetRelays(relays), pubkey, options.timeoutMs ?? FETCH_TIMEOUT_MS);
}

/**
 * The author's Monero address, or null. Never throws: this feeds card rendering, and a relay
 * outage must leave local training and the catalog working rather than surface an error.
 */
export async function fetchMoneroPaymentTarget(
  pubkey: string,
  relays: string[] = DEFAULT_PUBLIC_RELAYS,
  options: PaymentTargetLookupOptions = {}
): Promise<string | null> {
  try {
    return parseMoneroPaymentTarget(await fetchPaymentTargetsEvent(pubkey, relays, options));
  } catch {
    return null;
  }
}

/**
 * The Monero address of each author, keyed by pubkey.
 *
 * An author the relays answered for but who advertises no Monero target maps to null, which
 * is what lets a caller cache "asked, and there is none" and stop asking. An author whose
 * batch failed is absent from the result entirely rather than null — the difference is a
 * card that shows no tip action for a moment against one that hides it until the next
 * reload.
 *
 * Never throws. A relay outage must leave Discover rendering.
 */
export async function fetchAuthorMoneroPaymentTargets(
  pubkeys: string[],
  relays: string[] = DEFAULT_PUBLIC_RELAYS,
  options: AuthorPaymentTargetsOptions = {}
): Promise<Record<string, string | null>> {
  const authors = [...new Set(pubkeys.filter(Boolean))];
  if (!authors.length) return {};
  const query = options.query || queryAuthorPaymentTargets;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const size = Math.max(1, options.batchSize ?? AUTHOR_BATCH_SIZE);
  const lookups = relays.length ? paymentTargetRelays(relays) : paymentTargetRelays();
  const batches: string[][] = [];
  for (let at = 0; at < authors.length; at += size) batches.push(authors.slice(at, at + size));

  const answered = await Promise.allSettled(batches.map((batch) => query(lookups, batch, timeoutMs)));
  const targets: Record<string, string | null> = {};
  const newest: Record<string, number> = {};
  answered.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    // Only a batch that answered may report an absence, so the ones that failed leave their
    // authors unknown and are asked again on the next refresh.
    for (const pubkey of batches[index]) targets[pubkey] = targets[pubkey] ?? null;
    for (const event of result.value || []) {
      const pubkey = event?.pubkey;
      if (!pubkey || !(pubkey in targets)) continue;
      if ((event.created_at || 0) < (newest[pubkey] ?? 0)) continue;
      newest[pubkey] = event.created_at || 0;
      targets[pubkey] = parseMoneroPaymentTarget(event) ?? null;
    }
  });
  return targets;
}

function publishReason(result?: PromiseSettledResult<string>): string {
  if (!result) return 'no result from relay';
  if (result.status === 'fulfilled') return result.value || 'accepted';
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

// A relay that fulfils with a "connection failure:" message never saw the event, so it is a
// failure despite the resolved promise. Mirrors the check in program-publish.ts; kept local
// so the payment layer does not import the creator-program module graph.
//
// Tolerates a missing result: a pool that returns fewer promises than relays has not
// published to the remainder, and that counts as a failure rather than a crash.
function isAccepted(result?: PromiseSettledResult<string>): boolean {
  return !!result && result.status === 'fulfilled' && !result.value.toLowerCase().startsWith('connection failure:');
}

export interface PublishMoneroPaymentTargetOptions {
  relays?: string[];
  /** Latest known event. Omit to look it up first, which is what preserves other targets. */
  existing?: SignedNostrEvent | null;
  lookup?: PaymentTargetLookupOptions;
  poolFactory?: () => PaymentTargetsPool;
}

/**
 * Publish the current user's Monero payment target, preserving any unrelated `payto` tags.
 *
 * Pass an empty address to clear it. Throws when the existing event cannot be read or when
 * no relay accepted the write, so the caller can report a failure instead of assuming the
 * address is live.
 */
export async function publishMoneroPaymentTarget(
  signer: Signer,
  address: string,
  options: PublishMoneroPaymentTargetOptions = {}
): Promise<PublishPaymentTargetResult> {
  const relays = paymentTargetRelays(options.relays ?? DEFAULT_PUBLIC_RELAYS);
  if (!relays.length) throw new Error('no public relays configured for payment targets');

  const existing = options.existing !== undefined
    ? options.existing
    : await fetchPaymentTargetsEvent(await signer.getPublicKey(), relays, options.lookup);

  const signed = await withTimeout(
    signer.signEvent(buildPaymentTargetsEvent(existing?.tags ?? [], address)),
    SIGN_TIMEOUT_MS,
    'signer approval timed out'
  );

  const pool = options.poolFactory?.() || (new SimplePool() as unknown as PaymentTargetsPool);
  try {
    const results = await Promise.allSettled(
      pool.publish(relays, signed).map((publish) => withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out'))
    );
    const okRelays = relays.filter((_relay, index) => isAccepted(results[index]));
    const failedRelays = relays.filter((_relay, index) => !isAccepted(results[index]));
    if (!okRelays.length) {
      const index = relays.findIndex((_relay, at) => !isAccepted(results[at]));
      throw new Error(`no relay accepted the payment target (${relays[index]}: ${publishReason(results[index])})`);
    }
    return { event: signed, okRelays, failedRelays };
  } finally {
    pool.close(relays);
  }
}
