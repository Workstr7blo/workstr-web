// Relay transport for device pairing. No key storage, no camera, no account import — this
// module moves one encrypted event between two devices and validates its envelope.
//
// Only the pairing *response* crosses the relay. The request travels in the QR the new
// device displays, so nothing anonymous is ever published here: every event this module
// sends is signed by the account key being transferred.
//
// The kind is ephemeral (20000-29999), which strfry stores, serves to a later REQ inside
// `ephemeralEventsLifetimeSeconds`, and then deletes on its own. That is what lets the new
// device background itself, reconnect, and still collect a response published while it was
// away — see docs/device-pairing-architecture.md.
import { SimplePool } from 'nostr-tools';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { PAIRING_LIFETIME_SECONDS, PAIRING_PROTOCOL_VERSION, PairingError } from '../signer/pairing';

// All three must match relay/write-policy.mjs. The relay rejects anything else, so a
// change here without a relay deploy simply stops pairing working.
export const PAIRING_KIND = 20078;
export const PAIRING_D_PREFIX = 'workstr:pair:';
export const PAIRING_MAX_BYTES = 2048;

export const PAIRING_PUBLISH_TIMEOUT_MS = 10000;
// A shade under the protocol lifetime: waiting past expiry only produces a response the
// client would reject anyway, and the expiry screen is the better answer by then.
export const PAIRING_WAIT_TIMEOUT_MS = (PAIRING_LIFETIME_SECONDS - 5) * 1000;

export const pairingAddress = (pairingId: string) => `${PAIRING_D_PREFIX}${pairingId}`;

// Exactly three tags, no more: the relay rejects a fourth, and the one that must never
// appear is the recipient's ephemeral pubkey. Tagging it would hand anyone reading the
// relay the value they need to forge a response this device would accept.
export function buildPairingResponse(pairingId: string, ciphertext: string, expiresAt: number, at = Math.floor(Date.now() / 1000)): UnsignedNostrEvent {
  return {
    kind: PAIRING_KIND,
    created_at: at,
    content: ciphertext,
    tags: [
      ['d', pairingAddress(pairingId)],
      ['expiration', String(expiresAt)],
      ['v', String(PAIRING_PROTOCOL_VERSION)]
    ]
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new PairingError('relay_timeout', message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export interface PublishPairingResult {
  eventId: string;
  createdAt: number;
}

// Signed by the trusted device, so the block list and every other account-level relay rule
// applies to pairing exactly as it applies to sync.
export async function publishPairingResponse(
  signer: Signer,
  relayUrl: string,
  pairingId: string,
  ciphertext: string,
  expiresAt: number,
  pool = new SimplePool(),
  ownPool = true
): Promise<PublishPairingResult> {
  try {
    const signed = await signer.signEvent(buildPairingResponse(pairingId, ciphertext, expiresAt));
    // Checked here rather than discovered as a relay rejection, so an oversized payload
    // reads as a Workstr limit instead of an opaque `blocked:` string from the relay.
    if (new TextEncoder().encode(JSON.stringify(signed)).length > PAIRING_MAX_BYTES) {
      throw new PairingError('too_large', 'This transfer is too large to send.');
    }
    const [publish] = pool.publish([relayUrl], signed as Parameters<typeof pool.publish>[1]);
    const message = await withTimeout(publish, PAIRING_PUBLISH_TIMEOUT_MS, 'The relay did not answer in time.');
    // nostr-tools resolves rather than rejects when the socket never opened, so an
    // unreachable relay would otherwise read as a successful send.
    if (String(message || '').toLowerCase().startsWith('connection failure:')) {
      throw new PairingError('relay_unreachable', 'Could not reach the Workstr relay.');
    }
    return { eventId: signed.id, createdAt: signed.created_at };
  } catch (error) {
    if (error instanceof PairingError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    // A relay policy rejection will never succeed on retry; a dead socket might.
    if (/^(blocked|invalid|rejected|error)\b/i.test(reason.trim())) throw new PairingError('rejected', reason);
    throw new PairingError('relay_unreachable', 'Could not reach the Workstr relay.');
  } finally {
    if (ownPool) pool.close([relayUrl]);
  }
}

// The envelope only. Whether the ciphertext is *for this device* is a question for
// `openTransfer`, which is the only place holding the key that can answer it.
export function isPairingResponse(event: SignedNostrEvent, pairingId: string, at = Math.floor(Date.now() / 1000)): boolean {
  if (event.kind !== PAIRING_KIND) return false;
  if (typeof event.content !== 'string' || event.content.length === 0) return false;
  if (!Array.isArray(event.tags) || event.tags.length !== 3) return false;
  const tag = (name: string) => {
    const found = event.tags.filter((entry) => Array.isArray(entry) && entry[0] === name);
    return found.length === 1 && typeof found[0][1] === 'string' ? found[0][1] : null;
  };
  if (tag('d') !== pairingAddress(pairingId)) return false;
  if (tag('v') !== String(PAIRING_PROTOCOL_VERSION)) return false;
  const expiration = tag('expiration');
  if (!expiration || !/^\d+$/.test(expiration)) return false;
  return Number(expiration) > at;
}

export interface WaitOptions {
  timeoutMs?: number;
  pool?: SimplePool;
  ownPool?: boolean;
  signal?: AbortSignal;
}

/**
 * Resolves with the first event whose envelope matches this pairing, or null on timeout or
 * cancellation.
 *
 * A REQ returns what the relay already holds before it goes live, so this covers both the
 * device that was watching when the response arrived and the device that was backgrounded
 * and came back for it. Several responses may match the envelope — anyone can publish
 * against a scraped pairing id — so the caller decrypts each and keeps waiting on failure.
 */
export function awaitPairingResponse(
  relayUrl: string,
  pairingId: string,
  onCandidate: (event: SignedNostrEvent) => boolean | Promise<boolean>,
  options: WaitOptions = {}
): Promise<SignedNostrEvent | null> {
  const { timeoutMs = PAIRING_WAIT_TIMEOUT_MS, pool = new SimplePool(), ownPool = true, signal } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let inFlight = Promise.resolve();

    const finish = (value: SignedNostrEvent | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { sub.close(); } catch { /* already closed */ }
      if (ownPool) pool.close([relayUrl]);
      if (error) reject(error); else resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    const onAbort = () => finish(null);
    signal?.addEventListener('abort', onAbort, { once: true });

    const sub = pool.subscribeMany([relayUrl], { kinds: [PAIRING_KIND], '#d': [pairingAddress(pairingId)] }, {
      onevent(event) {
        const candidate = event as unknown as SignedNostrEvent;
        if (settled || !isPairingResponse(candidate, pairingId)) return;
        // Serialised: two responses arriving together must not both be accepted, and
        // decryption is async.
        inFlight = inFlight.then(async () => {
          if (settled) return;
          try {
            if (await onCandidate(candidate)) finish(candidate);
          } catch (error) {
            finish(null, error);
          }
        });
      },
      onclose() {
        // Not an error on its own: the relay closes the subscription when the pairing
        // event is reaped, and the timeout is what ends the wait.
      }
    });

    if (signal?.aborted) onAbort();
  });
}
