import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { nip19 } from 'nostr-tools';
import {
  createPairingSession,
  destroyPairingSession,
  openTransfer,
  PAIRING_LIFETIME_SECONDS,
  PAIRING_PROTOCOL_VERSION,
  PairingError,
  pairingUri,
  parsePairingUri,
  sealTransfer,
  type PairingSession
} from '../src/signer/pairing';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const NOW = 1_800_000_000;

// The trusted device's signer. Real NIP-44 and real signatures: mocking the crypto would
// leave the identity checks below asserting nothing.
function localSigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey);
  return {
    type: 'local',
    getPublicKey: async () => pubkey,
    signEvent: async (event: UnsignedNostrEvent) => finalizeEvent(event, secretKey) as never,
    nip44Encrypt: async (peer: string, plaintext: string) => nip44Encrypt(plaintext, getConversationKey(secretKey, peer)),
    nip44Decrypt: async () => { throw new Error('not used'); }
  };
}

function account() {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey), nsec: nip19.nsecEncode(secretKey), signer: localSigner(secretKey) };
}

describe('pairing session and QR', () => {
  it('generates high-entropy identifiers and a bounded expiry', () => {
    const session = createPairingSession(NOW);
    expect(session.pairingId).toMatch(/^[0-9a-f]{32}$/);
    expect(session.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(session.ephemeralPubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(session.expiresAt).toBe(NOW + PAIRING_LIFETIME_SECONDS);
    expect(createPairingSession(NOW).pairingId).not.toBe(session.pairingId);
  });

  it('round-trips through the QR without carrying the private half', () => {
    const session = createPairingSession(NOW);
    const uri = pairingUri(session);
    expect(uri.startsWith('workstr://pair?')).toBe(true);
    // The whole security argument for a photographed QR rests on this.
    expect(uri).not.toContain(Buffer.from(session.ephemeralSecret).toString('hex'));

    const parsed = parsePairingUri(uri, NOW);
    expect(parsed).toEqual({
      version: PAIRING_PROTOCOL_VERSION,
      pairingId: session.pairingId,
      ephemeralPubkey: session.ephemeralPubkey,
      challenge: session.challenge,
      expiresAt: session.expiresAt
    });
  });

  it('refuses a QR that is not ours, malformed, or stale', () => {
    const session = createPairingSession(NOW);
    const uri = pairingUri(session);
    const codeOf = (fn: () => unknown) => { try { fn(); return 'no-throw'; } catch (e) { return (e as PairingError).code; } };

    expect(codeOf(() => parsePairingUri('nostrconnect://abc', NOW))).toBe('malformed_qr');
    expect(codeOf(() => parsePairingUri('https://workstr.fit', NOW))).toBe('malformed_qr');
    expect(codeOf(() => parsePairingUri('', NOW))).toBe('malformed_qr');
    expect(codeOf(() => parsePairingUri(uri.replace(/v=1/, 'v=2'), NOW))).toBe('unsupported_version');
    expect(codeOf(() => parsePairingUri(uri.replace(session.pairingId, 'short'), NOW))).toBe('malformed_qr');
    expect(codeOf(() => parsePairingUri(uri.replace(session.ephemeralPubkey, 'nothex'), NOW))).toBe('malformed_qr');
    // Expired, and expiring so far out that it cannot be a code this app produced.
    expect(codeOf(() => parsePairingUri(uri, session.expiresAt + 1))).toBe('expired');
    expect(codeOf(() => parsePairingUri(uri.replace(`exp=${session.expiresAt}`, `exp=${NOW + 86400}`), NOW))).toBe('malformed_qr');
  });
});

describe('transfer sealing and opening', () => {
  it('moves the recovery key to the device holding the ephemeral secret', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey, NOW);

    expect(ciphertext).not.toContain(acct.nsec);
    const payload = openTransfer(session, ciphertext, acct.pubkey, NOW);
    expect(payload.nsec).toBe(acct.nsec);
    expect(payload.accountPubkey).toBe(acct.pubkey);
    expect(payload.pairingId).toBe(session.pairingId);
  });

  it('cannot be opened by a device that did not generate the QR', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey, NOW);

    // An eavesdropper who read the relay and made their own keypair.
    const attacker = createPairingSession(NOW);
    expect(() => openTransfer(attacker, ciphertext, acct.pubkey, NOW)).toThrow(PairingError);
    try { openTransfer(attacker, ciphertext, acct.pubkey, NOW); } catch (e) {
      expect((e as PairingError).code).toBe('undecryptable');
    }
  });

  it('rejects a tampered ciphertext rather than returning garbage', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey, NOW);
    const flipped = `${ciphertext.slice(0, -6)}AAAAA=`;
    expect(() => openTransfer(session, flipped, acct.pubkey, NOW)).toThrow(/not meant for this device|could not be read/);
  });

  it('refuses a response bound to a different pairing session', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const other = createPairingSession(NOW);
    // Sealed against `other`, but encrypted to `session` so decryption itself succeeds.
    const payload = JSON.stringify({
      version: PAIRING_PROTOCOL_VERSION, pairingId: other.pairingId, challenge: other.challenge,
      accountPubkey: acct.pubkey, nsec: acct.nsec, issuedAt: NOW, expiresAt: NOW + 120
    });
    const ciphertext = nip44Encrypt(payload, getConversationKey(acct.secretKey, session.ephemeralPubkey));
    try { openTransfer(session, ciphertext, acct.pubkey, NOW); expect.unreachable(); } catch (e) {
      expect((e as PairingError).code).toBe('wrong_session');
    }
  });

  it('refuses a response whose key does not match the account that sent it', async () => {
    // Identity substitution: an attacker encrypts a working payload to the new device, but
    // ships their own key. Decryption succeeds; the identity checks are what stop it.
    const attacker = account();
    const victimPubkey = account().pubkey;
    const session = createPairingSession(NOW);

    const claimsVictim = JSON.stringify({
      version: PAIRING_PROTOCOL_VERSION, pairingId: session.pairingId, challenge: session.challenge,
      accountPubkey: victimPubkey, nsec: attacker.nsec, issuedAt: NOW, expiresAt: NOW + 120
    });
    const c1 = nip44Encrypt(claimsVictim, getConversationKey(attacker.secretKey, session.ephemeralPubkey));
    try { openTransfer(session, c1, attacker.pubkey, NOW); expect.unreachable(); } catch (e) {
      expect((e as PairingError).code).toBe('identity_mismatch');
    }

    // And the consistent version: attacker's own key throughout. Nothing cryptographic
    // catches this, so the person is told which account arrived; see the UI phase.
    const consistent = JSON.stringify({
      version: PAIRING_PROTOCOL_VERSION, pairingId: session.pairingId, challenge: session.challenge,
      accountPubkey: attacker.pubkey, nsec: attacker.nsec, issuedAt: NOW, expiresAt: NOW + 120
    });
    const c2 = nip44Encrypt(consistent, getConversationKey(attacker.secretKey, session.ephemeralPubkey));
    expect(openTransfer(session, c2, attacker.pubkey, NOW).accountPubkey).toBe(attacker.pubkey);
  });

  it('refuses an expired or unsupported payload', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey, NOW);
    try { openTransfer(session, ciphertext, acct.pubkey, session.expiresAt + 1); expect.unreachable(); } catch (e) {
      expect((e as PairingError).code).toBe('expired');
    }
  });

  it('wipes the ephemeral secret when the session is destroyed', () => {
    const session: PairingSession = createPairingSession(NOW);
    destroyPairingSession(session);
    expect(session.ephemeralSecret.every((byte) => byte === 0)).toBe(true);
  });
});
