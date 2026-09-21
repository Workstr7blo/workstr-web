import { describe, expect, it, vi } from 'vitest';
import { publishToRelays, type ReplaceablePool } from '../src/nostr/replaceable-event';
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
