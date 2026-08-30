import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { collectProgramZapTotals, collectZapReceipts, fundingTotals, monthStartUnix, parseZapReceipt, resolveWorkoutProgramZapRecipient, type WorkoutProgramZapSource } from '../src/nostr/zaps';
import { buildNwcZapPaymentPayload, buildWorkoutProgramZapRequestPayload } from '../src/nostr/zap-request';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';
import { decodeLnurl } from '../src/nostr/lnurl';

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
  programAddress?: string;
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
  if (overrides.programAddress) tags.push(['a', overrides.programAddress]);
  return finalizeEvent({
    kind: overrides.kind ?? 9735,
    created_at: overrides.createdAt ?? 1_800_000_000,
    tags,
    content: ''
  }, overrides.secret ?? providerSecret);
}

function program(overrides: Partial<WorkoutProgramZapSource> = {}): WorkoutProgramZapSource {
  return {
    slug: 'push-day',
    name: 'Push Day',
    description: '',
    tags: [],
    exercises: [],
    sourceLabel: 'Workstr',
    eventId: 'e'.repeat(64),
    pubkey: OPERATOR_PUBKEY,
    address: `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`,
    createdAt: 1_800_000_000,
    lud16: 'coach@example.com',
    ...overrides
  };
}

function validRecipient() {
  const result = resolveWorkoutProgramZapRecipient(program({ zapRecipient: { relays: ['wss://relay.example', 'wss://relay.example'] } }));
  if (!result.ok) throw new Error(result.error.message);
  return result.recipient;
}

