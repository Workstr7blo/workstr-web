import { describe, expect, it, vi } from 'vitest';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import { OPERATOR_LUD16, ZAP_RECEIPT_SIGNER_PUBKEY } from '../src/core/funding';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';
import { parseNwcConnectionString } from '../src/nostr/nwc';
import { executeSupportZap } from '../src/nostr/support-zap';
import type { NwcClientTransport, NwcRequestPayload, NwcResponsePayload } from '../src/nostr/nwc-client';

const invoice = (hrp: string) => `${hrp}1${'q'.repeat(60)}`;
const BOLT11_1000_SATS = invoice('lnbc10u');
const BOLT11_21_SATS = invoice('lnbc210n');
const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const SENDER_PUBKEY = 'f'.repeat(64);
const NWC = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;

function signer(overrides: Partial<Signer> = {}): Signer {
  return {
    type: 'local',
    getPublicKey: vi.fn(async () => SENDER_PUBKEY),
    signEvent: vi.fn(async (event: UnsignedNostrEvent) => ({ ...event, pubkey: SENDER_PUBKEY, id: '1'.repeat(64), sig: '2'.repeat(128) })),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn(),
    ...overrides
  };
}

function response(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(invoiceValue = BOLT11_1000_SATS) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/.well-known/lnurlp/workstr')) {
      return response({ callback: 'https://coinos.io/lnurl/callback', allowsNostr: true, nostrPubkey: ZAP_RECEIPT_SIGNER_PUBKEY, minSendable: 1000, maxSendable: 1_000_000_000 });
    }
    return response({ pr: invoiceValue });
  });
}

function fakeTransport(handler: (payload: NwcRequestPayload) => NwcResponsePayload): NwcClientTransport {
  return { request: vi.fn(async (_connection, payload) => handler(payload)) };
}

describe('executeSupportZap', () => {
  it('signs an operator zap request, obtains an invoice, and pays it through NWC', async () => {
    const testSigner = signer();
    const fetchImpl = fakeFetch();
    const transport = fakeTransport((payload) => {
      expect(payload).toEqual({ method: 'pay_invoice', params: { invoice: BOLT11_1000_SATS } });
      return { result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 7, payment_hash: 'h'.repeat(64) } };
    });

    const result = await executeSupportZap({
      amountSats: 1000,
      comment: 'keep building',
      signer: testSigner,
      nwcConnection: parseNwcConnectionString(NWC),
      createdAt: 1_800_000_123
    }, { fetch: fetchImpl as typeof fetch, nwc: { transport } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.invoice).toBe(BOLT11_1000_SATS);
    expect(result.value.amountSats).toBe(1000);
    expect(result.value.zapRequest).toMatchObject({ kind: 9734, pubkey: SENDER_PUBKEY, content: 'keep building' });
    expect(result.value.zapRequest.tags).toContainEqual(['p', OPERATOR_PUBKEY]);
    expect(result.value.zapRequest.tags).toContainEqual(['amount', '1000000']);
    const lnurl = result.value.zapRequest.tags.find((tag) => tag[0] === 'lnurl')?.[1] || '';
    expect(lnurl).toMatch(/^lnurl1/);
    expect(lnurl).not.toContain(OPERATOR_LUD16);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('amount=1000000');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('nostr=');
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('rejects invoice amount mismatches before asking the wallet to pay', async () => {
    const transport = fakeTransport(() => ({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64) } }));
    const result = await executeSupportZap({
      amountSats: 1000,
      signer: signer(),
      nwcConnection: parseNwcConnectionString(NWC)
    }, { fetch: fakeFetch(BOLT11_21_SATS) as typeof fetch, nwc: { transport } });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-invoice' } });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('returns actionable payment failures without leaking the NWC secret', async () => {
    const transport = fakeTransport(() => ({ result_type: 'pay_invoice', error: { code: 'UNAUTHORIZED', message: `denied secret=${SECRET}` } }));
    const result = await executeSupportZap({
      amountSats: 1000,
      signer: signer(),
      nwcConnection: parseNwcConnectionString(NWC)
    }, { fetch: fakeFetch() as typeof fetch, nwc: { transport } });

    expect(result).toMatchObject({ ok: false, error: { code: 'payment-failed', nwcKind: 'rejected_unauthorized' } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });
});
