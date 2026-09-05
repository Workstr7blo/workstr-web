import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { nip19 } from 'nostr-tools';
import { createPairingSession, sealTransfer } from '../src/signer/pairing';
import { buildPairingResponse, isPairingResponse, PAIRING_KIND, PAIRING_MAX_BYTES, pairingAddress } from '../src/nostr/device-pairing';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const NOW = 1_800_000_000;

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

describe('pairing event envelope', () => {
  it('builds exactly the three tags the relay accepts', () => {
    const event = buildPairingResponse('0f'.repeat(16), 'ciphertext', NOW + 120, NOW);
    expect(event.kind).toBe(PAIRING_KIND);
    expect(event.tags).toHaveLength(3);
    expect(event.tags).toEqual(expect.arrayContaining([
      ['d', pairingAddress('0f'.repeat(16))],
      ['expiration', String(NOW + 120)],
      ['v', '1']
    ]));
    // The value that must never be published. A p tag here would let a relay observer
    // encrypt a response the new device would accept.
    expect(event.tags.some((tag) => tag[0] === 'p')).toBe(false);
  });

  it('accepts only an envelope matching this pairing and still in date', () => {
    const id = '0f'.repeat(16);
    const signed = { ...buildPairingResponse(id, 'ciphertext', NOW + 120, NOW), id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) };
    expect(isPairingResponse(signed, id, NOW)).toBe(true);
    expect(isPairingResponse(signed, 'ab'.repeat(16), NOW)).toBe(false);
    expect(isPairingResponse(signed, id, NOW + 200)).toBe(false);
    expect(isPairingResponse({ ...signed, kind: 30078 }, id, NOW)).toBe(false);
    expect(isPairingResponse({ ...signed, content: '' }, id, NOW)).toBe(false);
    expect(isPairingResponse({ ...signed, tags: [...signed.tags, ['p', 'x']] }, id, NOW)).toBe(false);
  });

  // PAIR_MAX_BYTES was chosen from an estimate of the NIP-44 payload before one existed.
  // This measures a real signed event so the relay constant cannot drift away from what
  // the client actually produces.
  it('produces an event comfortably under the relay size limit', async () => {
    const acct = account();
    const session = createPairingSession(NOW);
    const ciphertext = await sealTransfer(acct.signer, session, acct.nsec, acct.pubkey, NOW);
    const signed = finalizeEvent(buildPairingResponse(session.pairingId, ciphertext, session.expiresAt, NOW), acct.secretKey);
    const bytes = new TextEncoder().encode(JSON.stringify(signed)).length;

    expect(bytes).toBeLessThan(PAIRING_MAX_BYTES);
    // Headroom, not a squeeze: if a real payload ever lands within a quarter of the cap,
    // the constant needs revisiting on both sides before the margin disappears.
    expect(bytes).toBeLessThan(PAIRING_MAX_BYTES * 0.75);
  });
});
