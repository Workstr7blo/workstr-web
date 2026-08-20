import { describe, expect, it, vi } from 'vitest';
import { SIGNER_TIMEOUT_MS, SignerTimeoutError, withSignerTimeout } from '../src/signer/timeout';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);

// A signer that never answers — a NIP-46 app that was backgrounded, or a connection that
// died when the user switched apps to approve. This is what hung a whole sync pass.
function deadSigner(): Signer {
  const never = () => new Promise<never>(() => {});
  return { type: 'nip46', getPublicKey: never, signEvent: never, nip44Encrypt: never, nip44Decrypt: never };
}

function liveSigner(): Signer {
  return {
    type: 'nip46',
    getPublicKey: vi.fn(async () => SELF),
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_peer: string, plaintext: string) => plaintext,
    nip44Decrypt: async (_peer: string, ciphertext: string) => ciphertext
  };
}

describe('signer timeout', () => {
  it('rejects every operation a silent signer never answers', async () => {
    vi.useFakeTimers();
    const signer = withSignerTimeout(deadSigner(), 1000);
    const calls = [
      signer.getPublicKey(),
      signer.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' }),
      signer.nip44Encrypt(SELF, 'x'),
      signer.nip44Decrypt(SELF, 'x')
    ].map((promise) => promise.catch((error: Error) => error));
    await vi.advanceTimersByTimeAsync(1500);
    const results = await Promise.all(calls);
    for (const result of results) expect(result).toBeInstanceOf(SignerTimeoutError);
    // Names the operation, so a log says which call the signer ignored.
    expect((results[1] as Error).message).toContain('signEvent');
    vi.useRealTimers();
  });

  it('does not delay a signer that answers', async () => {
    const signer = withSignerTimeout(liveSigner(), 1000);
    expect(await signer.getPublicKey()).toBe(SELF);
    expect(await signer.nip44Encrypt(SELF, 'plaintext')).toBe('plaintext');
  });

  it('asks for the public key once, not once per record', async () => {
    // encodePrivateRecord calls getPublicKey for every record; unmemoised that is an extra
    // NIP-46 round trip per record, on the slowest path there is.
    const inner = liveSigner();
    const signer = withSignerTimeout(inner, 1000);
    await Promise.all([signer.getPublicKey(), signer.getPublicKey(), signer.getPublicKey()]);
    expect(inner.getPublicKey).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed lookup, so the signer can recover', async () => {
    let fail = true;
    const inner: Signer = { ...liveSigner(), getPublicKey: async () => { if (fail) throw new Error('no'); return SELF; } };
    const signer = withSignerTimeout(inner, 1000);
    await expect(signer.getPublicKey()).rejects.toThrow('no');
    fail = false;
    expect(await signer.getPublicKey()).toBe(SELF);
  });

  it('defaults to a window long enough for a human to tap approve', () => {
    // A NIP-46 request may wait on someone switching apps; too short is its own bug.
    expect(SIGNER_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
  });
});
