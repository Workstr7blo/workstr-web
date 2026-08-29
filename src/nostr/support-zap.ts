import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { OPERATOR_LUD16, ZAP_RECEIPT_SIGNER_PUBKEY, ZAP_RELAYS } from '../core/funding';
import type { Signer, SignedNostrEvent } from '../signer/types';
import { OPERATOR_PUBKEY } from './canon';
import { NwcError, toNwcError, type NwcConnection, type NwcErrorCode, type NwcFailureKind } from './nwc';
import { payInvoice, type NwcClientOptions, type NwcPaymentResult } from './nwc-client';

export type SupportZapFailureCode =
  | 'missing-signer'
  | 'invalid-amount'
  | 'invalid-comment'
  | 'signing-failed'
  | 'invoice-request-failed'
  | 'invalid-invoice'
  | 'payment-failed';

export interface SupportZapFailure {
  code: SupportZapFailureCode;
  message: string;
  nwcCode?: NwcErrorCode;
  nwcKind?: NwcFailureKind;
}

export interface SupportZapSuccess {
  invoice: string;
  amountSats: number;
  zapRequest: SignedNostrEvent;
  payment: NwcPaymentResult;
}

export type SupportZapResult = { ok: true; value: SupportZapSuccess } | { ok: false; error: SupportZapFailure };

export interface SupportZapInput {
  amountSats: number;
  comment?: string;
  signer: Signer | null;
  nwcConnection: NwcConnection;
  createdAt?: number;
}

export interface SupportZapOptions {
  fetch?: typeof fetch;
  nwc?: NwcClientOptions;
}

const MAX_SUPPORT_ZAP_SATS = 1_000_000;
const MAX_COMMENT_CHARS = 280;
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function fail(code: SupportZapFailureCode, message: string, extra: Partial<SupportZapFailure> = {}): SupportZapResult {
  return { ok: false, error: { code, message, ...extra } };
}

function lnurlpEndpoint(lud16: string): string | null {
  const [name, domain] = lud16.split('@');
  if (!name || !domain) return null;
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    generators.forEach((generator, index) => { if (((top >> index) & 1) === 1) chk ^= generator; });
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat([0], [...hrp].map((char) => char.charCodeAt(0) & 31));
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number): number[] {
  const result: number[] = [];
  let value = 0;
  let bits = 0;
  const maxValue = (1 << toBits) - 1;
  for (const byte of data) {
    value = (value << fromBits) | byte;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((value >> bits) & maxValue);
    }
  }
  if (bits > 0) result.push((value << (toBits - bits)) & maxValue);
  return result;
}

function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = convertBits(data, 8, 5);
  const checksumInput = bech32HrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(checksumInput) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (polymod >> (5 * (5 - index))) & 31);
  return `${hrp}1${words.concat(checksum).map((word) => BECH32_CHARSET[word]).join('')}`;
}

function lnurlTag(url: string): string {
  return bech32Encode('lnurl', new TextEncoder().encode(url.toLowerCase()));
}

function checkedAmountSats(amountSats: number): number | SupportZapFailure {
  if (!Number.isInteger(amountSats) || amountSats <= 0 || amountSats > MAX_SUPPORT_ZAP_SATS) {
    return { code: 'invalid-amount', message: `Zap amount must be a whole number between 1 and ${MAX_SUPPORT_ZAP_SATS.toLocaleString('en-US')} sats.` };
  }
  return amountSats;
}

function checkedComment(comment: string | undefined): string | SupportZapFailure {
  const value = (comment || '').trim();
  if (value.length > MAX_COMMENT_CHARS || /\p{C}/u.test(value.replace(/[\n\r\t]/g, ''))) {
    return { code: 'invalid-comment', message: `Zap note must be ${MAX_COMMENT_CHARS} characters or fewer.` };
  }
  return value;
}

