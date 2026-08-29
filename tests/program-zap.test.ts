import { describe, expect, it, vi } from 'vitest';
import type { UnsignedNostrEvent, Signer } from '../src/signer/types';
import type { WorkoutProgramZapSource } from '../src/nostr/zaps';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';
import { parseNwcConnectionString, type NwcConnection } from '../src/nostr/nwc';
import { executeWorkoutProgramZap } from '../src/nostr/program-zap';
import type { NwcClientTransport, NwcRequestPayload, NwcResponsePayload } from '../src/nostr/nwc-client';
import { encodeLnurl } from '../src/nostr/lnurl';

const invoice = (hrp: string) => `${hrp}1${'q'.repeat(60)}`;
const BOLT11_21_SATS = invoice('lnbc210n');
const BOLT11_1000_SATS = invoice('lnbc10u');
const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const NWC = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;
const SENDER_PUBKEY = 'f'.repeat(64);

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

function connection(): NwcConnection {
  return parseNwcConnectionString(NWC);
}

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

function fakeTransport(response: NwcResponsePayload): NwcClientTransport;
function fakeTransport(handler: (payload: NwcRequestPayload) => NwcResponsePayload): NwcClientTransport;
function fakeTransport(input: NwcResponsePayload | ((payload: NwcRequestPayload) => NwcResponsePayload)): NwcClientTransport {
  const handler = typeof input === 'function' ? input : () => input;
  return { request: vi.fn(async (_connection, payload) => handler(payload)) };
}

describe('executeWorkoutProgramZap', () => {
  it('resolves the program recipient, signs a zap request, requests an invoice, and pays through NWC', async () => {
    const fetchInvoice = vi.fn(async ({ zapRequest, amountMsat }) => {
      expect(zapRequest.kind).toBe(9734);
      expect(zapRequest.pubkey).toBe(SENDER_PUBKEY);
      expect(zapRequest.tags).toContainEqual(['p', OPERATOR_PUBKEY]);
      expect(zapRequest.tags).toContainEqual(['a', `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`]);
      expect(amountMsat).toBe(21_000);
      return { invoice: BOLT11_21_SATS };
    });
    const transport = fakeTransport((payload) => {
      expect(payload).toEqual({ method: 'pay_invoice', params: { invoice: BOLT11_21_SATS } });
      return { result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 7, payment_hash: 'h'.repeat(64) } };
    });

    const result = await executeWorkoutProgramZap({
      program: program({ zapRecipient: { relays: ['wss://relay.example'] } }),
      amountSats: 21,
      comment: 'great set',
      signer: signer(),
      nwcConnection: connection(),
      createdAt: 1_800_000_123
    }, { fetchInvoice, nwc: { transport } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.invoice).toBe(BOLT11_21_SATS);
    expect(result.value.amountSats).toBe(21);
    expect(result.value.payment).toEqual({ preimage: 'p'.repeat(64), feesPaidMsat: 7, paymentHash: 'h'.repeat(64) });
    expect(fetchInvoice).toHaveBeenCalledTimes(1);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('returns a graceful failure when no NWC wallet is connected', async () => {
    const fetchInvoice = vi.fn(async () => ({ invoice: BOLT11_21_SATS }));
    const result = await executeWorkoutProgramZap({ program: program(), amountSats: 21, signer: signer(), nwcConnection: null }, { fetchInvoice });

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-wallet-connection', field: 'nwcConnection' } });
    expect(fetchInvoice).not.toHaveBeenCalled();
  });

  it('returns a structured recipient failure for invalid program zap metadata', async () => {
    const fetchInvoice = vi.fn(async () => ({ invoice: BOLT11_21_SATS }));
    const result = await executeWorkoutProgramZap({ program: program({ lud16: undefined, lud06: undefined }), amountSats: 21, signer: signer(), nwcConnection: connection() }, { fetchInvoice });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-recipient', recipientError: { code: 'missing-lnurl' } } });
    expect(fetchInvoice).not.toHaveBeenCalled();
  });

  it('normalizes signer rejection without leaking low-level exceptions', async () => {
    const result = await executeWorkoutProgramZap({
      program: program(),
      amountSats: 21,
      signer: signer({ signEvent: vi.fn(async () => { throw new Error('User rejected event signing in extension'); }) }),
      nwcConnection: connection()
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'signing-failed', message: 'Zap was cancelled in the signer.' } });
  });

  it('rejects bad invoices before sending anything to the wallet', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64) } });
    const result = await executeWorkoutProgramZap({
      program: program(),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection()
    }, { fetchInvoice: vi.fn(async () => ({ invoice: BOLT11_1000_SATS })), nwc: { transport } });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-invoice', field: 'invoice' } });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('maps NWC wallet failures into structured payment failures', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', error: { code: 'UNAUTHORIZED', message: 'user denied payment' } });

    const result = await executeWorkoutProgramZap({
      program: program(),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection()
    }, { fetchInvoice: vi.fn(async () => ({ invoice: BOLT11_21_SATS })), nwc: { transport } });

    expect(result).toMatchObject({ ok: false, error: { code: 'payment-failed', nwcCode: 'rejected_unauthorized', nwcKind: 'rejected_unauthorized' } });
  });

  it('returns invoice-request-failed when the recipient cannot issue an invoice', async () => {
    const result = await executeWorkoutProgramZap({
      program: program(),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection()
    }, { fetchInvoice: vi.fn(async () => { throw new Error('callback exploded with details'); }) });

    expect(result).toMatchObject({ ok: false, error: { code: 'invoice-request-failed', message: 'Could not request a zap invoice from the program author.' } });
  });

  it('resolves lud06-only recipients through the default LNURL invoice flow', async () => {
    const endpoint = 'https://wallet.example/lnurlp/coach';
    const callback = 'https://wallet.example/zap/callback';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === endpoint) {
        return new Response(JSON.stringify({ callback, allowsNostr: true, minSendable: 1_000, maxSendable: 100_000 }), { status: 200 });
      }
      const parsed = new URL(url);
      expect(`${parsed.origin}${parsed.pathname}`).toBe(callback);
      expect(parsed.searchParams.get('amount')).toBe('21000');
      expect(parsed.searchParams.get('nostr')).toContain('9734');
      expect(parsed.searchParams.get('comment')).toBe('lud06 zap');
      return new Response(JSON.stringify({ pr: BOLT11_21_SATS }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const transport = fakeTransport({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 0, payment_hash: 'h'.repeat(64) } });
      const result = await executeWorkoutProgramZap({
        program: program({ lud16: undefined, lud06: encodeLnurl(endpoint) }),
        amountSats: 21,
        comment: 'lud06 zap',
        signer: signer(),
        nwcConnection: connection()
      }, { nwc: { transport } });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.recipient.lud06).toBe(encodeLnurl(endpoint));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(transport.request).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
