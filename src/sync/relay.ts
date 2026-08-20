import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent, Signer } from '../signer/types';
import { PRIVATE_RECORD_KIND, encodePrivateRecord, type PrivateRecord } from '../nostr/codecs30078';

export const PUBLISH_TIMEOUT_MS = 10000;
export const FETCH_TIMEOUT_MS = 15000;

// A policy rejection, a dead network and an unresponsive signer need different user copy
// and different retry behaviour: the first will never succeed unchanged, the second
// succeeds on its own, and the third needs the person to go and open their signer app.
export type PublishFailure = 'policy' | 'network' | 'signer';

export interface PublishOutcome {
  address: string;
  accepted: boolean;
  failure?: PublishFailure;
  reason: string;
  // Present only on an accepted publish. The caller records it so the next pull can see
  // its own upload in the relay's answer and skip decrypting what it just sent.
  eventId?: string;
  createdAt?: number;
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
    return { address: record.address, eventId: signed.id, createdAt: signed.created_at, ...classifyPublish(settled[0]) };
  } catch (error) {
    // Encoding and signing happen before anything is sent, so a throw here is the signer,
    // never the relay. Retrying the next record would just wait out the same timeout again.
    return { address: record.address, accepted: false, failure: 'signer', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (ownPool) pool.close([relayUrl]);
  }
}

// No AUTH handshake: the relay is open and a signature already binds authorship.
//
// `since` is the newest event this device has already read. It is inclusive on purpose:
// asking for one second later would drop an event published in the same second as the
// last one, and a boundary event that comes back again costs nothing because the seen
// ledger skips it before it is ever decrypted.
export async function fetchRecords(relayUrl: string, pubkey: string, pool = new SimplePool(), ownPool = true, since?: number): Promise<SignedNostrEvent[]> {
  try {
    const events = await withTimeout(
      pool.querySync([relayUrl], { authors: [pubkey], kinds: [PRIVATE_RECORD_KIND], ...(since ? { since } : {}) }, { maxWait: FETCH_TIMEOUT_MS }),
      FETCH_TIMEOUT_MS,
      'relay query timed out'
    );
    return events as unknown as SignedNostrEvent[];
  } finally {
    if (ownPool) pool.close([relayUrl]);
  }
}
