import type { Event } from 'nostr-tools';
import { SimplePool, verifyEvent } from 'nostr-tools';
import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { ZAP_RECEIPT_SIGNER_PUBKEY, ZAP_RELAYS } from '../core/funding';
import { OPERATOR_PUBKEY, type RelayProgram } from './canon';
import { DEFAULT_PUBLIC_RELAYS } from './pool';

const QUERY_TIMEOUT_MS = 7000;
const RECEIPT_LIMIT = 500;

export interface ZapReceipt {
  id: string;
  sats: number;
  createdAt: number;
  senderPubkey?: string;
}

export interface FundingTotals {
  sats: number;
  count: number;
  costSats: number;
  percent: number;
}

export type ZapRecipientErrorCode =
  | 'unsupported-program'
  | 'missing-pubkey'
  | 'malformed-pubkey'
  | 'missing-lnurl'
  | 'malformed-lnurl'
  | 'malformed-relay'
  | 'malformed-address';

export interface RecipientDescriptor {
  pubkey: string;
  relay: string;
  relays: string[];
  lnurl: string;
  app: 'workstr';
  lud16?: string;
  lud06?: string;
  programAddress: string;
}

export interface ZapRecipientResolutionError {
  code: ZapRecipientErrorCode;
  message: string;
  field?: string;
}

export type ZapRecipientResolutionResult =
  | { ok: true; recipient: RecipientDescriptor }
  | { ok: false; error: ZapRecipientResolutionError };

export type WorkoutProgramZapSource = RelayProgram & {
  // Downstream NWC flow resolves these from the author's kind:0 metadata before
  // calling this pure validator. Keeping the fields optional lets existing
  // catalog/local program models keep working until that metadata is present.
  lud16?: string;
  lud06?: string;
  zapRecipient?: {
    pubkey?: string;
    relay?: string;
    relays?: string[];
    lnurl?: string;
    lud16?: string;
    lud06?: string;
    app?: string;
  };
};

function tagValue(tags: string[][], key: string): string {
  return (tags.find((tag) => tag[0] === key) || [])[1] || '';
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const LUD16 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LUD06 = /^lnurl1[02-9ac-hj-np-z]+$/i;

function fail(code: ZapRecipientErrorCode, message: string, field?: string): ZapRecipientResolutionResult {
  return { ok: false, error: { code, message, field } };
}

function isRelayUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
  } catch {
    return false;
  }
}

function normalizedRelays(relays: string[] | undefined, fallback: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const relay of (relays?.length ? relays : fallback).map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(relay)) continue;
    seen.add(relay);
    out.push(relay);
  }
  return out;
}

function isLocalProgramAddress(value: string): boolean {
  return !value || value.startsWith('local:');
}

function validateProgramAddress(address: string, pubkey: string): ZapRecipientResolutionResult | null {
  if (isLocalProgramAddress(address)) {
    return fail('unsupported-program', 'Only published Nostr workout programs can be zapped.', 'address');
  }
  const parts = address.split(':');
  const [kind, addressPubkey, ...dTagParts] = parts;
  if (kind !== '33402' || !HEX_PUBKEY.test(addressPubkey || '') || !dTagParts.join(':')) {
    return fail('malformed-address', 'Workout program address must be a NIP-101e kind:33402 address.', 'address');
  }
  if (addressPubkey.toLowerCase() !== pubkey.toLowerCase()) {
    return fail('malformed-address', 'Workout program address author does not match the recipient pubkey.', 'address');
  }
  return null;
}

function resolveLnurl(program: WorkoutProgramZapSource): { lnurl: string; lud16?: string; lud06?: string } | null {
  const lud16 = (program.zapRecipient?.lud16 || program.lud16 || '').trim();
  const lud06 = (program.zapRecipient?.lud06 || program.lud06 || '').trim();
  const lnurl = (program.zapRecipient?.lnurl || lud16 || lud06).trim();
  if (!lnurl) return null;
  return { lnurl, lud16: lud16 || (LUD16.test(lnurl) ? lnurl : undefined), lud06: lud06 || (LUD06.test(lnurl) ? lnurl : undefined) };
}

