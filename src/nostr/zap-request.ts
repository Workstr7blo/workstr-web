import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import type { UnsignedNostrEvent } from '../signer/types';
import type { RecipientDescriptor } from './zaps';

export type WorkoutProgramZapPayloadErrorCode =
  | 'missing-recipient'
  | 'invalid-amount'
  | 'invalid-comment'
  | 'invalid-relays'
  | 'invalid-invoice';

export interface WorkoutProgramZapPayloadError {
  code: WorkoutProgramZapPayloadErrorCode;
  message: string;
  field?: string;
}

export interface WorkoutProgramZapInput {
  amountSats: number;
  comment?: string;
  senderPubkey?: string;
  relays?: string[];
  createdAt?: number;
}

export interface WorkoutProgramZapRequestPayload {
  event: UnsignedNostrEvent;
  amountMsat: number;
  comment: string;
  recipient: RecipientDescriptor;
  relays: string[];
  lnurl: string;
  programAddress: string;
}

export type WorkoutProgramZapRequestResult =
  | { ok: true; payload: WorkoutProgramZapRequestPayload }
  | { ok: false; error: WorkoutProgramZapPayloadError };

export interface NwcZapPaymentPayload {
  method: 'pay_invoice';
  params: { invoice: string };
}

export type NwcZapPaymentPayloadResult =
  | { ok: true; payload: NwcZapPaymentPayload }
  | { ok: false; error: WorkoutProgramZapPayloadError };

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const MAX_ZAP_SATS = 1_000_000;
const MAX_ZAP_COMMENT_CHARS = 500;

function payloadFail(code: WorkoutProgramZapPayloadErrorCode, message: string, field?: string): WorkoutProgramZapRequestResult {
  return { ok: false, error: { code, message, field } };
}

function paymentFail(code: WorkoutProgramZapPayloadErrorCode, message: string, field?: string): NwcZapPaymentPayloadResult {
  return { ok: false, error: { code, message, field } };
}

function isRelayUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
  } catch {
    return false;
  }
}

function normalizedRelays(relays: string[] | undefined, fallback: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const relay of (relays?.length ? relays : fallback).map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(relay)) continue;
    seen.add(relay);
    out.push(relay);
  }
  return out;
}

function validateZapInput(input: WorkoutProgramZapInput): { amountMsat: number; comment: string } | WorkoutProgramZapPayloadError {
  if (!Number.isInteger(input.amountSats) || input.amountSats <= 0 || input.amountSats > MAX_ZAP_SATS) {
    return { code: 'invalid-amount', message: `Zap amount must be a whole number between 1 and ${MAX_ZAP_SATS} sats.`, field: 'amountSats' };
  }
  const comment = (input.comment || '').trim();
  if (comment.length > MAX_ZAP_COMMENT_CHARS) {
    return { code: 'invalid-comment', message: `Zap comment must be ${MAX_ZAP_COMMENT_CHARS} characters or fewer.`, field: 'comment' };
  }
  if (/\p{C}/u.test(comment.replace(/[\n\r\t]/g, ''))) {
    return { code: 'invalid-comment', message: 'Zap comment contains unsupported control characters.', field: 'comment' };
  }
  return { amountMsat: input.amountSats * 1000, comment };
}

export function buildWorkoutProgramZapRequestPayload(
  recipient: RecipientDescriptor | null | undefined,
  input: WorkoutProgramZapInput
): WorkoutProgramZapRequestResult {
  if (!recipient) return payloadFail('missing-recipient', 'Workout program zap recipient is required.', 'recipient');
  if (!HEX_PUBKEY.test(recipient.pubkey || '')) {
    return payloadFail('missing-recipient', 'Workout program zap recipient has an invalid pubkey.', 'recipient.pubkey');
  }
  if (!recipient.programAddress || !recipient.programAddress.startsWith(`33402:${recipient.pubkey}:`)) {
    return payloadFail('missing-recipient', 'Workout program zap recipient is missing the program address.', 'recipient.programAddress');
  }
  const checked = validateZapInput(input);
  if ('code' in checked) return { ok: false, error: checked };
  const relays = normalizedRelays(input.relays, recipient.relays);
  if (!relays.length || relays.some((relay) => !isRelayUrl(relay))) {
    return payloadFail('invalid-relays', 'Zap request relays must be ws:// or wss:// URLs.', 'relays');
  }
  const tags = [
    ['relays', ...relays],
    ['amount', String(checked.amountMsat)],
    ['p', recipient.pubkey],
    ['a', recipient.programAddress],
    ['lnurl', recipient.lnurl],
    ['client', 'workstr'],
    ['app', recipient.app]
  ];
  const event: UnsignedNostrEvent = {
    kind: 9734,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: checked.comment
  };
  if (input.senderPubkey) event.pubkey = input.senderPubkey;
  return {
    ok: true,
    payload: {
      event,
      amountMsat: checked.amountMsat,
      comment: checked.comment,
      recipient,
      relays,
      lnurl: recipient.lnurl,
      programAddress: recipient.programAddress
    }
  };
}

export function buildNwcZapPaymentPayload(invoice: string, expectedAmountSats: number): NwcZapPaymentPayloadResult {
  const bolt11 = invoice.trim();
  if (!bolt11) return paymentFail('invalid-invoice', 'Lightning invoice is required.', 'invoice');
  let invoiceSats = 0;
  try {
    invoiceSats = getSatoshisAmountFromBolt11(bolt11);
  } catch {
    return paymentFail('invalid-invoice', 'Lightning invoice could not be parsed.', 'invoice');
  }
  if (!Number.isInteger(expectedAmountSats) || expectedAmountSats <= 0 || expectedAmountSats > MAX_ZAP_SATS) {
    return paymentFail('invalid-amount', `Zap amount must be a whole number between 1 and ${MAX_ZAP_SATS} sats.`, 'amountSats');
  }
  if (invoiceSats !== expectedAmountSats) {
    return paymentFail('invalid-invoice', 'Lightning invoice amount does not match the requested zap amount.', 'invoice');
  }
  return { ok: true, payload: { method: 'pay_invoice', params: { invoice: bolt11 } } };
}
