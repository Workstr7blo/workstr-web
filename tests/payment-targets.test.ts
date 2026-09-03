import { describe, expect, it, vi } from 'vitest';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';
import {
  MONERO_METHOD,
  PAYMENT_TARGETS_KIND,
  PAYTO_TAG,
  buildPaymentTargetsEvent,
  fetchMoneroPaymentTarget,
  fetchPaymentTargetsEvent,
  looksLikeMoneroAddress,
  parseMoneroPaymentTarget,
  paymentTargetRelays,
  publishMoneroPaymentTarget,
  withMoneroPaymentTarget,
  type PaymentTargetsPool
} from '../src/nostr/payment-targets';

const ADDRESS = '8AWERgm6PdpNXHAaEjRHhBVGiPjcvfHZjLXpvQFRnHDsWaWaBrRZnBQwCEmpZbNQ5tKu9hLZQBjVdRUcCLbxJHVYPxnhQ2s';
const OTHER = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';

function event(tags: string[][], overrides: Partial<SignedNostrEvent> = {}): SignedNostrEvent {
  return {
    id: 'e1', pubkey: 'a'.repeat(64), sig: 's1',
    kind: PAYMENT_TARGETS_KIND, created_at: 1_760_000_000, content: '', tags,
    ...overrides
  };
}

function signer(overrides: Partial<Signer> = {}): Signer {
  return {
    type: 'local',
    getPublicKey: async () => 'a'.repeat(64),
    signEvent: async (unsigned: UnsignedNostrEvent) => ({ ...unsigned, id: 'signed', pubkey: 'a'.repeat(64), sig: 'sig' }),
    nip44Encrypt: async () => '',
    nip44Decrypt: async () => '',
    ...overrides
  };
}

