// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { awaitPairingResponse, publishPairingResponse } from '../src/nostr/device-pairing';
import { createPairingSession, openTransfer, pairingUri, parsePairingUri, sealTransfer, PairingError } from '../src/signer/pairing';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

// Opt-in: a real strfry carrying the write policy, the same convention as
// sync-relay.integration.test.ts. Skipped when unset, because a mocked relay cannot prove
// the write policy accepts what this client builds — which is the only reason these exist.
const RELAY = process.env.WORKSTR_TEST_RELAY;
const suite = RELAY ? describe : describe.skip;

function keySigner(secret = generateSecretKey()): Signer {
  const pubkey = getPublicKey(secret);
  return {
    type: 'local',
    getPublicKey: async () => pubkey,
    signEvent: async (event: UnsignedNostrEvent) => finalizeEvent({ ...event, pubkey } as never, secret) as never,
    nip44Encrypt: async (peer: string, plaintext: string) => nip44.encrypt(plaintext, nip44.getConversationKey(secret, peer)),
    nip44Decrypt: async (peer: string, ciphertext: string) => nip44.decrypt(ciphertext, nip44.getConversationKey(secret, peer))
  };
}

function account() {
  const secret = generateSecretKey();
  return { secret, pubkey: getPublicKey(secret), nsec: nip19.nsecEncode(secret), signer: keySigner(secret) };
}

suite('device pairing against a live relay', () => {
  it('carries a recovery key from the trusted device to the new one', async () => {
    const relayUrl = RELAY as string;
    const acct = account();

    // New device: makes a session and renders a QR.
    const session = createPairingSession();
    // Trusted device: scans it, and only ever sees the public half.
    const request = parsePairingUri(pairingUri(session));

    const ciphertext = await sealTransfer(acct.signer, request, acct.nsec, acct.pubkey);

    // The new device starts listening before the response is published, then keeps
    // listening across it — the same order the UI will use.
    const waiting = awaitPairingResponse(relayUrl, session.pairingId, (event) => {
      try {
        openTransfer(session, event.content, event.pubkey);
        return true;
      } catch {
        return false;
      }
    }, { timeoutMs: 20000 });

    const published = await publishPairingResponse(acct.signer, relayUrl, session.pairingId, ciphertext, session.expiresAt);
    expect(published.eventId).toMatch(/^[0-9a-f]{64}$/);

    const event = await waiting;
    expect(event).not.toBeNull();
    const payload = openTransfer(session, event!.content, event!.pubkey);
    expect(payload.nsec).toBe(acct.nsec);
    expect(payload.accountPubkey).toBe(acct.pubkey);
  }, 40000);

  it('is retrievable by a device that was not listening when it was sent', async () => {
    // The backgrounded-PWA case, and the whole reason pairing uses an ephemeral kind the
    // relay stores rather than a transient broadcast.
    const relayUrl = RELAY as string;
    const acct = account();
    const session = createPairingSession();
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey);

    await publishPairingResponse(acct.signer, relayUrl, session.pairingId, ciphertext, session.expiresAt);

    // A brand-new subscription, opened only after the fact.
    const event = await awaitPairingResponse(relayUrl, session.pairingId, () => true, { timeoutMs: 20000 });
    expect(event).not.toBeNull();
    expect(openTransfer(session, event!.content, event!.pubkey).nsec).toBe(acct.nsec);
  }, 40000);

  it('is refused by the relay when the envelope breaks the policy', async () => {
    const relayUrl = RELAY as string;
    const acct = account();
    const session = createPairingSession();
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey);

    // Beyond PAIR_MAX_LIFETIME_SECONDS, which the relay validates independently of the
    // client. Confirms the two halves of the protocol still agree after deployment.
    const tooLong = Math.floor(Date.now() / 1000) + 86400;
    await expect(
      publishPairingResponse(acct.signer, relayUrl, session.pairingId, ciphertext, tooLong)
    ).rejects.toThrow(PairingError);
  }, 40000);

  it('returns null rather than hanging when nothing answers', async () => {
    const relayUrl = RELAY as string;
    const session = createPairingSession();
    const event = await awaitPairingResponse(relayUrl, session.pairingId, () => true, { timeoutMs: 3000 });
    expect(event).toBeNull();
  }, 20000);
});