describe('resolveWorkoutProgramZapRecipient', () => {
  it('returns a validated descriptor for a zappable workout program', () => {
    const result = resolveWorkoutProgramZapRecipient(program({ zapRecipient: { relays: ['wss://relay.example'] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.recipient).toMatchObject({
      pubkey: OPERATOR_PUBKEY,
      relay: 'wss://relay.example',
      relays: ['wss://relay.example'],
      lud16: 'coach@example.com',
      app: 'workstr',
      programAddress: `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`
    });
    expect(result.recipient.lnurl).not.toBe('coach@example.com');
    expect(decodeLnurl(result.recipient.lnurl)).toBe('https://example.com/.well-known/lnurlp/coach');
  });

  it('uses lud06 metadata when no lightning address is present', () => {
    const result = resolveWorkoutProgramZapRecipient(program({ lud16: undefined, lud06: 'lnurl1dp68gurn8ghj7mrww4exctnrdakj7' }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.recipient.lnurl).toBe('lnurl1dp68gurn8ghj7mrww4exctnrdakj7');
    expect(result.recipient.lud06).toBe('lnurl1dp68gurn8ghj7mrww4exctnrdakj7');
  });

  it('returns a structured error for missing zap metadata', () => {
    const result = resolveWorkoutProgramZapRecipient(program({ lud16: undefined, lud06: undefined, zapRecipient: undefined }));
    expect(result).toEqual({ ok: false, error: { code: 'missing-lnurl', message: 'Workout program author is missing lud16/lud06 zap metadata.', field: 'lnurl' } });
  });

  it('returns a structured error when the program has no author pubkey', () => {
    const result = resolveWorkoutProgramZapRecipient(program({ pubkey: '', address: '33402::workstr:program:push-day' }));
    expect(result).toMatchObject({ ok: false, error: { code: 'missing-pubkey', field: 'pubkey' } });
  });

  it('returns structured errors for malformed values instead of throwing', () => {
    expect(resolveWorkoutProgramZapRecipient(program({ pubkey: 'not-a-pubkey' }))).toMatchObject({ ok: false, error: { code: 'malformed-pubkey' } });
    expect(resolveWorkoutProgramZapRecipient(program({ lud16: 'not a lightning address' }))).toMatchObject({ ok: false, error: { code: 'malformed-lnurl' } });
    expect(resolveWorkoutProgramZapRecipient(program({ zapRecipient: { relay: 'https://relay.example' } }))).toMatchObject({ ok: false, error: { code: 'malformed-relay' } });
  });

  it('rejects local or mismatched workout programs as unsupported/malformed', () => {
    expect(resolveWorkoutProgramZapRecipient(program({ address: 'local:1' }))).toMatchObject({ ok: false, error: { code: 'unsupported-program' } });
    expect(resolveWorkoutProgramZapRecipient(program({ address: `33402:${'a'.repeat(64)}:workstr:program:push-day` }))).toMatchObject({ ok: false, error: { code: 'malformed-address' } });
  });
});

describe('buildWorkoutProgramZapRequestPayload', () => {
  it('builds a NIP-57 kind:9734 request payload with the workout program reference', () => {
    const recipient = validRecipient();
    const result = buildWorkoutProgramZapRequestPayload(recipient, {
      amountSats: 21,
      comment: ' Great workout ',
      senderPubkey: 'f'.repeat(64),
      createdAt: 1_800_000_123
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.amountMsat).toBe(21_000);
    expect(result.payload.comment).toBe('Great workout');
    expect(result.payload.relays).toEqual(['wss://relay.example']);
    expect(result.payload.event).toEqual({
      kind: 9734,
      created_at: 1_800_000_123,
      pubkey: 'f'.repeat(64),
      content: 'Great workout',
      tags: [
        ['relays', 'wss://relay.example'],
        ['amount', '21000'],
        ['p', OPERATOR_PUBKEY],
        ['a', `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`],
        ['lnurl', recipient.lnurl],
        ['client', 'workstr'],
        ['app', 'workstr']
      ]
    });
    expect(result.payload.event.tags).not.toContainEqual(['lnurl', 'coach@example.com']);
    expect(decodeLnurl(result.payload.event.tags.find((tag) => tag[0] === 'lnurl')?.[1] || '')).toBe('https://example.com/.well-known/lnurlp/coach');
  });

  it('lets the caller override receipt relays and dedupes them', () => {
    const result = buildWorkoutProgramZapRequestPayload(validRecipient(), {
      amountSats: 100,
      relays: ['wss://one.example', 'wss://one.example', 'wss://two.example']
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.event.tags[0]).toEqual(['relays', 'wss://one.example', 'wss://two.example']);
  });

  it('rejects invalid amount/comment/recipient/relays with structured errors', () => {
    const recipient = validRecipient();
    expect(buildWorkoutProgramZapRequestPayload(recipient, { amountSats: 0 })).toMatchObject({ ok: false, error: { code: 'invalid-amount', field: 'amountSats' } });
    expect(buildWorkoutProgramZapRequestPayload(recipient, { amountSats: 1.5 })).toMatchObject({ ok: false, error: { code: 'invalid-amount' } });
    expect(buildWorkoutProgramZapRequestPayload(recipient, { amountSats: 1, comment: 'x'.repeat(501) })).toMatchObject({ ok: false, error: { code: 'invalid-comment', field: 'comment' } });
    expect(buildWorkoutProgramZapRequestPayload(null, { amountSats: 1 })).toMatchObject({ ok: false, error: { code: 'missing-recipient' } });
    expect(buildWorkoutProgramZapRequestPayload(recipient, { amountSats: 1, relays: ['https://bad.example'] })).toMatchObject({ ok: false, error: { code: 'invalid-relays', field: 'relays' } });
  });
});

describe('buildNwcZapPaymentPayload', () => {
  it('creates the NWC pay_invoice payload after verifying the invoice amount', () => {
    expect(buildNwcZapPaymentPayload(BOLT11_21_SATS, 21)).toEqual({ ok: true, payload: { method: 'pay_invoice', params: { invoice: BOLT11_21_SATS } } });
  });

  it('rejects missing, malformed, and amount-mismatched invoices', () => {
    expect(buildNwcZapPaymentPayload('', 21)).toMatchObject({ ok: false, error: { code: 'invalid-invoice', field: 'invoice' } });
    expect(buildNwcZapPaymentPayload('not-an-invoice', 21)).toMatchObject({ ok: false, error: { code: 'invalid-invoice', field: 'invoice' } });
    expect(buildNwcZapPaymentPayload(BOLT11_1000_SATS, 21)).toMatchObject({ ok: false, error: { code: 'invalid-invoice', field: 'invoice' } });
  });
});

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

describe('collectProgramZapTotals', () => {
  it('sums visible kind 9735 receipts by workout program address', () => {
    const first = program();
    const second = program({ slug: 'pull-day', name: 'Pull Day', address: `33402:${OPERATOR_PUBKEY}:workstr:program:pull-day` });
    const totals = collectProgramZapTotals([
      receipt({ programAddress: first.address, bolt11: BOLT11_21_SATS }),
      receipt({ programAddress: first.address, bolt11: BOLT11_1000_SATS }),
      receipt({ programAddress: second.address, bolt11: BOLT11_1000_SATS }),
      receipt({ programAddress: `33402:${OPERATOR_PUBKEY}:workstr:program:other`, bolt11: BOLT11_1000_SATS })
    ], [first, second]);

    expect(totals[first.address]).toEqual({ sats: 1021, count: 2 });
    expect(totals[second.address]).toEqual({ sats: 1000, count: 1 });
    expect(totals[`33402:${OPERATOR_PUBKEY}:workstr:program:other`]).toBeUndefined();
  });

  it('falls back to the zap request description a-tag when the receipt omits one', () => {
    const target = program();
    const description = JSON.stringify({ pubkey: 'f'.repeat(64), kind: 9734, tags: [['a', target.address]] });
    const totals = collectProgramZapTotals([receipt({ description })], [target]);

    expect(totals[target.address]).toEqual({ sats: 21, count: 1 });
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
