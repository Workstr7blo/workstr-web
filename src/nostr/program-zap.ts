import type { SignedNostrEvent, Signer } from '../signer/types';
import type { RelayProgram } from './canon';
import { NwcError, toNwcError, type NwcConnection, type NwcErrorCode, type NwcFailureKind } from './nwc';
import { payInvoice, type NwcClientOptions, type NwcPaymentResult } from './nwc-client';
import { buildNwcZapPaymentPayload, buildWorkoutProgramZapRequestPayload } from './zap-request';
import { decodeLnurl, lud16ToLnurlPayEndpoint } from './lnurl';
import { resolveWorkoutProgramZapRecipient, type RecipientDescriptor, type WorkoutProgramZapSource, type ZapRecipientResolutionError } from './zaps';

export type WorkoutProgramZapFailureCode =
  | 'missing-wallet-connection'
  | 'invalid-recipient'
  | 'invalid-zap-request'
  | 'signing-failed'
  | 'invoice-request-failed'
  | 'invalid-invoice'
  | 'payment-failed';

export interface WorkoutProgramZapFailure {
  code: WorkoutProgramZapFailureCode;
  message: string;
  field?: string;
  recipientError?: ZapRecipientResolutionError;
  nwcCode?: NwcErrorCode;
  nwcKind?: NwcFailureKind;
}

export interface WorkoutProgramZapSuccess {
  invoice: string;
  amountSats: number;
  programAddress: string;
  recipient: RecipientDescriptor;
  zapRequest: SignedNostrEvent;
  payment: NwcPaymentResult;
}

export type WorkoutProgramZapResult =
  | { ok: true; value: WorkoutProgramZapSuccess }
  | { ok: false; error: WorkoutProgramZapFailure };

export interface WorkoutProgramZapInput {
  program: RelayProgram | WorkoutProgramZapSource;
  amountSats: number;
  comment?: string;
  signer: Signer;
  nwcConnection: NwcConnection | null | undefined;
  relays?: string[];
  createdAt?: number;
}

export interface ZapInvoiceRequest {
  recipient: RecipientDescriptor;
  zapRequest: SignedNostrEvent;
  amountMsat: number;
  comment: string;
}

export interface ZapInvoiceResponse {
  invoice: string;
}

export interface ExecuteWorkoutProgramZapOptions {
  fetchInvoice?: (request: ZapInvoiceRequest) => Promise<ZapInvoiceResponse>;
  nwc?: NwcClientOptions;
}

function failure(code: WorkoutProgramZapFailureCode, message: string, extra: Partial<WorkoutProgramZapFailure> = {}): WorkoutProgramZapResult {
  return { ok: false, error: { code, message, ...extra } };
}

function zapEndpointFromRecipient(recipient: RecipientDescriptor): string | null {
  const lud16 = recipient.lud16 || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.lnurl) ? recipient.lnurl : '');
  if (lud16) return lud16ToLnurlPayEndpoint(lud16);
  const endpoint = decodeLnurl(recipient.lud06 || recipient.lnurl);
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function defaultFetchInvoice(request: ZapInvoiceRequest): Promise<ZapInvoiceResponse> {
  const endpoint = zapEndpointFromRecipient(request.recipient);
  if (!endpoint) throw new Error('Unsupported zap recipient LNURL.');
  const metadataResponse = await fetch(endpoint);
  if (!metadataResponse.ok) throw new Error('Zap recipient metadata was unreachable.');
  const metadata = await metadataResponse.json() as { callback?: string; allowsNostr?: boolean; minSendable?: number; maxSendable?: number };
  if (!metadata.callback || metadata.allowsNostr !== true) throw new Error('Zap recipient does not support Nostr zaps.');
  if (typeof metadata.minSendable === 'number' && request.amountMsat < metadata.minSendable) throw new Error('Zap amount is below the recipient minimum.');
  if (typeof metadata.maxSendable === 'number' && request.amountMsat > metadata.maxSendable) throw new Error('Zap amount is above the recipient maximum.');

  const callback = new URL(metadata.callback);
  callback.searchParams.set('amount', String(request.amountMsat));
  callback.searchParams.set('nostr', JSON.stringify(request.zapRequest));
  if (request.comment) callback.searchParams.set('comment', request.comment);

  const invoiceResponse = await fetch(callback.toString());
  if (!invoiceResponse.ok) throw new Error('Zap invoice request was rejected.');
  const invoice = await invoiceResponse.json() as { pr?: string; status?: string; reason?: string };
  if (invoice.status === 'ERROR') throw new Error(invoice.reason || 'Zap invoice request failed.');
  if (!invoice.pr) throw new Error('Zap invoice response was missing an invoice.');
  return { invoice: invoice.pr };
}

function signingFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/reject|denied|cancel/i.test(raw)) return 'Zap was cancelled in the signer.';
  if (/unauthori[sz]ed|permission|forbidden|not allowed|not permitted/i.test(raw)) {
    return 'Signer is missing permission to sign zap requests. Reconnect your signer and approve program zap signing.';
  }
  return 'Could not sign the zap request.';
}

function paymentFailure(error: NwcError): WorkoutProgramZapResult {
  const code: WorkoutProgramZapFailureCode = error.kind === 'payment_failure' ? 'payment-failed' : 'payment-failed';
  return failure(code, error.message || 'Wallet could not complete the zap payment.', {
    nwcCode: error.code,
    nwcKind: error.kind
  });
}

export async function executeWorkoutProgramZap(
  input: WorkoutProgramZapInput,
  options: ExecuteWorkoutProgramZapOptions = {}
): Promise<WorkoutProgramZapResult> {
  if (!input.nwcConnection) {
    return failure('missing-wallet-connection', 'Connect a Nostr Wallet Connect wallet before zapping programs.', { field: 'nwcConnection' });
  }

  const recipientResult = resolveWorkoutProgramZapRecipient(input.program as WorkoutProgramZapSource);
  if (!recipientResult.ok) {
    return failure('invalid-recipient', recipientResult.error.message, { field: recipientResult.error.field, recipientError: recipientResult.error });
  }

  let senderPubkey: string;
  try {
    senderPubkey = await input.signer.getPublicKey();
  } catch (error) {
    return failure('signing-failed', signingFailureMessage(error));
  }

  const requestResult = buildWorkoutProgramZapRequestPayload(recipientResult.recipient, {
    amountSats: input.amountSats,
    comment: input.comment,
    senderPubkey,
    relays: input.relays,
    createdAt: input.createdAt
  });
  if (!requestResult.ok) {
    return failure('invalid-zap-request', requestResult.error.message, { field: requestResult.error.field });
  }

  let zapRequest: SignedNostrEvent;
  try {
    zapRequest = await input.signer.signEvent(requestResult.payload.event);
  } catch (error) {
    return failure('signing-failed', signingFailureMessage(error));
  }

  let invoice: string;
  try {
    invoice = (await (options.fetchInvoice ?? defaultFetchInvoice)({
      recipient: recipientResult.recipient,
      zapRequest,
      amountMsat: requestResult.payload.amountMsat,
      comment: requestResult.payload.comment
    })).invoice;
  } catch {
    return failure('invoice-request-failed', 'Could not request a zap invoice from the program author.');
  }

  const paymentPayload = buildNwcZapPaymentPayload(invoice, input.amountSats);
  if (!paymentPayload.ok) {
    return failure('invalid-invoice', paymentPayload.error.message, { field: paymentPayload.error.field });
  }

  try {
    const payment = await payInvoice(input.nwcConnection, paymentPayload.payload.params.invoice, options.nwc);
    return {
      ok: true,
      value: {
        invoice: paymentPayload.payload.params.invoice,
        amountSats: input.amountSats,
        programAddress: recipientResult.recipient.programAddress,
        recipient: recipientResult.recipient,
        zapRequest,
        payment
      }
    };
  } catch (error) {
    return paymentFailure(toNwcError(error));
  }
}
