import { describe, expect, it, vi } from 'vitest';
import { fetchLatestReplaceable, publishToRelays, type ReplaceableLookupPool, type ReplaceablePool } from '../src/nostr/replaceable-event';
import { DEFAULT_PUBLIC_RELAYS, withoutRetiredRelays } from '../src/nostr/pool';
import { paymentTargetRelays } from '../src/nostr/payment-targets';
import { profileRelays } from '../src/nostr/profile';
import type { SignedNostrEvent } from '../src/signer/types';

const EVENT = { id: 'e', pubkey: 'a'.repeat(64), kind: 0, created_at: 1, tags: [], content: '{}', sig: 's' } as SignedNostrEvent;

function pool(results: Array<Promise<string>>): ReplaceablePool {
  return { get: vi.fn(), publish: vi.fn(() => results), close: vi.fn() };
}

describe('publishing a replaceable event', () => {
  it('counts only relays that acknowledged it', async () => {
    const result = await publishToRelays(pool([Promise.resolve('ok'), Promise.resolve('connection failure: refused'), Promise.reject(new Error('blocked'))]), ['wss://a', 'wss://b', 'wss://c'], EVENT, 'profile');
    expect(result).toEqual({ okRelays: ['wss://a'], failedRelays: ['wss://b', 'wss://c'] });
  });

  it('throws with the first refusal when nobody accepted it', async () => {
    await expect(publishToRelays(pool([Promise.reject(new Error('blocked'))]), ['wss://a', 'wss://b'], EVENT, 'profile')).rejects.toThrow('no relay accepted the profile (wss://a: blocked)');
  });

  it('closes the pool either way', async () => {
    const relays = pool([Promise.reject(new Error('blocked'))]);
    await publishToRelays(relays, ['wss://a'], EVENT, 'profile').catch(() => undefined);
    expect(relays.close).toHaveBeenCalledWith(['wss://a']);
  });
});

// Each relay answers on its own terms: `connect` false refuses the connection, `answer`
// undefined accepts it and never finishes the query.
function lookupPool(relays: Record<string, { connect: boolean; answer?: SignedNostrEvent | null }>): ReplaceableLookupPool {
  return {
    ensureRelay: vi.fn((relay: string) => relays[relay]?.connect ? Promise.resolve({}) : Promise.reject(new Error('refused'))),
    get: vi.fn(([relay]: string[]) => 'answer' in relays[relay] ? Promise.resolve(relays[relay].answer) : new Promise(() => undefined)),
    close: vi.fn()
  };
}

describe('reading a replaceable event', () => {
  const older = { ...EVENT, id: 'old', created_at: 10 } as SignedNostrEvent;
  const newer = { ...EVENT, id: 'new', created_at: 20 } as SignedNostrEvent;

  it('answers from the relays that answer when another refuses and another hangs', async () => {
    const pool = lookupPool({ 'wss://refuses': { connect: false }, 'wss://hangs': { connect: true }, 'wss://good': { connect: true, answer: older } });
    const event = await fetchLatestReplaceable(['wss://refuses', 'wss://hangs', 'wss://good'], 0, EVENT.pubkey, 20, 'profile', () => pool);
    expect(event?.id).toBe('old');
    expect(pool.close).toHaveBeenCalledWith(['wss://refuses', 'wss://hangs', 'wss://good']);
  });

  it('keeps the newest event when relays disagree', async () => {
    const pool = lookupPool({ 'wss://a': { connect: true, answer: older }, 'wss://b': { connect: true, answer: newer }, 'wss://c': { connect: true, answer: null } });
    expect((await fetchLatestReplaceable(['wss://a', 'wss://b', 'wss://c'], 0, EVENT.pubkey, 20, 'profile', () => pool))?.id).toBe('new');
  });

  it('says nobody answered rather than that there is no event', async () => {
    const empty = lookupPool({ 'wss://a': { connect: true, answer: null } });
    await expect(fetchLatestReplaceable(['wss://a'], 0, EVENT.pubkey, 20, 'profile', () => empty)).resolves.toBeNull();
    const offline = lookupPool({ 'wss://a': { connect: false }, 'wss://b': { connect: true } });
    await expect(fetchLatestReplaceable(['wss://a', 'wss://b'], 10133, EVENT.pubkey, 20, 'payment target', () => offline))
      .rejects.toThrow('no relay could be reached for the payment target lookup');
  });
});

describe('the public relay list', () => {
  it('never asks a retired relay, even one saved in settings by an older build', () => {
    const saved = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band/'];
    for (const list of [profileRelays(saved), paymentTargetRelays(saved), withoutRetiredRelays(saved), DEFAULT_PUBLIC_RELAYS]) {
      expect(list.some((relay) => relay.includes('relay.nostr.band'))).toBe(false);
    }
    expect(profileRelays(saved)).toEqual(expect.arrayContaining(['wss://relay.primal.net', 'wss://relay.nos.social']));
  });
});
