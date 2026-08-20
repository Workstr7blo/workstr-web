import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { isRecordAddress, parseAddress, type RecordAddress } from '../sync/addresses';

// NIP-78 arbitrary app data. Shared with other clients, which is exactly why the relay
// policy also requires the address prefix rather than filtering on the kind alone.
export const PRIVATE_RECORD_KIND = 30078;
export const CLIENT_TAG = 'workstr';

// Envelope version, independent of the address prefix. The prefix is a relay contract and
// cannot change without an operator migration; this can, and a reader that meets a newer
// envelope should skip the record rather than misread it.
const ENVELOPE_VERSION = 1;

export interface PrivateRecord<T = unknown> {
  address: string;
  updatedAt: string;
  // A deleted record keeps its address and drops its payload: an addressable event cannot
  // be withdrawn from an open relay, so absence can never mean deletion.
  deleted?: boolean;
  payload?: T;
}

export interface DecodedPrivateRecord<T = unknown> extends PrivateRecord<T> {
  parsed: RecordAddress;
  eventId: string;
  createdAt: number;
}

function tagValue(tags: string[][], name: string): string {
  return (tags.find((tag) => tag[0] === name) || [])[1] || '';
}

export function buildPrivateRecordEvent(address: string, ciphertext: string, createdAt = Math.floor(Date.now() / 1000)): UnsignedNostrEvent {
  return {
    kind: PRIVATE_RECORD_KIND,
    created_at: createdAt,
    tags: [['d', address], ['client', CLIENT_TAG]],
    content: ciphertext
  };
}

// Encrypts to the user's own pubkey: the record is a backup for one person, so the sender
// and the recipient are the same key and no peer ever holds a readable copy.
export async function encodePrivateRecord<T>(signer: Signer, record: PrivateRecord<T>): Promise<UnsignedNostrEvent> {
  if (!isRecordAddress(record.address)) throw new Error('refusing to encode an address the relay will reject');
  const self = await signer.getPublicKey();
  const envelope = {
    v: ENVELOPE_VERSION,
    updatedAt: record.updatedAt,
    ...(record.deleted ? { deleted: true } : {}),
    ...(record.deleted ? {} : { payload: record.payload })
  };
  const ciphertext = await signer.nip44Encrypt(self, JSON.stringify(envelope));
  return buildPrivateRecordEvent(record.address, ciphertext);
}

// Returns null for anything unreadable. Events come from an open relay that anyone may
// write to, so a foreign, corrupt or undecryptable event is an expected input.
export async function decodePrivateRecord<T>(signer: Signer, event: SignedNostrEvent): Promise<DecodedPrivateRecord<T> | null> {
  if (!event || event.kind !== PRIVATE_RECORD_KIND || typeof event.content !== 'string') return null;
  const address = tagValue(event.tags || [], 'd');
  const parsed = parseAddress(address);
  if (!parsed) return null;
  if (tagValue(event.tags || [], 'client') !== CLIENT_TAG) return null;
  try {
    const plaintext = await signer.nip44Decrypt(event.pubkey, event.content);
    const envelope = JSON.parse(plaintext) as { v?: number; updatedAt?: string; deleted?: boolean; payload?: T };
    if (envelope?.v !== ENVELOPE_VERSION) return null;
    if (typeof envelope.updatedAt !== 'string' || !envelope.updatedAt) return null;
    return {
      address,
      parsed,
      updatedAt: envelope.updatedAt,
      deleted: envelope.deleted === true,
      payload: envelope.deleted === true ? undefined : envelope.payload,
      eventId: event.id,
      createdAt: event.created_at
    };
  } catch {
    // Deliberately silent: the failure carries ciphertext, and the caller counts skips.
    return null;
  }
}