async function requestOperatorInvoice(
  zapRequest: SignedNostrEvent,
  amountMsat: number,
  comment: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const endpoint = lnurlpEndpoint(OPERATOR_LUD16);
  if (!endpoint) throw new Error('Operator zap target is not configured.');
  const metadataResponse = await fetchImpl(endpoint);
  if (!metadataResponse.ok) throw new Error('Zap target was unreachable.');
  const metadata = await metadataResponse.json() as { callback?: string; allowsNostr?: boolean; nostrPubkey?: string; minSendable?: number; maxSendable?: number };
  if (!metadata.callback || metadata.allowsNostr !== true || !metadata.nostrPubkey) {
    throw new Error('Zap target does not support Nostr zaps.');
  }
  if (metadata.nostrPubkey !== ZAP_RECEIPT_SIGNER_PUBKEY) {
    throw new Error('Zap target signer did not match Workstr receipts.');
  }
  if (typeof metadata.minSendable === 'number' && amountMsat < metadata.minSendable) throw new Error('Zap amount is below the target minimum.');
  if (typeof metadata.maxSendable === 'number' && amountMsat > metadata.maxSendable) throw new Error('Zap amount is above the target maximum.');

  const callback = new URL(metadata.callback);
  callback.searchParams.set('amount', String(amountMsat));
  callback.searchParams.set('nostr', JSON.stringify(zapRequest));
  if (comment) callback.searchParams.set('comment', comment);

  const invoiceResponse = await fetchImpl(callback.toString());
  if (!invoiceResponse.ok) throw new Error('Zap invoice request was rejected.');
  const body = await invoiceResponse.json() as { pr?: string; status?: string; reason?: string };
  if (body.status === 'ERROR') throw new Error(body.reason || 'Zap invoice request failed.');
  if (!body.pr) throw new Error('Zap invoice response was missing an invoice.');
  return body.pr;
}

function verifyInvoiceAmount(invoice: string, amountSats: number): SupportZapResult | null {
  try {
    if (getSatoshisAmountFromBolt11(invoice) !== amountSats) {
      return fail('invalid-invoice', 'Wallet invoice amount did not match the requested zap.');
    }
  } catch {
    return fail('invalid-invoice', 'Wallet invoice could not be read safely.');
  }
  return null;
}

function paymentFailure(error: NwcError): SupportZapResult {
  return fail('payment-failed', error.message || 'Wallet could not complete the zap payment.', { nwcCode: error.code, nwcKind: error.kind });
}

export async function executeSupportZap(input: SupportZapInput, options: SupportZapOptions = {}): Promise<SupportZapResult> {
  if (!input.signer) return fail('missing-signer', 'Sign in before sending an in-app zap so Workstr can create a Nostr receipt request.');
  const amount = checkedAmountSats(input.amountSats);
  if (typeof amount !== 'number') return { ok: false, error: amount };
  const comment = checkedComment(input.comment);
  if (typeof comment !== 'string') return { ok: false, error: comment };

  let zapRequest: SignedNostrEvent;
  try {
    const pubkey = await input.signer.getPublicKey();
    const endpoint = lnurlpEndpoint(OPERATOR_LUD16);
    if (!endpoint) return fail('invoice-request-failed', 'Operator zap target is not configured.');
    zapRequest = await input.signer.signEvent({
      kind: 9734,
      created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
      pubkey,
      tags: [
        ['relays', ...ZAP_RELAYS],
        ['amount', String(amount * 1000)],
        ['p', OPERATOR_PUBKEY],
        ['lnurl', lnurlTag(endpoint)],
        ['client', 'workstr']
      ],
      content: comment
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error || '');
    return fail('signing-failed', /reject|denied|cancel/i.test(raw) ? 'Zap was cancelled in the signer.' : 'Could not sign the zap request.');
  }

  let invoice: string;
  try {
    invoice = await requestOperatorInvoice(zapRequest, amount * 1000, comment, options.fetch ?? fetch);
  } catch {
    return fail('invoice-request-failed', 'Could not request a zap invoice. Check the zap target and try again.');
  }

  const invoiceError = verifyInvoiceAmount(invoice, amount);
  if (invoiceError) return invoiceError;

  try {
    const payment = await payInvoice(input.nwcConnection, invoice, options.nwc);
    return { ok: true, value: { invoice, amountSats: amount, zapRequest, payment } };
  } catch (error) {
    return paymentFailure(toNwcError(error));
  }
}
