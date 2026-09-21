import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { profileRelays } from './profile';
import { fetchLatestReplaceable, publishToRelays, withTimeout, type RelayPublishResult, type ReplaceablePool } from './replaceable-event';

// Writing the current user's `kind:0`. `profile.ts` reads metadata for display and keeps only
// a name and a picture, which is exactly why a publish can never start from it: `kind:0` is
// replaced wholesale, and an event rebuilt from that summary would erase the about, NIP-05,
// banner, Lightning address and every field some other client keeps there.
//
// So a publish starts from the complete event, confirmed read from the relays, parses all of
// its content, and changes the two fields Workstr owns: `display_name` and `picture`. The
// `name` is never touched, not even to mirror a new display name into it.
export const PROFILE_METADATA_KIND = 0;

const FETCH_TIMEOUT_MS = 5000;
const SIGN_TIMEOUT_MS = 120000;

export interface ProfileMetadataChanges {
  displayName?: string;
  picture?: string;
}

export interface PublishProfileMetadataOptions {
  relays?: string[];
  /**
   * The latest complete `kind:0`, or null for an account that has never published one.
   * Undefined means nobody managed to read it, and the publish refuses rather than guess.
   */
  existing: SignedNostrEvent | null | undefined;
  poolFactory?: () => ReplaceablePool;
}

export interface ProfileMetadataLookupOptions {
  timeoutMs?: number;
  query?: (relays: string[], pubkey: string, timeoutMs: number) => Promise<SignedNostrEvent | null>;
}

/**
 * The author's latest `kind:0`. Rejects when no relay could be reached, so "this account has
 * no profile yet" is never confused with "we are offline" - the first may be written from
 * scratch, the second must not be written at all.
 */
export async function fetchProfileMetadataEvent(pubkey: string, relays: string[] = [], options: ProfileMetadataLookupOptions = {}): Promise<SignedNostrEvent | null> {
  const query = options.query || ((targets, author, timeoutMs) => fetchLatestReplaceable(targets, PROFILE_METADATA_KIND, author, timeoutMs, 'profile'));
  return query(profileRelays(relays), pubkey, options.timeoutMs ?? FETCH_TIMEOUT_MS);
}

/**
 * Every property of a `kind:0`'s content. Throws on content that is not a JSON object: an
 * event Workstr cannot parse is one it cannot preserve, so it must not be overwritten.
 */
export function profileMetadataContent(event: Pick<SignedNostrEvent, 'content'> | null): Record<string, unknown> {
  if (!event) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content || '{}');
  } catch {
    throw new Error('your current profile could not be read');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('your current profile could not be read');
  return parsed as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The two fields Workstr edits, as the editor shows them: `display_name`, else `name`. */
export function editableProfileFields(event: Pick<SignedNostrEvent, 'content'> | null): { displayName: string; picture: string } {
  try {
    const content = profileMetadataContent(event);
    return { displayName: text(content.display_name) || text(content.name), picture: text(content.picture) };
  } catch {
    return { displayName: '', picture: '' };
  }
}

export function buildProfileMetadataEvent(existing: SignedNostrEvent | null, changes: ProfileMetadataChanges): UnsignedNostrEvent {
  const content = { ...profileMetadataContent(existing) };
  if (changes.displayName !== undefined) content.display_name = changes.displayName.trim();
  if (changes.picture !== undefined) content.picture = changes.picture.trim();
  return {
    kind: PROFILE_METADATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    // Tags belong to whoever wrote them; `kind:0` rarely carries any, but they are kept.
    tags: existing?.tags ?? [],
    content: JSON.stringify(content)
  };
}

/** Signs and publishes the merged `kind:0`. Throws unless a relay acknowledged it. */
export async function publishProfileMetadata(
  signer: Signer,
  changes: ProfileMetadataChanges,
  options: PublishProfileMetadataOptions
): Promise<RelayPublishResult & { event: SignedNostrEvent }> {
  if (options.existing === undefined) throw new Error('your current profile has not been loaded');
  const relays = profileRelays(options.relays);
  if (!relays.length) throw new Error('no public relays configured for your profile');
  const signed = await withTimeout(
    signer.signEvent(buildProfileMetadataEvent(options.existing, changes)),
    SIGN_TIMEOUT_MS,
    'signer approval timed out'
  );
  const pool = options.poolFactory?.() || (new SimplePool() as unknown as ReplaceablePool);
  return { event: signed, ...await publishToRelays(pool, relays, signed, 'profile') };
}
