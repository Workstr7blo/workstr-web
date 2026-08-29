import { describe, expect, it, vi } from 'vitest';
import { NwcError, parseNwcConnectionString, type NwcConnection } from '../src/nostr/nwc';
import {
  payInvoice,
  payInvoiceResult,
  validateNwcConnection,
  verifyNwcConnection,
  type NwcClientTransport,
  type NwcRequestPayload,
  type NwcResponsePayload
} from '../src/nostr/nwc-client';

const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const VALID = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;
const INVOICE = 'lnbc10n1pptestinvoice';

function connection(): NwcConnection {
  return parseNwcConnectionString(VALID);
}

function fakeTransport(response: NwcResponsePayload): NwcClientTransport;
function fakeTransport(handler: (payload: NwcRequestPayload) => Promise<NwcResponsePayload> | NwcResponsePayload): NwcClientTransport;
function fakeTransport(input: NwcResponsePayload | ((payload: NwcRequestPayload) => Promise<NwcResponsePayload> | NwcResponsePayload)): NwcClientTransport {
  const handler = typeof input === 'function' ? input : () => input;
  return {
    request: vi.fn(async (_connection: NwcConnection, payload: NwcRequestPayload) => handler(payload))
  };
}

describe('verifyNwcConnection', () => {
  it('validates usable NWC connections by performing a get_info round trip', async () => {
    const transport = fakeTransport((payload) => {
      expect(payload).toEqual({ method: 'get_info', params: {} });
      return { result_type: 'get_info', result: { alias: 'Test Wallet', methods: ['get_info', 'pay_invoice'], notifications: ['payment_received'] } };
    });

    const info = await verifyNwcConnection(connection(), { transport });

    expect(info).toEqual({ alias: 'Test Wallet', methods: ['get_info', 'pay_invoice'], notifications: ['payment_received'] });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('rejects validation when the wallet does not support pay_invoice', async () => {
    const transport = fakeTransport({ result_type: 'get_info', result: { methods: ['get_info'] } });

    const result = await validateNwcConnection(connection(), { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported_method');
      expect(result.error.kind).toBe('rejected_unauthorized');
    }
  });

  it('maps unauthorized wallet validation responses distinctly', async () => {
    const transport = fakeTransport({ result_type: 'get_info', error: { code: 'UNAUTHORIZED', message: 'budget denied' } });

    const result = await validateNwcConnection(connection(), { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rejected_unauthorized');
      expect(result.error.kind).toBe('rejected_unauthorized');
      expect(result.error.causeCode).toBe('UNAUTHORIZED');
    }
  });

  it('maps expired wallet validation responses distinctly', async () => {
    const transport = fakeTransport({ result_type: 'get_info', error: { code: 'EXPIRED', message: 'connection expired' } });

    const result = await validateNwcConnection(connection(), { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('expired_connection');
  });

  it('maps unreachable relay/service failures without crashing', async () => {
    const transport = fakeTransport(async () => { throw new NwcError('unreachable_service', 'network down'); });

    const result = await validateNwcConnection(connection(), { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unreachable_service');
      expect(result.error.kind).toBe('unreachable_service');
      expect(result.error.message).toContain('network down');
    }
  });

  it('maps wallet timeouts as typed unreachable-service failures', async () => {
    const transport = fakeTransport(async () => { throw new NwcError('timeout', 'wallet did not answer'); });

    const result = await validateNwcConnection(connection(), { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.kind).toBe('unreachable_service');
    }
  });
});

describe('payInvoice', () => {
  it('submits a Lightning invoice over NWC and returns safe payment metadata', async () => {
    const transport = fakeTransport((payload) => {
      expect(payload).toEqual({ method: 'pay_invoice', params: { invoice: INVOICE } });
      return { result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 21, payment_hash: 'h'.repeat(64) } };
    });

    const paid = await payInvoice(connection(), ` ${INVOICE} `, { transport });

    expect(paid).toEqual({ preimage: 'p'.repeat(64), feesPaidMsat: 21, paymentHash: 'h'.repeat(64) });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('returns a typed success result wrapper', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64) } });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.preimage).toBe('p'.repeat(64));
  });

  it('rejects malformed invoices before contacting the wallet', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64) } });

    const result = await payInvoiceResult(connection(), 'not an invoice', { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_request');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('maps invalid request responses from the service', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', error: { code: 'INVALID_REQUEST', message: 'invoice missing' } });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_request');
      expect(result.error.causeCode).toBe('INVALID_REQUEST');
    }
  });

  it('maps payment failed responses distinctly', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', error: { code: 'PAYMENT_FAILED', message: 'route failed' } });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('payment_failure');
  });

  it('maps payment timeouts without leaking connection credentials', async () => {
    const transport = fakeTransport(async () => { throw new NwcError('timeout', `slow wallet ${VALID}`); });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.kind).toBe('unreachable_service');
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
      expect(JSON.stringify(result.error)).not.toContain(VALID);
    }
  });

  it('maps unknown wallet responses distinctly and redacts accidental secrets', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', error: { code: 'INTERNAL', message: `oops ${VALID}` } });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('unknown_failure');
      expect(result.error.message).not.toContain(SECRET);
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
    }
  });

  it('treats a success response without a preimage as payment failure', async () => {
    const transport = fakeTransport({ result_type: 'pay_invoice', result: { fees_paid: 1 } });

    const result = await payInvoiceResult(connection(), INVOICE, { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('payment_failure');
  });
});
