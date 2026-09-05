// Cryptographic primitives for QR device pairing. No UI, no networking, no database.
//
// The shape of the protocol, and why it is safe, is in docs/device-pairing-architecture.md.
// The part that matters when reading this file: the new device generates an ephemeral
// secp256k1 keypair and puts only the *public* half in its QR. The trusted device scans
// that, encrypts the account's recovery key to it with NIP-44, and publishes the ciphertext.
//
// Two consequences drive the code below.
//
// NIP-44 v2 is authenticated encryption, so a ciphertext that decrypts under
// conversationKey(ephemeralSecret, senderPubkey) already proves the sender held the account
// secret. There is no separate signature to verify — but that only binds the *sender*, so
// `openTransfer` still checks that the key inside matches the key that sent it.
//
// The ephemeral private key never leaves the device and is not persisted anywhere. An
// attacker who photographs the QR, or who lists every pairing event on the open relay,
// holds nothing they can decrypt.
import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Signer } from './types';

export const PAIRING_PROTOCOL_VERSION = 1;

// Matches PAIR_MAX_LIFETIME_SECONDS in relay/write-policy.mjs. The relay refuses anything
// longer, so raising this alone would produce events the relay rejects.
export const PAIRING_LIFETIME_SECONDS = 300;

// 128 bits. The relay validates exactly 32 lowercase hex characters.
const PAIRING_ID_BYTES = 16;
// 256 bits. Not a secret, but it must be unguessable so a response cannot be replayed
// against a different session.
const CHALLENGE_BYTES = 32;

export const PAIRING_URI_SCHEME = 'workstr://pair';

export class PairingError extends Error {
  readonly code: PairingErrorCode;
  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
  }
}

export type PairingErrorCode =
  | 'malformed_qr'
  | 'unsupported_version'
  | 'expired'
  | 'undecryptable'
  | 'wrong_session'
  | 'identity_mismatch'
  // Transport, raised by nostr/device-pairing.ts. They live in the same union so a caller
  // handles one error type for the whole feature.
  | 'relay_unreachable'
  | 'relay_timeout'
  | 'rejected'
  | 'too_large';

/** The public half of a pairing request. This is exactly what the QR carries. */
export interface PairingRequest {
  version: number;
  pairingId: string;
  ephemeralPubkey: string;
  challenge: string;
  expiresAt: number;
}

/** A request plus the secret the new device keeps to itself. Never serialise this. */
export interface PairingSession extends PairingRequest {
  ephemeralSecret: Uint8Array;
}

/** The plaintext that travels encrypted. Exists only in memory on the two devices. */
export interface TransferPayload {
  version: number;
  pairingId: string;
  challenge: string;
  accountPubkey: string;
  nsec: string;
  issuedAt: number;
  expiresAt: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const randomHex = (bytes: number) => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));

export function createPairingSession(at: number = nowSeconds()): PairingSession {
  const ephemeralSecret = generateSecretKey();
  return {
    version: PAIRING_PROTOCOL_VERSION,
    pairingId: randomHex(PAIRING_ID_BYTES),
    ephemeralPubkey: getPublicKey(ephemeralSecret),
    challenge: randomHex(CHALLENGE_BYTES),
    expiresAt: at + PAIRING_LIFETIME_SECONDS,
    ephemeralSecret
  };
}

// A distinct scheme rather than a nostrconnect:// lookalike, so a NIP-46 QR scanned here
// and a pairing QR scanned by a signer both fail cleanly instead of half-parsing.
export function pairingUri(request: PairingRequest): string {
  const params = new URLSearchParams({
    v: String(request.version),
    id: request.pairingId,
    pub: request.ephemeralPubkey,
    c: request.challenge,
    exp: String(request.expiresAt)
  });
  return `${PAIRING_URI_SCHEME}?${params.toString()}`;
}

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

