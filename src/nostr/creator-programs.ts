import type { Event } from 'nostr-tools';
import { SimplePool, verifyEvent } from 'nostr-tools';
import { DEFAULT_PUBLIC_RELAYS } from './pool';

// NIP-101e workout template. Named here so the signer permission list and the publisher
// agree with the reader on what Workstr asks to sign.
export const CREATOR_PROGRAM_KIND = 33402;
export const CREATOR_PROGRAM_D_PREFIX = 'workstr:beastmode:program:';
export const INCIDENT_CREATOR_PROGRAM_EVENT_ID = '3db8e166847c6e11830de700cd21e0433bbaa722906a88e54f16e2fbb4dff9cb';
export const INCIDENT_CREATOR_PROGRAM_PUBKEY = '0a6c41ba921a01e0139aaf6bb7cd344c3e5b7d35a035b186456648149138e728';
export const INCIDENT_CREATOR_PROGRAM_D_TAG = 'workstr:beastmode:program:smoke-push-day';
const QUERY_TIMEOUT_MS = 7000;

function tagValue(tags: string[][], key: string): string {
  return (tags.find((tag) => tag[0] === key) || [])[1] || '';
}

function tagValues(tags: string[][], key: string): string[] {
  return tags.filter((tag) => tag[0] === key && tag.length >= 2).map((tag) => tag[1]);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay query timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function isCreatorProgramEvent(event: Event): boolean {
  if (event.kind !== CREATOR_PROGRAM_KIND) return false;
  const tags = event.tags as string[][];
  const dTag = tagValue(tags, 'd');
  if (!dTag.startsWith(CREATOR_PROGRAM_D_PREFIX)) return false;
  const topics = tagValues(tags, 't').map((tag) => tag.toLowerCase());
  return topics.includes('workstr') && topics.includes('beastmode') && topics.includes('workstr-program');
}

function isIncidentFixture(event: Event): boolean {
  const dTag = tagValue(event.tags as string[][], 'd');
  // 2026-08-31: a production browser smoke published this fixture publicly.
  // Remove this narrow guard once the event and its relay copies are gone; do
  // not broaden it to hide other Beast Mode creators or their programs.
  return event.id === INCIDENT_CREATOR_PROGRAM_EVENT_ID
    || (event.pubkey === INCIDENT_CREATOR_PROGRAM_PUBKEY && dTag === INCIDENT_CREATOR_PROGRAM_D_TAG);
}

// Creator programs are self-published and discoverable by their Beast Mode
// namespace/tags. The d-tag is only an indexing convention: trust still comes
// from each event's valid signature and user-visible author, not the namespace.
export function selectCreatorProgramEvents(events: Event[]): Event[] {
  const byAddress = new Map<string, Event>();
  for (const event of events) {
    if (!isCreatorProgramEvent(event)) continue;
    if (isIncidentFixture(event)) continue;
    const dTag = tagValue(event.tags as string[][], 'd');
    const existing = byAddress.get(`${event.kind}:${event.pubkey}:${dTag}`);
    if (existing && existing.created_at >= event.created_at) continue;
    if (!verifyEvent(event)) continue;
    byAddress.set(`${event.kind}:${event.pubkey}:${dTag}`, event);
  }
  return [...byAddress.values()];
}

export async function queryCreatorPrograms(limit: number, relays = DEFAULT_PUBLIC_RELAYS): Promise<Event[]> {
  const pool = new SimplePool();
  try {
    const filter = { kinds: [CREATOR_PROGRAM_KIND], '#t': ['beastmode', 'workstr-program'], limit };
    const results = await Promise.allSettled(
      relays.map((relay) => withTimeout(pool.querySync([relay], filter)))
    );
    if (results.every((result) => result.status === 'rejected')) {
      throw new Error('no creator program relay reachable');
    }
    const merged = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return selectCreatorProgramEvents(merged);
  } finally {
    pool.close(relays);
  }
}