// Publishing fans out to the configured relays *plus* the defaults, so a mock has to answer
// per relay rather than with a fixed-length list. `outcomes` overrides individual relays; a
// string resolves (relay accepted), an Error rejects.
function pool(outcomes: Record<string, string | Error> = {}, fallback: string | Error = 'accepted'): PaymentTargetsPool & { closed: string[][] } {
  const closed: string[][] = [];
  return {
    closed,
    get: async () => null,
    publish: (relays) => relays.map((relay) => {
      const outcome = relay in outcomes ? outcomes[relay] : fallback;
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
    close: (relays) => { closed.push(relays); }
  };
}

describe('module boundaries', () => {
  it('never reaches for local storage, the database or the wallet credential store', async () => {
    // The address is public Nostr metadata whose source of truth is the signed kind:10133
    // event. Persisting it as Workstr state — encrypted sync, workout records, or the NWC
    // secret store — would create a second, authoritative-looking copy that can drift.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../src/nostr/payment-targets.ts'), 'utf8');

    for (const forbidden of ['nwc-storage', '../db/', '../sync/', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(source, `payment-targets.ts should not reference ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('parseMoneroPaymentTarget', () => {
  it('reads the canonical monero method', () => {
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'monero', ADDRESS]]))).toBe(ADDRESS);
  });

  it('reads the xmr alias other clients may have published', () => {
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'XMR', ADDRESS]]))).toBe(ADDRESS);
  });

  it('trims surrounding whitespace', () => {
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'monero', `  ${ADDRESS}\n`]]))).toBe(ADDRESS);
  });

  it('ignores unrelated payment methods', () => {
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'lightning', 'someone@example.com']]))).toBeNull();
  });

  it('takes the first valid monero tag when an event carries several', () => {
    const parsed = parseMoneroPaymentTarget(event([
      [PAYTO_TAG, 'monero', ADDRESS],
      [PAYTO_TAG, 'xmr', OTHER]
    ]));
    expect(parsed).toBe(ADDRESS);
  });

  it('skips a malformed tag and keeps looking', () => {
    const parsed = parseMoneroPaymentTarget(event([
      [PAYTO_TAG, 'monero', '   '],
      [PAYTO_TAG, 'monero', ADDRESS]
    ]));
    expect(parsed).toBe(ADDRESS);
  });

  it.each([
    ['a missing address', [[PAYTO_TAG, 'monero']]],
    ['an empty address', [[PAYTO_TAG, 'monero', '']]],
    ['an address containing whitespace', [[PAYTO_TAG, 'monero', 'not an address']]],
    ['a non-payto tag', [['zap', 'monero', ADDRESS]]],
    ['no tags at all', []]
  ])('returns null for %s', (_label, tags) => {
    expect(parseMoneroPaymentTarget(event(tags as string[][]))).toBeNull();
  });

  it('rejects non-string tag fields without throwing', () => {
    const tags = [[PAYTO_TAG, 'monero', 42], [PAYTO_TAG, 7, ADDRESS], 'payto'] as unknown as string[][];
    expect(parseMoneroPaymentTarget(event(tags))).toBeNull();
  });

  it('ignores an event of the wrong kind', () => {
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'monero', ADDRESS]], { kind: 10002 }))).toBeNull();
  });

  it('handles a missing event', () => {
    expect(parseMoneroPaymentTarget(null)).toBeNull();
    expect(parseMoneroPaymentTarget(undefined)).toBeNull();
  });
});

describe('looksLikeMoneroAddress', () => {
  it('accepts standard, sub and integrated address lengths', () => {
    expect(looksLikeMoneroAddress(ADDRESS)).toBe(true);
    expect(looksLikeMoneroAddress(OTHER)).toBe(true);
    expect(looksLikeMoneroAddress(`4${'1'.repeat(105)}`)).toBe(true);
  });

  it('rejects wrong lengths, wrong leading digit and non-Base58 characters', () => {
    expect(looksLikeMoneroAddress('too-short')).toBe(false);
    expect(looksLikeMoneroAddress(`9${'1'.repeat(94)}`)).toBe(false);
    expect(looksLikeMoneroAddress(`4${'0'.repeat(94)}`)).toBe(false);
  });

  it('is not applied by the parser, which stays liberal about relay data', () => {
    const odd = 'ThisIsNotAValidMoneroAddressButItIsOnARelay';
    expect(looksLikeMoneroAddress(odd)).toBe(false);
    expect(parseMoneroPaymentTarget(event([[PAYTO_TAG, 'monero', odd]]))).toBe(odd);
  });
});

describe('withMoneroPaymentTarget', () => {
  it('preserves unrelated payment targets and other tags', () => {
    const tags = withMoneroPaymentTarget([
      [PAYTO_TAG, 'something-else', 'keep-me'],
      ['client', 'SomeOtherApp'],
      [PAYTO_TAG, 'monero', 'old-address']
    ], ADDRESS);

    expect(tags).toEqual([
      [PAYTO_TAG, 'something-else', 'keep-me'],
      ['client', 'SomeOtherApp'],
      [PAYTO_TAG, MONERO_METHOD, ADDRESS]
    ]);
  });

  it('replaces every existing monero and xmr target with one canonical entry', () => {
    const tags = withMoneroPaymentTarget([
      [PAYTO_TAG, 'monero', 'old-one'],
      [PAYTO_TAG, 'xmr', 'old-two']
    ], ADDRESS);
    expect(tags).toEqual([[PAYTO_TAG, MONERO_METHOD, ADDRESS]]);
  });

  it('normalises the written method to monero even from an xmr original', () => {
    const tags = withMoneroPaymentTarget([[PAYTO_TAG, 'XMR', 'old']], ADDRESS);
    expect(tags[0][1]).toBe('monero');
  });

  it('clears the target on an empty address while keeping the rest', () => {
    const tags = withMoneroPaymentTarget([
      [PAYTO_TAG, 'something-else', 'keep-me'],
      [PAYTO_TAG, 'monero', 'old-address']
    ], '   ');
    expect(tags).toEqual([[PAYTO_TAG, 'something-else', 'keep-me']]);
  });

  it('handles an absent tag list', () => {
    expect(withMoneroPaymentTarget(undefined, ADDRESS)).toEqual([[PAYTO_TAG, MONERO_METHOD, ADDRESS]]);
  });
});

describe('buildPaymentTargetsEvent', () => {
  it('builds a replaceable kind 10133 with empty content', () => {
    const unsigned = buildPaymentTargetsEvent([], ADDRESS);
    expect(unsigned.kind).toBe(PAYMENT_TARGETS_KIND);
    expect(unsigned.content).toBe('');
    expect(unsigned.tags).toEqual([[PAYTO_TAG, MONERO_METHOD, ADDRESS]]);
    expect(unsigned.created_at).toBeGreaterThan(1_700_000_000);
  });

  it('round-trips through the parser', () => {
    const unsigned = buildPaymentTargetsEvent([['client', 'Workstr']], ADDRESS);
    expect(parseMoneroPaymentTarget({ kind: unsigned.kind, tags: unsigned.tags })).toBe(ADDRESS);
  });
});

describe('paymentTargetRelays', () => {
  it('puts configured relays first and de-duplicates against the defaults', () => {
    const relays = paymentTargetRelays(['wss://relay.example  ', 'wss://relay.damus.io']);
    expect(relays[0]).toBe('wss://relay.example');
    expect(relays.filter((relay) => relay === 'wss://relay.damus.io')).toHaveLength(1);
  });

  it('falls back to the defaults when nothing is configured', () => {
    expect(paymentTargetRelays()).toContain('wss://relay.damus.io');
  });
});

describe('fetchPaymentTargetsEvent', () => {
  it('queries the payment-target kind for the author', async () => {
    const query = vi.fn(async () => event([[PAYTO_TAG, 'monero', ADDRESS]]));
    await fetchPaymentTargetsEvent('a'.repeat(64), ['wss://relay.example'], { query });
    expect(query).toHaveBeenCalledWith(expect.arrayContaining(['wss://relay.example']), 'a'.repeat(64), 5000);
  });

  it('propagates a relay failure so callers can tell it apart from "no target"', async () => {
    const query = vi.fn(async () => { throw new Error('payment target lookup timed out'); });
    await expect(fetchPaymentTargetsEvent('a'.repeat(64), [], { query })).rejects.toThrow('timed out');
  });
});

describe('fetchMoneroPaymentTarget', () => {
  it('returns the address from the latest event', async () => {
    const query = vi.fn(async () => event([[PAYTO_TAG, 'monero', ADDRESS]]));
    await expect(fetchMoneroPaymentTarget('a'.repeat(64), [], { query })).resolves.toBe(ADDRESS);
  });

  it('returns null when the author publishes no target', async () => {
    const query = vi.fn(async () => null);
    await expect(fetchMoneroPaymentTarget('a'.repeat(64), [], { query })).resolves.toBeNull();
  });

  it('swallows relay failures so card rendering never breaks', async () => {
    const query = vi.fn(async () => { throw new Error('relays unreachable'); });
    await expect(fetchMoneroPaymentTarget('a'.repeat(64), [], { query })).resolves.toBeNull();
  });
});

describe('publishMoneroPaymentTarget', () => {
  it('signs a kind 10133 preserving unrelated targets and publishes it', async () => {
    const signed: UnsignedNostrEvent[] = [];
    const p = pool();
    const result = await publishMoneroPaymentTarget(
      signer({ signEvent: async (unsigned) => { signed.push(unsigned); return { ...unsigned, id: 'x', pubkey: 'a'.repeat(64), sig: 's' }; } }),
      ADDRESS,
      {
        relays: ['wss://relay.example'],
        existing: event([[PAYTO_TAG, 'something-else', 'keep-me'], [PAYTO_TAG, 'monero', 'old']]),
        poolFactory: () => p
      }
    );

    expect(signed[0].kind).toBe(PAYMENT_TARGETS_KIND);
    expect(signed[0].tags).toEqual([
      [PAYTO_TAG, 'something-else', 'keep-me'],
      [PAYTO_TAG, MONERO_METHOD, ADDRESS]
    ]);
    expect(result.okRelays).toEqual(expect.arrayContaining(['wss://relay.example']));
    expect(p.closed.length).toBeGreaterThan(0);
  });

  it('looks up the existing event when one is not supplied', async () => {
    const query = vi.fn(async () => event([[PAYTO_TAG, 'something-else', 'keep-me']]));
    const signed: UnsignedNostrEvent[] = [];
    await publishMoneroPaymentTarget(
      signer({ signEvent: async (unsigned) => { signed.push(unsigned); return { ...unsigned, id: 'x', pubkey: 'a'.repeat(64), sig: 's' }; } }),
      ADDRESS,
      { relays: ['wss://relay.example'], lookup: { query }, poolFactory: () => pool({}, '') }
    );
    expect(query).toHaveBeenCalled();
    expect(signed[0].tags).toContainEqual([PAYTO_TAG, 'something-else', 'keep-me']);
  });

  it('aborts rather than clobbering targets it could not read', async () => {
    const query = vi.fn(async () => { throw new Error('payment target lookup timed out'); });
    await expect(publishMoneroPaymentTarget(signer(), ADDRESS, {
      relays: ['wss://relay.example'],
      lookup: { query },
      poolFactory: () => pool()
    })).rejects.toThrow('timed out');
  });

  it('clears the target when given an empty address', async () => {
    const signed: UnsignedNostrEvent[] = [];
    await publishMoneroPaymentTarget(
      signer({ signEvent: async (unsigned) => { signed.push(unsigned); return { ...unsigned, id: 'x', pubkey: 'a'.repeat(64), sig: 's' }; } }),
      '',
      { relays: ['wss://relay.example'], existing: event([[PAYTO_TAG, 'monero', 'old']]), poolFactory: () => pool() }
    );
    expect(signed[0].tags).toEqual([]);
  });

  it('treats a connection failure as a rejection, not an acceptance', async () => {
    await expect(publishMoneroPaymentTarget(signer(), ADDRESS, {
      relays: ['wss://relay.example'],
      existing: null,
      poolFactory: () => pool({}, 'connection failure: refused')
    })).rejects.toThrow('no relay accepted');
  });

  it('reports partial success when only some relays accept', async () => {
    const result = await publishMoneroPaymentTarget(signer(), ADDRESS, {
      relays: ['wss://ok.example', 'wss://bad.example'],
      existing: null,
      poolFactory: () => pool({ 'wss://bad.example': new Error('nope') })
    });
    expect(result.okRelays).toContain('wss://ok.example');
    expect(result.failedRelays).toEqual(['wss://bad.example']);
  });

  it('surfaces a signer failure', async () => {
    await expect(publishMoneroPaymentTarget(
      signer({ signEvent: async () => { throw new Error('signer rejected the request'); } }),
      ADDRESS,
      { relays: ['wss://relay.example'], existing: null, poolFactory: () => pool() }
    )).rejects.toThrow('signer rejected');
  });
});
