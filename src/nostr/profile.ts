import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent } from '../signer/types';
import { DEFAULT_PUBLIC_RELAYS, type RelayProfile } from './pool';

const PROFILE_CACHE_PREFIX = 'workstr.profile.';
const PROFILE_TIMEOUT_MS = 5000;

export function profileRelays(configured: string[] = []): string[] {
  return [...new Set([...configured, ...DEFAULT_PUBLIC_RELAYS].map((relay) => relay.trim()).filter(Boolean))];
}

export function parseProfileEvent(pubkey: string, event: SignedNostrEvent): RelayProfile | null {
  try {
    const metadata = JSON.parse(event.content) as Record<string, unknown>;
    const text = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = metadata[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return undefined;
    };
    return {
      pubkey,
      name: text('display_name', 'displayName', 'name', 'username', 'nip05'),
      picture: text('picture', 'image', 'avatar'),
      nip05: text('nip05'),
      lud16: text('lud16'),
      lud06: text('lud06'),
      createdAt: event.created_at
    };
  } catch {
    return null;
  }
}

function cacheKey(pubkey: string): string {
  return `${PROFILE_CACHE_PREFIX}${pubkey}`;
}

export function readCachedProfile(pubkey: string, storage: Storage = localStorage): RelayProfile | null {
  try {
    const parsed = JSON.parse(storage.getItem(cacheKey(pubkey)) || 'null') as RelayProfile | null;
    if (!parsed || parsed.pubkey !== pubkey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: RelayProfile, storage: Storage = localStorage): void {
  try {
    storage.setItem(cacheKey(profile.pubkey), JSON.stringify(profile));
  } catch {
    // Public metadata cache is an optimization; storage denial must not block sign-in.
  }
}

async function queryProfileEvent(relays: string[], pubkey: string, timeoutMs: number): Promise<SignedNostrEvent | null> {
  const pool = new SimplePool();
  try {
    return await Promise.race([
      pool.get(relays, { kinds: [0], authors: [pubkey] }) as Promise<SignedNostrEvent | null>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  } finally {
    pool.close(relays);
  }
}

export async function fetchProfile(
  pubkey: string,
  relays = DEFAULT_PUBLIC_RELAYS,
  options: { attempts?: number; timeoutMs?: number; query?: typeof queryProfileEvent } = {}
): Promise<RelayProfile | null> {
  const targets = profileRelays(relays);
  const attempts = Math.max(1, options.attempts ?? 2);
  const query = options.query || queryProfileEvent;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const event = await query(targets, pubkey, options.timeoutMs ?? PROFILE_TIMEOUT_MS);
      if (event) return parseProfileEvent(pubkey, event);
    } catch {
      // A second relay pass handles transient WebSocket and browser wake-up failures.
    }
  }
  return null;
}