export function resolveWorkoutProgramZapRecipient(program: WorkoutProgramZapSource): ZapRecipientResolutionResult {
  try {
    const pubkey = (program.zapRecipient?.pubkey || program.pubkey || '').trim();
    if (!pubkey) return fail('missing-pubkey', 'Workout program is missing an author pubkey.', 'pubkey');
    if (!HEX_PUBKEY.test(pubkey)) return fail('malformed-pubkey', 'Workout program author pubkey must be 64 hex characters.', 'pubkey');

    const addressError = validateProgramAddress((program.address || '').trim(), pubkey);
    if (addressError) return addressError;

    const target = resolveLnurl(program);
    if (!target) return fail('missing-lnurl', 'Workout program author is missing lud16/lud06 zap metadata.', 'lnurl');
    if (!LUD16.test(target.lnurl) && !LUD06.test(target.lnurl)) {
      return fail('malformed-lnurl', 'Workout program zap metadata must be a Lightning address or lud06 LNURL.', 'lnurl');
    }

    const relays = normalizedRelays(
      program.zapRecipient?.relays?.length ? program.zapRecipient.relays : program.zapRecipient?.relay ? [program.zapRecipient.relay] : undefined,
      DEFAULT_PUBLIC_RELAYS
    );
    if (!relays.length || relays.some((relay) => !isRelayUrl(relay))) {
      return fail('malformed-relay', 'Workout program zap recipient relays must be ws:// or wss:// URLs.', 'relay');
    }

    return {
      ok: true,
      recipient: {
        pubkey: pubkey.toLowerCase(),
        relay: relays[0],
        relays,
        lnurl: target.lnurl,
        lud16: target.lud16,
        lud06: target.lud06,
        app: 'workstr',
        programAddress: program.address
      }
    };
  } catch {
    return fail('unsupported-program', 'Workout program zap recipient metadata could not be resolved.');
  }
}

export interface ReceiptTrust {
  recipient?: string;
  signer?: string;
}

// A zap receipt is a claim about money, published by a third party, so it is
// only worth counting if it is genuinely from the operator's wallet provider.
// Anyone can publish a kind:9735 tagged to any pubkey; without the signer
// check the funding panel would be a number strangers control.
export function parseZapReceipt(event: Event, trust: ReceiptTrust = {}): ZapReceipt | null {
  const recipient = trust.recipient ?? OPERATOR_PUBKEY;
  const signer = trust.signer ?? ZAP_RECEIPT_SIGNER_PUBKEY;
  if (event.kind !== 9735) return null;
  if (event.pubkey !== signer) return null;
  if (tagValue(event.tags as string[][], 'p') !== recipient) return null;
  if (!verifyEvent(event)) return null;

  const bolt11 = tagValue(event.tags as string[][], 'bolt11');
  if (!bolt11) return null;
  let sats = 0;
  try {
    sats = getSatoshisAmountFromBolt11(bolt11);
  } catch {
    return null;
  }
  // A zero-amount or unparseable invoice tells us nothing; counting it as 0
  // is harmless but counting a NaN would poison the total.
  if (!Number.isFinite(sats) || sats <= 0) return null;

  let senderPubkey: string | undefined;
  try {
    const request = JSON.parse(tagValue(event.tags as string[][], 'description') || '{}');
    if (typeof request?.pubkey === 'string') senderPubkey = request.pubkey;
  } catch {
    // A malformed zap request costs us the sender's identity, not the amount.
  }

  return { id: event.id, sats, createdAt: event.created_at, senderPubkey };
}

// Relays are queried in parallel and return overlapping sets, so identity is
// the event id.
export function collectZapReceipts(events: Event[], trust: ReceiptTrust = {}): ZapReceipt[] {
  const byId = new Map<string, ZapReceipt>();
  for (const event of events) {
    const receipt = parseZapReceipt(event, trust);
    if (receipt && !byId.has(receipt.id)) byId.set(receipt.id, receipt);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// Start of the current calendar month, in unix seconds and local time — the
// panel says "this month", so it should mean the user's month.
export function monthStartUnix(now: Date = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime() / 1000);
}

export function fundingTotals(receipts: ZapReceipt[], costSats: number): FundingTotals {
  const sats = receipts.reduce((total, receipt) => total + receipt.sats, 0);
  return {
    sats,
    count: receipts.length,
    costSats,
    percent: costSats > 0 ? Math.min(100, Math.round((sats / costSats) * 100)) : 0
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('zap relay query timed out')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

// Every relay is queried with its own timeout; partial failure is fine, total
// failure throws so the UI can say "could not reach relays" instead of
// reporting zero donations, which would be a different and much worse lie.
//
// The connection is established explicitly first, because querySync resolves
// with an empty array when a relay cannot be reached rather than rejecting —
// the same trap documented for publish in share.ts. Without ensureRelay, an
// offline client reports "0 sats received", which is precisely the false
// statement this function exists to avoid.
export async function fetchMonthlyZapReceipts(since = monthStartUnix()): Promise<ZapReceipt[]> {
  const pool = new SimplePool();
  try {
    const filter = { kinds: [9735], '#p': [OPERATOR_PUBKEY], since, limit: RECEIPT_LIMIT };
    const results = await Promise.allSettled(ZAP_RELAYS.map(async (relay) => {
      await withTimeout(pool.ensureRelay(relay));
      return withTimeout(pool.querySync([relay], filter));
    }));
    if (results.every((result) => result.status === 'rejected')) throw new Error('no relay reachable');
    const merged = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return collectZapReceipts(merged);
  } finally {
    pool.close(ZAP_RELAYS);
  }
}
