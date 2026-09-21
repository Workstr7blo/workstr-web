import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent } from '../signer/types';

// Reading and rewriting the current user's own replaceable events: `kind:0` metadata and the
// NIP-A3 `kind:10133` payment targets. Both are rewritten wholesale by a relay, and both may
// hold fields another client wrote, so both share the same two rules - a read must be able to
// say "nobody answered" rather than "there is no event", and a write only counts once a relay
// has acknowledged it.

export interface ReplaceablePool {
  get(relays: string[], filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  publish(relays: string[], event: SignedNostrEvent): Array<Promise<string>>;
  close(relays: string[]): void;
}

export interface RelayPublishResult {
  okRelays: string[];
  failedRelays: string[];
}

export const PUBLISH_TIMEOUT_MS = 8000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * The author's latest event of one replaceable kind, or null when the relays that answered
 * hold none.
 *
 * Connections are opened first, and explicitly. `pool.get` resolves null both when the author
 * publishes no event and when not one relay could be reached, and the caller must not confuse
 * those: a browser that is simply offline would otherwise be told the user has no event, and
 * the next publish would overwrite the one it never managed to read.
 */
export async function fetchLatestReplaceable(relays: string[], kind: number, pubkey: string, timeoutMs: number, what: string): Promise<SignedNostrEvent | null> {
  const pool = new SimplePool();
  try {
    const connections = await Promise.allSettled(relays.map((relay) => withTimeout(
      pool.ensureRelay(relay, { connectionTimeout: timeoutMs }),
      timeoutMs,
      `${relay} did not answer`
    )));
    const reachable = relays.filter((_relay, index) => connections[index].status === 'fulfilled');
    if (!reachable.length) throw new Error(`no relay could be reached for the ${what} lookup`);
    return await withTimeout(
      pool.get(reachable, { kinds: [kind], authors: [pubkey] }) as Promise<SignedNostrEvent | null>,
      timeoutMs,
      `${what} lookup timed out`
    );
  } finally {
    pool.close(relays);
  }
}

function publishReason(result?: PromiseSettledResult<string>): string {
  if (!result) return 'no result from relay';
  if (result.status === 'fulfilled') return result.value || 'accepted';
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

// A relay that fulfils with a "connection failure:" message never saw the event, so it is a
// failure despite the resolved promise. Tolerates a missing result: a pool that returns fewer
// promises than relays has not published to the remainder, and that counts as a failure.
function isAccepted(result?: PromiseSettledResult<string>): boolean {
  return !!result && result.status === 'fulfilled' && !result.value.toLowerCase().startsWith('connection failure:');
}

/** Publishes a signed event and throws unless at least one relay acknowledged it. */
export async function publishToRelays(pool: ReplaceablePool, relays: string[], signed: SignedNostrEvent, what: string): Promise<RelayPublishResult> {
  try {
    const results = await Promise.allSettled(
      pool.publish(relays, signed).map((publish) => withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out'))
    );
    const okRelays = relays.filter((_relay, index) => isAccepted(results[index]));
    const failedRelays = relays.filter((_relay, index) => !isAccepted(results[index]));
    if (!okRelays.length) {
      const index = relays.findIndex((_relay, at) => !isAccepted(results[at]));
      throw new Error(`no relay accepted the ${what} (${relays[index]}: ${publishReason(results[index])})`);
    }
    return { okRelays, failedRelays };
  } finally {
    pool.close(relays);
  }
}
