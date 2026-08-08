import type { Event } from 'nostr-tools';
import { SimplePool, verifyEvent } from 'nostr-tools';
import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { OPERATOR_LUD16, ZAP_RECEIPT_SIGNER_PUBKEY, ZAP_RELAYS } from '../core/funding';
import { OPERATOR_PUBKEY } from './canon';

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

function tagValue(tags: string[][], key: string): string {
  return (tags.find((tag) => tag[0] === key) || [])[1] || '';
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

// `lightning:` is the URI scheme wallets register for, and a bare lightning
// address is a valid payload for it.
export function lightningUri(address: string = OPERATOR_LUD16): string {
  return `lightning:${address}`;
}
