import { describe, expect, it, vi } from 'vitest';

// `tests/setup.ts` swaps the derivation for a cheap one everywhere else. This file is where the
// real cost is paid, once, so the parameters shipped to phones are the ones under test.
const kdf = await vi.importActual<typeof import('../src/security/device-vault-kdf')>('../src/security/device-vault-kdf');

describe('device vault key derivation', () => {
  it('ships parameters at or above an OWASP Argon2id floor', () => {
    expect(kdf.DEVICE_VAULT_KDF_PARAMETERS.parallelism).toBe(1);
    expect(kdf.meetsKdfMinimum(kdf.DEVICE_VAULT_KDF_PARAMETERS)).toBe(true);
  });

  it('refuses parameters below the floor instead of falling back to a fast hash', async () => {
    const salt = new Uint8Array(16);
    await expect(kdf.deriveKeyEncryptionKey('123456789', salt, { memoryCost: 64, iterations: 1, parallelism: 1 }))
      .rejects.toMatchObject({ code: 'unsupported-crypto' });
    await expect(kdf.deriveKeyEncryptionKey('123456789', salt, { memoryCost: 19456, iterations: 1, parallelism: 1 }))
      .rejects.toMatchObject({ code: 'unsupported-crypto' });
    expect(kdf.meetsKdfMinimum({ memoryCost: 47104, iterations: 1, parallelism: 1 })).toBe(true);
    expect(kdf.meetsKdfMinimum({ memoryCost: 19456.5, iterations: 2, parallelism: 1 })).toBe(false);
  });

  it('refuses a malformed code before doing any work', async () => {
    await expect(kdf.deriveKeyEncryptionKey('12345678', new Uint8Array(16), kdf.DEVICE_VAULT_KDF_PARAMETERS))
      .rejects.toMatchObject({ code: 'invalid-pin' });
  });

  it('derives a stable 32-byte key at the real cost', async () => {
    const salt = new Uint8Array(16).fill(7);
    const first = await kdf.deriveKeyEncryptionKey('000000001', salt, kdf.DEVICE_VAULT_KDF_PARAMETERS);
    expect(first).toHaveLength(32);
    const other = await kdf.deriveKeyEncryptionKey('000000002', salt, kdf.DEVICE_VAULT_KDF_PARAMETERS);
    expect(Buffer.from(other).equals(Buffer.from(first))).toBe(false);
  }, 60_000);
});
