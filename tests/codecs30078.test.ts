import { describe, expect, it, vi } from 'vitest';
import {
  BODYWEIGHT_ADDRESS, SETTINGS_ADDRESS, parseAddress,
  sessionAddress, sheetAddress, isRecordAddress, RECORD_PREFIX
} from '../src/sync/addresses';
import { CLIENT_TAG, PRIVATE_RECORD_KIND, decodePrivateRecord, encodePrivateRecord } from '../src/nostr/codecs30078';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);

// Reversible stand-in for NIP-44: proves the codec round-trips without asserting on a
// cipher the signer owns.
function fakeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    type: 'nip07',
    getPublicKey: async () => SELF,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_peer: string, plaintext: string) => `enc:${btoa(unescape(encodeURIComponent(plaintext)))}`,
    nip44Decrypt: async (_peer: string, ciphertext: string) => {
      if (!ciphertext.startsWith('enc:')) throw new Error('not for this key');
      return decodeURIComponent(escape(atob(ciphertext.slice(4))));
    },
    ...overrides
  };
}

function signed(event: UnsignedNostrEvent, pubkey = SELF): SignedNostrEvent {
  return { ...event, id: 'event-id', pubkey, sig: 'sig' };
}

describe('record addresses', () => {
  it('builds addresses the relay policy accepts', () => {
    expect(sheetAddress('push-day')).toBe(`${RECORD_PREFIX}sheet:push-day`);
    expect(sessionAddress('9f1c')).toBe(`${RECORD_PREFIX}session:9f1c`);
    for (const address of [BODYWEIGHT_ADDRESS, SETTINGS_ADDRESS, sheetAddress('a'), sessionAddress('b')]) {
      expect(address.startsWith(RECORD_PREFIX)).toBe(true);
      expect(isRecordAddress(address)).toBe(true);
    }
  });

  it('round-trips every address kind', () => {
    expect(parseAddress(sheetAddress('push-day'))).toEqual({ kind: 'sheet', id: 'push-day' });
    expect(parseAddress(sessionAddress('9f1c'))).toEqual({ kind: 'session', id: '9f1c' });
    expect(parseAddress(BODYWEIGHT_ADDRESS)).toEqual({ kind: 'bodyweight' });
    expect(parseAddress(SETTINGS_ADDRESS)).toEqual({ kind: 'settings' });
  });

  it('rejects foreign and malformed addresses instead of guessing', () => {
    for (const address of [
      'other-app:v1:sheet:x', 'workstr:v1:sheet:x', RECORD_PREFIX, `${RECORD_PREFIX}unknown`,
      `${RECORD_PREFIX}sheet:`, `${RECORD_PREFIX}sheet:a:b`, `${RECORD_PREFIX}bodyweight:1`, ''
    ]) {
      expect(parseAddress(address)).toBeNull();
    }
  });

  it('refuses to build an id that would break the delimiter', () => {
    expect(() => sheetAddress('a:b')).toThrow(/cannot contain/);
    expect(() => sessionAddress('  ')).toThrow(/needs an id/);
  });
});

