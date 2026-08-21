import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_VERSION, FLAG_GZIP, HEADER_BYTES, MAX_PLAINTEXT_BYTES, NONCE_BYTES,
  base64ToBytes, bytesToBase64, openEnvelope, sealEnvelope, type EnvelopeContext
} from '../src/nostr/envelope';

const PUBKEY = 'ab'.repeat(32);
const CONTEXT: EnvelopeContext = { pubkey: PUBKEY, address: 'workstr:v2:session:9f1c' };

// Fixed key bytes so a failure is reproducible rather than a different key every run.
const KEY_BYTES = new Uint8Array(32).map((_, index) => (index * 7 + 3) & 0xff);

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', KEY_BYTES, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function otherKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new Uint8Array(32).fill(9), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const record = (updatedAt: string, payload: unknown): string => JSON.stringify({ updatedAt, payload });

// A session-shaped payload: repetitive enough to compress, which is the point of the flag.
const session = record('2026-08-21T11:05:00.000Z', {
  started_at: '2026-08-21T10:00:00.000Z',
  sets: Array.from({ length: 20 }, (_, index) => ({
    exercise_slug: 'barbell-bench-press', set_number: (index % 4) + 1, reps: 8, weight_kg: 82.5, rpe: 8,
    completed_at: `2026-08-21T10:${String(index).padStart(2, '0')}:00.000Z`
  }))
});

describe('record envelope', () => {
  it('round-trips a record through seal and open', async () => {
    const k = await key();
    const sealed = await sealEnvelope(k, CONTEXT, session);
    expect(await openEnvelope(k, CONTEXT, sealed)).toBe(session);
  });

  it('writes the version and nonce in the clear, ahead of the ciphertext', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    expect(bytes[0]).toBe(ENVELOPE_VERSION);
    expect(bytes.length).toBeGreaterThan(HEADER_BYTES);
    // The decoder has to reach all of this before it can decrypt anything.
    expect(bytes.subarray(2, HEADER_BYTES)).toHaveLength(NONCE_BYTES);
  });

  it('compresses a session and says so in the flags', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    expect(bytes[1] & FLAG_GZIP).toBe(FLAG_GZIP);
    // Worth having: this is the whole reason a record fits where it did not before.
    expect(bytes.length).toBeLessThan(session.length / 2);
  });

  it('leaves a tombstone uncompressed, because gzip would make it bigger', async () => {
    const tombstone = JSON.stringify({ updatedAt: '2026-08-21T11:05:00.000Z', deleted: true });
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, tombstone))!;
    expect(bytes[1] & FLAG_GZIP).toBe(0);
    expect(await openEnvelope(await key(), CONTEXT, bytesToBase64(bytes))).toBe(tombstone);
  });

  it('uses a fresh nonce every time, so one key can seal many records', async () => {
    const k = await key();
    const nonces = new Set<string>();
    for (let index = 0; index < 25; index += 1) {
      const bytes = base64ToBytes(await sealEnvelope(k, CONTEXT, session))!;
      nonces.add(bytesToBase64(bytes.subarray(2, HEADER_BYTES) as Uint8Array<ArrayBuffer>));
    }
    // A repeat under one AES-GCM key leaks the XOR of the plaintexts, so this is not a
    // stylistic preference: the whole design shares one key across every device.
    expect(nonces.size).toBe(25);
  });
});

describe('an envelope that should not open', () => {
  it('refuses the wrong key', async () => {
    const sealed = await sealEnvelope(await key(), CONTEXT, session);
    expect(await openEnvelope(await otherKey(), CONTEXT, sealed)).toBeNull();
  });

  it('refuses a record moved to another address', async () => {
    const sealed = await sealEnvelope(await key(), CONTEXT, session);
    const elsewhere = { pubkey: PUBKEY, address: 'workstr:v2:session:0000' };
    expect(await openEnvelope(await key(), elsewhere, sealed)).toBeNull();
  });

  it('refuses a record replayed under another identity', async () => {
    const sealed = await sealEnvelope(await key(), CONTEXT, session);
    expect(await openEnvelope(await key(), { ...CONTEXT, pubkey: 'cd'.repeat(32) }, sealed)).toBeNull();
  });

  it('refuses a flipped gzip flag instead of failing as corruption', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    bytes[1] ^= FLAG_GZIP;
    // The flag byte is cleartext and outside the ciphertext, so it is only protected
    // because it is fed to AES-GCM as additional data.
    expect(await openEnvelope(await key(), CONTEXT, bytesToBase64(bytes))).toBeNull();
  });

  it('refuses a reserved flag bit it does not understand', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    bytes[1] |= 0x40;
    expect(await openEnvelope(await key(), CONTEXT, bytesToBase64(bytes))).toBeNull();
  });

  it('refuses an envelope version from the future', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    bytes[0] = ENVELOPE_VERSION + 1;
    expect(await openEnvelope(await key(), CONTEXT, bytesToBase64(bytes))).toBeNull();
  });

  it('refuses a single flipped ciphertext byte', async () => {
    const bytes = base64ToBytes(await sealEnvelope(await key(), CONTEXT, session))!;
    bytes[bytes.length - 1] ^= 0x01;
    expect(await openEnvelope(await key(), CONTEXT, bytesToBase64(bytes))).toBeNull();
  });

  it('refuses content that is not base64, or is too short to hold a header', async () => {
    const k = await key();
    expect(await openEnvelope(k, CONTEXT, 'not base64 !!')).toBeNull();
    expect(await openEnvelope(k, CONTEXT, bytesToBase64(new Uint8Array(HEADER_BYTES)))).toBeNull();
    expect(await openEnvelope(k, CONTEXT, '')).toBeNull();
  });

  it('refuses a decompression bomb rather than buffering it', async () => {
    const k = await key();
    // Compresses to a few hundred bytes and inflates past the ceiling, which is exactly
    // the shape the limit exists for.
    const bomb = 'a'.repeat(MAX_PLAINTEXT_BYTES + 1024);
    const sealed = await sealEnvelope(k, CONTEXT, bomb);
    expect(base64ToBytes(sealed)!.length).toBeLessThan(4096);
    expect(await openEnvelope(k, CONTEXT, sealed)).toBeNull();
  });

  it('still opens a record that sits just under the ceiling', async () => {
    const k = await key();
    const large = 'b'.repeat(MAX_PLAINTEXT_BYTES - 1024);
    expect(await openEnvelope(k, CONTEXT, await sealEnvelope(k, CONTEXT, large))).toBe(large);
  });
});
