import { SimplePool, type Event } from 'nostr-tools';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { canonCacheSnapshot, primeCanonCache } from './canon';
import { CREATOR_PROGRAM_KIND } from './creator-programs';
import { normalizeProgramPublishRelays, summarizeProgramPublishResults, type ProgramPublishPool, type PublishCreatorProgramStage } from './program-publish';

const DELETION_KIND = 5;
const SIGN_TIMEOUT_MS = 120000;
const PUBLISH_TIMEOUT_MS = 8000;

export interface DeleteCreatorProgramTarget {
  address: string;
  eventId?: string;
}

export interface DeleteCreatorProgramResult {
  event: SignedNostrEvent;
  okRelays: string[];
  failedRelays: string[];
}

interface DeleteCreatorProgramOptions {
  onStage?: (stage: PublishCreatorProgramStage) => void;
  poolFactory?: () => ProgramPublishPool;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

// A NIP-09 request. The `a` tag retracts every version of the addressable program up to this
// request's timestamp, so publishing under the same d tag later is a new event relays accept;
// the `e` tag names the exact version for relays that only act on event ids. Relays ignore a
// deletion from anyone but the author, so one for someone else's program is refused here.
export function buildProgramDeletionEvent(target: DeleteCreatorProgramTarget, pubkey: string): UnsignedNostrEvent {
  if (!target.address.startsWith(`${CREATOR_PROGRAM_KIND}:${pubkey}:`)) throw new Error('only your own programs can be deleted from relays');
  return {
    kind: DELETION_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['a', target.address], ...(target.eventId ? [['e', target.eventId]] : []), ['k', String(CREATOR_PROGRAM_KIND)]],
    content: ''
  };
}

export async function deleteCreatorProgram(
  signer: Signer,
  target: DeleteCreatorProgramTarget,
  relays: string[],
  options: DeleteCreatorProgramOptions = {}
): Promise<DeleteCreatorProgramResult> {
  const publicRelays = normalizeProgramPublishRelays(relays);
  if (!publicRelays.length) throw new Error('no public program relays configured');
  const pubkey = await signer.getPublicKey();
  const unsigned = buildProgramDeletionEvent(target, pubkey);

  options.onStage?.('waiting-for-signer');
  const signed = await withTimeout(signer.signEvent(unsigned), SIGN_TIMEOUT_MS, 'signer approval timed out');
  if (signed.pubkey !== pubkey) throw new Error('the signer signed the deletion with a different key');
  options.onStage?.('publishing');
  const pool = options.poolFactory?.() || new SimplePool() as unknown as ProgramPublishPool;
  try {
    const results = await Promise.allSettled(pool.publish(publicRelays, signed).map((publish) => withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out')));
    const relayResults = summarizeProgramPublishResults(publicRelays, results);
    const okRelays = relayResults.filter((result) => result.accepted).map((result) => result.relay);
    const failedRelays = relayResults.filter((result) => !result.accepted).map((result) => result.relay);
    if (!okRelays.length) {
      const firstFailure = relayResults.find((result) => !result.accepted);
      throw new Error(`no public relay accepted the deletion${firstFailure ? ` (${firstFailure.relay}: ${firstFailure.reason})` : ''}`);
    }
    return { event: signed, okRelays, failedRelays };
  } finally {
    pool.close(publicRelays);
  }
}

// Drops a program deleted from relays out of the catalog snapshot, so it does not come back
// offline before the next refresh. The filtered snapshot is primed as newer, which replaces the
// one held in memory.
export function forgetCanonProgram(address: string): void {
  const snapshot = canonCacheSnapshot();
  if (!snapshot) return;
  const events = (snapshot.events as Event[]).filter((event) =>
    `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1] || ''}` !== address);
  primeCanonCache({ fetchedAt: Math.max(Date.now(), snapshot.fetchedAt + 1), events });
}
