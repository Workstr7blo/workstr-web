import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent, Signer } from '../signer/types';
import { PRIVATE_RECORD_KIND, encodePrivateRecord, type PrivateRecord } from '../nostr/codecs30078';

export const PUBLISH_TIMEOUT_MS = 10000;
export const FETCH_TIMEOUT_MS = 15000;

// A policy rejection and a dead network need different user copy and different retry
// behaviour: one will never succeed unchanged, the other will succeed on its own.
export type PublishFailure = 'policy' | 'network';

export interface PublishOutcome {
  address: string;
  accepted: boolean;
  failure?: PublishFailure;
  reason: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// strfry answers a policy rejection with an `OK: false` whose message the plugin wrote.
// nostr-tools surfaces that as a rejection, while an unreachable relay resolves with a
// "connection failure:" string instead of rejecting — so neither signal alone is enough.
export function classifyPublish(result: PromiseSettledResult<string>): { accepted: boolean; failure?: PublishFailure; reason: string } {
  if (result.status === 'fulfilled') {
    const message = String(result.value || '');
    if (message.toLowerCase().startsWith('connection failure:')) return { accepted: false, failure: 'network', reason: message };
    return { accepted: true, reason: message || 'accepted' };
  }
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  const blocked = /^(blocked|invalid|rejected|error)\b/i.test(reason.trim());
  return { accepted: false, failure: blocked ? 'policy' : 'network', reason };
}

export async function publishRecord(signer: Signer, relayUrl: string, record: PrivateRecord, pool = new SimplePool(), ownPool = true): Promise<PublishOutcome> {
  try {
    const unsigned = await encodePrivateRecord(signer, record);
    const signed = await signer.signEvent(unsigned);
    const [publish] = pool.publish([relayUrl], signed as Parameters<typeof pool.publish>[1]);
    const settled = await Promise.allSettled([withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out')]);
    return { address: record.address, ...classifyPublish(settled[0]) };
  } catch (error) {
    // Signing was refused or timed out. Not the relay's doing, and retrying is right.
    return { address: record.address, accepted: false, failure: 'network', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (ownPool) pool.close([relayUrl]);
  }
}

// No AUTH handshake: the relay is open and a signature already binds authorship.
export async function fetchRecords(relayUrl: string, pubkey: string, pool = new SimplePool(), ownPool = true): Promise<SignedNostrEvent[]> {
  try {
    const events = await withTimeout(
      pool.querySync([relayUrl], { authors: [pubkey], kinds: [PRIVATE_RECORD_KIND] }, { maxWait: FETCH_TIMEOUT_MS }),
      FETCH_TIMEOUT_MS,
      'relay query timed out'
    );
    return events as unknown as SignedNostrEvent[];
  } finally {
    if (ownPool) pool.close([relayUrl]);
  }
}