describe('private record codecs', () => {
  it('round-trips a record through encryption', async () => {
    const signer = fakeSigner();
    const event = await encodePrivateRecord(signer, {
      address: sheetAddress('push-day'),
      updatedAt: '2026-08-20T10:00:00.000Z',
      payload: { name: 'Push Day', sets: 3 }
    });
    expect(event.kind).toBe(PRIVATE_RECORD_KIND);
    expect(event.tags).toContainEqual(['d', `${RECORD_PREFIX}sheet:push-day`]);
    expect(event.tags).toContainEqual(['client', CLIENT_TAG]);
    // The payload must not be readable on the wire.
    expect(event.content).not.toContain('Push Day');

    const decoded = await decodePrivateRecord<{ name: string }>(signer, signed(event));
    expect(decoded?.payload).toEqual({ name: 'Push Day', sets: 3 });
    expect(decoded?.updatedAt).toBe('2026-08-20T10:00:00.000Z');
    expect(decoded?.parsed).toEqual({ kind: 'sheet', id: 'push-day' });
    expect(decoded?.deleted).toBe(false);
  });

  it('carries a tombstone with no payload', async () => {
    const signer = fakeSigner();
    const event = await encodePrivateRecord(signer, {
      address: sessionAddress('gone'), updatedAt: '2026-08-20T10:00:00.000Z',
      deleted: true, payload: { secret: 'should not be encoded' }
    });
    expect(event.content).not.toContain('should not be encoded');
    const decoded = await decodePrivateRecord(signer, signed(event));
    expect(decoded?.deleted).toBe(true);
    expect(decoded?.payload).toBeUndefined();
  });

  it('refuses to encode an address the relay would reject', async () => {
    await expect(encodePrivateRecord(fakeSigner(), { address: 'other:thing', updatedAt: 'now', payload: {} }))
      .rejects.toThrow(/relay will reject/);
  });

  it('skips events that are not ours', async () => {
    const signer = fakeSigner();
    const good = await encodePrivateRecord(signer, { address: SETTINGS_ADDRESS, updatedAt: '2026-08-20T10:00:00.000Z', payload: { unit: 'kg' } });
    expect(await decodePrivateRecord(signer, signed({ ...good, kind: 1 }))).toBeNull();
    expect(await decodePrivateRecord(signer, signed({ ...good, tags: [['d', 'other-app:thing'], ['client', CLIENT_TAG]] }))).toBeNull();
    expect(await decodePrivateRecord(signer, signed({ ...good, tags: [['d', SETTINGS_ADDRESS]] }))).toBeNull();
    expect(await decodePrivateRecord(signer, signed({ ...good, tags: [['d', SETTINGS_ADDRESS], ['client', 'someone-else']] }))).toBeNull();
  });

  it('survives corrupt ciphertext and foreign envelopes without throwing', async () => {
    const signer = fakeSigner();
    const good = await encodePrivateRecord(signer, { address: SETTINGS_ADDRESS, updatedAt: '2026-08-20T10:00:00.000Z', payload: {} });
    expect(await decodePrivateRecord(signer, signed({ ...good, content: 'not-decryptable' }))).toBeNull();
    expect(await decodePrivateRecord(signer, signed({ ...good, content: 'enc:bm90LWpzb24=' }))).toBeNull();
    const wrongVersion = fakeSigner({ nip44Decrypt: async () => JSON.stringify({ v: 99, updatedAt: 'x', payload: {} }) });
    expect(await decodePrivateRecord(wrongVersion, signed(good))).toBeNull();
    const noTimestamp = fakeSigner({ nip44Decrypt: async () => JSON.stringify({ v: 1, payload: {} }) });
    expect(await decodePrivateRecord(noTimestamp, signed(good))).toBeNull();
  });

  it('never logs ciphertext or plaintext when decoding fails', async () => {
    const spies = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})];
    const signer = fakeSigner();
    const good = await encodePrivateRecord(signer, { address: SETTINGS_ADDRESS, updatedAt: '2026-08-20T10:00:00.000Z', payload: { unit: 'kg' } });
    await decodePrivateRecord(signer, signed({ ...good, content: 'enc:broken' }));
    spies.forEach((spy) => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); });
  });
});

// The codec and the relay policy are two halves of one contract, enforced in different
// languages on different machines. Assert them against each other rather than trusting
// that two copies of the prefix stay in step.
describe('codec output against the deployed relay policy', () => {
  it('produces events the write policy accepts, for every address kind', async () => {
    const { decide } = await import('../relay/write-policy.mjs');
    const signer = fakeSigner();
    const addresses = [sheetAddress('push-day'), sessionAddress('9f1c'), BODYWEIGHT_ADDRESS, SETTINGS_ADDRESS];
    for (const address of addresses) {
      const event = await encodePrivateRecord(signer, { address, updatedAt: '2026-08-20T10:00:00.000Z', payload: {} });
      expect(decide({ ...event, id: 'x', pubkey: SELF, sig: 'sig' })).toEqual({ action: 'accept' });
    }
  });

  it('cannot emit anything the policy would reject', async () => {
    const { decide } = await import('../relay/write-policy.mjs');
    // The guard in encodePrivateRecord is what makes this true, so prove the negative too.
    await expect(encodePrivateRecord(fakeSigner(), { address: `${RECORD_PREFIX}`, updatedAt: 'x', payload: {} })).rejects.toThrow();
    expect(decide({ kind: 1, tags: [['d', `${RECORD_PREFIX}settings`]] }).action).toBe('reject');
  });
});
