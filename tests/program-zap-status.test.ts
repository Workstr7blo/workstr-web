import { describe, expect, it, vi } from 'vitest';
import type { UnsignedNostrEvent, Signer } from '../src/signer/types';
import { WorkstrStore } from '../src/db/store';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';
import { parseNwcConnectionString, type NwcConnection } from '../src/nostr/nwc';
import { executeWorkoutProgramZapWithStatus } from '../src/nostr/program-zap-status';
import type { NwcClientTransport, NwcRequestPayload, NwcResponsePayload } from '../src/nostr/nwc-client';
import type { WorkoutProgramZapSource } from '../src/nostr/zaps';
import { decodeLnurl } from '../src/nostr/lnurl';

const invoice = (hrp: string) => `${hrp}1${'q'.repeat(60)}`;
const BOLT11_21_SATS = invoice('lnbc210n');
const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const NWC = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;
const SENDER_PUBKEY = 'f'.repeat(64);
let counter = 0;

function namespace(): string {
  counter += 1;
  return `program-zap-status-${counter}`;
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

describe('workout program zap status persistence', () => {
  it('persists a pending attempt, then a successful NWC result that survives reopening the store', async () => {
    const ns = namespace();
    const store = await WorkstrStore.open(ns);
    const updates: string[] = [];

    const { attempt, result } = await executeWorkoutProgramZapWithStatus(store, {
      program: program(),
      amountSats: 21,
      comment: 'great program',
      signer: signer(),
      nwcConnection: connection()
    }, {
      fetchInvoice: vi.fn(async () => ({ invoice: BOLT11_21_SATS })),
      nwc: { transport: fakeTransport({ result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 7, payment_hash: 'h'.repeat(64) } }) },
      onStatus: ({ attempt: update }) => updates.push(update.status)
    });

    expect(result.ok).toBe(true);
    expect(updates).toEqual(['pending', 'succeeded']);
    expect(attempt).toMatchObject({
      status: 'succeeded',
      programAddress: `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`,
      programName: 'Push Day',
      amountSats: 21,
      recipientPubkey: OPERATOR_PUBKEY,
      invoice: BOLT11_21_SATS,
      paymentHash: 'h'.repeat(64),
      feesPaidMsat: 7
    });
    expect(attempt.recipientLnurl).not.toBe('coach@example.com');
    expect(decodeLnurl(attempt.recipientLnurl || '')).toBe('https://example.com/.well-known/lnurlp/coach');
    expect(JSON.stringify(attempt)).not.toContain('preimage');
    store.close();

    const reopened = await WorkstrStore.open(ns);
    expect(await reopened.getWorkoutProgramZapAttempt(attempt.id)).toMatchObject({ status: 'succeeded', invoice: BOLT11_21_SATS });
    expect(await reopened.listWorkoutProgramZapAttempts(`33402:${OPERATOR_PUBKEY}:workstr:program:push-day`)).toHaveLength(1);
    reopened.close();
  });

  it('persists safe failed NWC status metadata without leaking wallet secrets', async () => {
    const store = await WorkstrStore.open(namespace());

    const { attempt, result } = await executeWorkoutProgramZapWithStatus(store, {
      program: program(),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection()
    }, {
      fetchInvoice: vi.fn(async () => ({ invoice: BOLT11_21_SATS })),
      nwc: { transport: fakeTransport({ result_type: 'pay_invoice', error: { code: 'UNAUTHORIZED', message: `wallet denied secret=${SECRET}` } }) }
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'payment-failed', nwcCode: 'rejected_unauthorized' } });
    expect(attempt.status).toBe('failed');
    expect(attempt.errorMessage).toBe('wallet denied secret=[REDACTED]');
    expect(JSON.stringify(await store.listWorkoutProgramZapAttempts())).not.toContain(SECRET);
    store.close();
  });

  it('marks signer rejection as cancelled for UI callers', async () => {
    const store = await WorkstrStore.open(namespace());

    const { attempt } = await executeWorkoutProgramZapWithStatus(store, {
      program: program(),
      amountSats: 21,
      signer: signer({ signEvent: vi.fn(async () => { throw new Error('User rejected signing'); }) }),
      nwcConnection: connection()
    });

    expect(attempt).toMatchObject({ status: 'cancelled', errorCode: 'signing-failed', errorMessage: 'Zap was cancelled in the signer.' });
    expect(await store.getWorkoutProgramZapAttempt(attempt.id)).toMatchObject({ status: 'cancelled' });
    store.close();
  });
});
