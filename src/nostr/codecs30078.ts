import type { SignedNostrEvent, UnsignedNostrEvent } from '../signer/types';
import { isRecordAddress, parseAddress, type RecordAddress } from '../sync/addresses';
import { openEnvelope, sealEnvelope } from './envelope';

// NIP-78 arbitrary app data. Shared with other clients, which is exactly why the relay
// policy also requires the address prefix rather than filtering on the kind alone.
export const PRIVATE_RECORD_KIND = 30078;
export const CLIENT_TAG = 'workstr';

// What a record is sealed with. The key is the account's backup key, held locally, so
// neither sealing nor opening a record costs a signer round trip — only signing the event
// does. `pubkey` is bound into the record's authentication, not just used to address it.
export interface RecordCipher {
  key: CryptoKey;
  pubkey: string;
}

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

// The record is a backup for one person, so nothing here is addressed to a peer: it is
// sealed with the account's own backup key and no one else ever holds a readable copy.
export async function encodePrivateRecord<T>(cipher: RecordCipher, record: PrivateRecord<T>): Promise<UnsignedNostrEvent> {
  if (!isRecordAddress(record.address)) throw new Error('refusing to encode an address the relay will reject');
  // No version field: it lives in the envelope's cleartext header, where a decoder can
  // read it before it has to know how to decrypt anything.
  const envelope = {
    updatedAt: record.updatedAt,
    ...(record.deleted ? { deleted: true } : {}),
    ...(record.deleted ? {} : { payload: record.payload })
  };
  const content = await sealEnvelope(cipher.key, { pubkey: cipher.pubkey, address: record.address }, JSON.stringify(envelope));
  return buildPrivateRecordEvent(record.address, content);
}

// Returns null for anything unreadable. Events come from an open relay that anyone may
// write to, so a foreign, corrupt or undecryptable event is an expected input.
export async function decodePrivateRecord<T>(cipher: RecordCipher, event: SignedNostrEvent): Promise<DecodedPrivateRecord<T> | null> {
  if (!event || event.kind !== PRIVATE_RECORD_KIND || typeof event.content !== 'string') return null;
  const address = tagValue(event.tags || [], 'd');
  const parsed = parseAddress(address);
  if (!parsed) return null;
  if (tagValue(event.tags || [], 'client') !== CLIENT_TAG) return null;
  try {
    // Authenticated against the address it was found at, so a record served from the wrong
    // address does not open at all rather than opening into the wrong row.
    const plaintext = await openEnvelope(cipher.key, { pubkey: event.pubkey, address }, event.content);
    if (plaintext === null) return null;
    const envelope = JSON.parse(plaintext) as { updatedAt?: string; deleted?: boolean; payload?: T };
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
