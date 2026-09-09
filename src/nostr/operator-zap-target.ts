import { SimplePool, verifyEvent } from 'nostr-tools';
import { OPERATOR_LUD16, ZAP_RELAYS } from '../core/funding';
import { OPERATOR_PUBKEY } from './canon';
import { decodeLnurl, lud16ToLnurlPayEndpoint } from './lnurl';

const QUERY_TIMEOUT_MS = 7000;
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

export interface OperatorZapAddress {
  lud16?: string;
  lud06?: string;
  endpoint: string;
}

export interface OperatorZapTarget extends OperatorZapAddress {
  callback: string;
  receiptSignerPubkey: string;
  minSendable?: number;
  maxSendable?: number;
}

export interface LnurlPayMetadata {
  callback?: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  minSendable?: number;
  maxSendable?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('zap target query timed out')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export function operatorZapAddressFromProfile(content: string): OperatorZapAddress | null {
  try {
    const profile = JSON.parse(content || '{}') as { lud16?: unknown; lud06?: unknown };
    const lud16 = typeof profile.lud16 === 'string' ? profile.lud16.trim() : '';
    const lud06 = typeof profile.lud06 === 'string' ? profile.lud06.trim() : '';
    if (lud16) {
      const endpoint = lud16ToLnurlPayEndpoint(lud16);
      if (endpoint) return { lud16, endpoint };
    }
    if (lud06) {
      const endpoint = decodeLnurl(lud06);
      if (endpoint) return { lud06, endpoint };
    }
  } catch {
    return null;
  }
  return null;
}

export function operatorZapTargetFromMetadata(address: OperatorZapAddress, metadata: LnurlPayMetadata): OperatorZapTarget | null {
  if (!metadata.callback || metadata.allowsNostr !== true || !metadata.nostrPubkey || !HEX_PUBKEY.test(metadata.nostrPubkey)) {
    return null;
  }
  return {
    ...address,
    callback: metadata.callback,
    receiptSignerPubkey: metadata.nostrPubkey.toLowerCase(),
    minSendable: metadata.minSendable,
    maxSendable: metadata.maxSendable
  };
}

async function fetchOperatorZapAddress(relays = ZAP_RELAYS): Promise<OperatorZapAddress> {
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(relays.map(async (relay) => {
      await withTimeout(pool.ensureRelay(relay));
      return withTimeout(pool.querySync([relay], { kinds: [0], authors: [OPERATOR_PUBKEY], limit: 10 }));
    }));
    const profiles = results
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .filter((event) => event.kind === 0 && event.pubkey === OPERATOR_PUBKEY && verifyEvent(event))
      .sort((a, b) => b.created_at - a.created_at);
    for (const profile of profiles) {
      const address = operatorZapAddressFromProfile(profile.content);
      if (address) return address;
    }
  } finally {
    pool.close(relays);
  }
  const endpoint = lud16ToLnurlPayEndpoint(OPERATOR_LUD16);
  if (!endpoint) throw new Error('operator zap metadata unavailable');
  return { lud16: OPERATOR_LUD16, endpoint };
}

export async function fetchOperatorZapTarget(options: { fetch?: typeof fetch; relays?: string[] } = {}): Promise<OperatorZapTarget> {
  const address = await fetchOperatorZapAddress(options.relays);
  const response = await (options.fetch ?? fetch)(address.endpoint);
  if (!response.ok) throw new Error('operator zap target unreachable');
  const metadata = await response.json() as LnurlPayMetadata;
  const target = operatorZapTargetFromMetadata(address, metadata);
  if (!target) throw new Error('operator zap target does not support Nostr receipts');
  return target;
}