// Everything the trusted device knows about the request comes from here, so this is the
// place that refuses a malformed or stale QR — before a person is ever shown an approval
// screen for it.
export function parsePairingUri(uri: string, at: number = nowSeconds()): PairingRequest {
  let params: URLSearchParams;
  try {
    const trimmed = uri.trim();
    if (!trimmed.startsWith(`${PAIRING_URI_SCHEME}?`)) throw new Error('scheme');
    params = new URLSearchParams(trimmed.slice(`${PAIRING_URI_SCHEME}?`.length));
  } catch {
    throw new PairingError('malformed_qr', 'That is not a Workstr pairing code.');
  }

  const version = Number(params.get('v'));
  const pairingId = params.get('id') || '';
  const ephemeralPubkey = params.get('pub') || '';
  const challenge = params.get('c') || '';
  const expiresAt = Number(params.get('exp'));

  if (!Number.isInteger(version) || version <= 0) throw new PairingError('malformed_qr', 'That is not a Workstr pairing code.');
  // Version before shape: a future protocol may legitimately change every other field, and
  // "unsupported version" is the useful thing to say about it.
  if (version !== PAIRING_PROTOCOL_VERSION) {
    throw new PairingError('unsupported_version', 'That pairing code needs a newer version of Workstr.');
  }
  if (!HEX_32.test(pairingId) || !HEX_64.test(ephemeralPubkey) || !HEX_64.test(challenge)) {
    throw new PairingError('malformed_qr', 'That pairing code is not readable.');
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= at) {
    throw new PairingError('expired', 'That pairing code has expired. Generate a new one.');
  }
  // A QR claiming a longer life than the protocol allows is not one this app made, and the
  // relay would refuse the response anyway.
  if (expiresAt > at + PAIRING_LIFETIME_SECONDS) {
    throw new PairingError('malformed_qr', 'That pairing code is not readable.');
  }

  return { version, pairingId, ephemeralPubkey, challenge, expiresAt };
}

// Trusted device. Encryption goes through the Signer interface, which already implements
// NIP-44 for the local signer, so no key material is handled here beyond the nsec the
// caller passes in — and that is only ever the account this device already holds.
export async function sealTransfer(
  signer: Signer,
  request: PairingRequest,
  nsec: string,
  accountPubkey: string,
  at: number = nowSeconds()
): Promise<string> {
  const payload: TransferPayload = {
    version: PAIRING_PROTOCOL_VERSION,
    pairingId: request.pairingId,
    challenge: request.challenge,
    accountPubkey,
    nsec,
    issuedAt: at,
    expiresAt: request.expiresAt
  };
  return signer.nip44Encrypt(request.ephemeralPubkey, JSON.stringify(payload));
}

// New device. `senderPubkey` is the pubkey on the event that carried the ciphertext, and
// it is load-bearing twice: it derives the conversation key, and it is what the recovered
// key is checked against.
export function openTransfer(
  session: PairingSession,
  ciphertext: string,
  senderPubkey: string,
  at: number = nowSeconds()
): TransferPayload {
  let plaintext: string;
  try {
    plaintext = nip44Decrypt(ciphertext, getConversationKey(session.ephemeralSecret, senderPubkey));
  } catch {
    // Expected, not exceptional: on an open relay anyone can publish a response for a
    // pairing id they scraped. It fails the NIP-44 HMAC here and the caller keeps waiting.
    throw new PairingError('undecryptable', 'That response was not meant for this device.');
  }

  let payload: TransferPayload;
  try {
    payload = JSON.parse(plaintext) as TransferPayload;
  } catch {
    throw new PairingError('undecryptable', 'That response could not be read.');
  }

  if (payload.version !== PAIRING_PROTOCOL_VERSION) {
    throw new PairingError('unsupported_version', 'That response uses an unsupported pairing version.');
  }
  // Binding to this exact session, so a response captured from one pairing cannot be
  // replayed into another.
  if (payload.pairingId !== session.pairingId || payload.challenge !== session.challenge) {
    throw new PairingError('wrong_session', 'That response belongs to a different pairing.');
  }
  if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= at) {
    throw new PairingError('expired', 'That transfer expired before it arrived. Try again.');
  }

  // Identity substitution: decryption alone proves only that *someone* holding the account
  // secret encrypted this. Both checks below are what make the key that arrives the key
  // that signed for it.
  if (!HEX_64.test(payload.accountPubkey) || payload.accountPubkey !== senderPubkey) {
    throw new PairingError('identity_mismatch', 'That response did not come from the account it claims.');
  }
  if (pubkeyFromNsec(payload.nsec) !== payload.accountPubkey) {
    throw new PairingError('identity_mismatch', 'That response did not come from the account it claims.');
  }

  return payload;
}

function pubkeyFromNsec(nsec: unknown): string | null {
  if (typeof nsec !== 'string') return null;
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) return null;
    return getPublicKey(decoded.data);
  } catch {
    return null;
  }
}

// Overwrite the secret in place rather than dropping the reference. It does not make the
// bytes unrecoverable — nothing in a browser does — but it means a session object held
// alive by a stale closure stops being a usable key.
export function destroyPairingSession(session: PairingSession): void {
  session.ephemeralSecret.fill(0);
}
