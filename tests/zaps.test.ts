import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { collectZapReceipts, fundingTotals, lightningUri, monthStartUnix, parseZapReceipt } from '../src/nostr/zaps';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';

// The amount lives in the bolt11 human-readable prefix. The decoder needs at
// least 50 characters and locates the separator with lastIndexOf('1'), which
// is only correct because bech32's charset excludes '1' — so the padding after
// the separator must stay inside that charset.
const invoice = (hrp: string) => `${hrp}1${'q'.repeat(60)}`;
const BOLT11_21_SATS = invoice('lnbc210n');    // 210 nano-BTC = 21 sats
const BOLT11_1000_SATS = invoice('lnbc10u');   // 10 micro-BTC = 1000 sats

const providerSecret = generateSecretKey();
const providerPubkey = getPublicKey(providerSecret);
const strangerSecret = generateSecretKey();

const trust = { recipient: OPERATOR_PUBKEY, signer: providerPubkey };

function receipt(overrides: {
  bolt11?: string;
  recipient?: string;
  secret?: Uint8Array;
  description?: string;
  createdAt?: number;
  kind?: number;
} = {}) {
  const tags: string[][] = [
    ['p', overrides.recipient ?? OPERATOR_PUBKEY],
    ['bolt11', overrides.bolt11 ?? BOLT11_21_SATS],
    ['description', overrides.description ?? JSON.stringify({ pubkey: 'f'.repeat(64), kind: 9734 })]
  ];
  return finalizeEvent({
    kind: overrides.kind ?? 9735,
    created_at: overrides.createdAt ?? 1_800_000_000,
    tags,
    content: ''
  }, overrides.secret ?? providerSecret);
}

describe('parseZapReceipt', () => {
  it('accepts a receipt signed by the wallet provider and reads the amount', () => {
    const parsed = parseZapReceipt(receipt(), trust);
    expect(parsed).not.toBeNull();
    expect(parsed!.sats).toBe(21);
    expect(parsed!.senderPubkey).toBe('f'.repeat(64));
  });

  it('rejects a receipt signed by anyone else', () => {
    // The whole point: a stranger must not be able to inflate the total.
    expect(parseZapReceipt(receipt({ secret: strangerSecret }), trust)).toBeNull();
  });

  it('rejects a receipt addressed to a different pubkey', () => {
    expect(parseZapReceipt(receipt({ recipient: 'a'.repeat(64) }), trust)).toBeNull();
  });

  it('rejects a forged event whose signature does not verify', () => {
    // JSON round-trip, not a spread: nostr-tools caches "already verified" in a
    // symbol property that a spread would copy onto the tampered clone.
    const tampered = JSON.parse(JSON.stringify(receipt()));
    tampered.sig = '0'.repeat(128);
    expect(parseZapReceipt(tampered, trust)).toBeNull();
  });

  it('rejects the wrong kind', () => {
    expect(parseZapReceipt(receipt({ kind: 1 }), trust)).toBeNull();
  });

  it('rejects a missing or unparseable invoice', () => {
    expect(parseZapReceipt(receipt({ bolt11: '' }), trust)).toBeNull();
    expect(parseZapReceipt(receipt({ bolt11: 'not-an-invoice' }), trust)).toBeNull();
  });

  it('survives a malformed zap request without losing the amount', () => {
    const parsed = parseZapReceipt(receipt({ description: '{not json' }), trust);
    expect(parsed?.sats).toBe(21);
    expect(parsed?.senderPubkey).toBeUndefined();
  });
});

describe('collectZapReceipts', () => {
  it('dedupes the same receipt arriving from several relays', () => {
    const one = receipt();
    const collected = collectZapReceipts([one, one, one], trust);
    expect(collected).toHaveLength(1);
  });

  it('keeps distinct receipts and drops untrusted ones in the same pass', () => {
    const good = receipt({ createdAt: 1_800_000_100 });
    const alsoGood = receipt({ bolt11: BOLT11_1000_SATS, createdAt: 1_800_000_200 });
    const bad = receipt({ secret: strangerSecret });
    const collected = collectZapReceipts([good, alsoGood, bad], trust);
    expect(collected).toHaveLength(2);
    // newest first
    expect(collected[0].createdAt).toBe(1_800_000_200);
  });
});

describe('fundingTotals', () => {
  it('sums sats and reports progress against the published cost', () => {
    const receipts = collectZapReceipts([
      receipt({ bolt11: BOLT11_1000_SATS, createdAt: 1 }),
      receipt({ bolt11: BOLT11_1000_SATS, createdAt: 2 })
    ], trust);
    const totals = fundingTotals(receipts, 50_000);
    expect(totals.sats).toBe(2000);
    expect(totals.count).toBe(2);
    expect(totals.percent).toBe(4);
  });

  it('reports zero for an empty month without dividing by zero', () => {
    expect(fundingTotals([], 50_000)).toMatchObject({ sats: 0, count: 0, percent: 0 });
    expect(fundingTotals([], 0).percent).toBe(0);
  });

  it('caps progress at 100 percent when donations exceed the cost', () => {
    const receipts = [{ id: 'a', sats: 500_000, createdAt: 1 }];
    expect(fundingTotals(receipts, 50_000).percent).toBe(100);
  });
});

describe('monthStartUnix', () => {
  it('returns midnight on the first of the given month', () => {
    const start = monthStartUnix(new Date(2026, 7, 8, 14, 30));
    const asDate = new Date(start * 1000);
    expect(asDate.getDate()).toBe(1);
    expect(asDate.getMonth()).toBe(7);
    expect(asDate.getHours()).toBe(0);
  });

  it('does not leak into the previous month', () => {
    const start = monthStartUnix(new Date(2026, 0, 1, 0, 0, 1));
    expect(new Date(start * 1000).getMonth()).toBe(0);
  });
});

describe('lightningUri', () => {
  it('builds a wallet-openable uri from the address', () => {
    expect(lightningUri('workstr@coinos.io')).toBe('lightning:workstr@coinos.io');
  });
});
