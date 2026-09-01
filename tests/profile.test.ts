// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProfile, parseProfileEvent, profileRelays, readCachedProfile, writeCachedProfile } from '../src/nostr/profile';
import type { SignedNostrEvent } from '../src/signer/types';

const PUBKEY = 'ab'.repeat(32);
const event = (content: string): SignedNostrEvent => ({
  id: 'id', pubkey: PUBKEY, sig: 'sig', kind: 0, created_at: 10, tags: [], content
});

beforeEach(() => localStorage.clear());

describe('profile metadata', () => {
  it('accepts common name and avatar fields', () => {
    expect(parseProfileEvent(PUBKEY, event(JSON.stringify({ display_name: ' Alice ', image: ' https://example.com/a.png ' })))).toMatchObject({
      pubkey: PUBKEY, name: 'Alice', picture: 'https://example.com/a.png', createdAt: 10
    });
  });

  it('merges configured relays with defaults and removes duplicates', () => {
    const relays = profileRelays([' wss://custom.example ', 'wss://nos.lol']);
    expect(relays[0]).toBe('wss://custom.example');
    expect(relays.filter((relay) => relay === 'wss://nos.lol')).toHaveLength(1);
    expect(relays.length).toBeGreaterThan(2);
  });

  it('round-trips public profile metadata through the browser cache', () => {
    const profile = { pubkey: PUBKEY, name: 'Alice', picture: 'https://example.com/a.png', createdAt: 10 };
    writeCachedProfile(profile);
    expect(readCachedProfile(PUBKEY)).toEqual(profile);
    expect(readCachedProfile('cd'.repeat(32))).toBeNull();
  });

  it('retries a transient empty relay result', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(event(JSON.stringify({ name: 'Alice' })));
    expect(await fetchProfile(PUBKEY, ['wss://custom.example'], { query, attempts: 2, timeoutMs: 1 })).toMatchObject({ name: 'Alice' });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
