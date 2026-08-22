import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNER_TIMEOUT_MS, SignerTimeoutError, withSignerTimeout } from '../src/signer/timeout';
import { forgetAutoApprove, type AutoApproveMemory } from '../src/signer/auto-approve';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);

// Evidence that a signer answers by itself outlives the wrapper that collected it, so a
// test that leaves it behind changes how the next one waits.
beforeEach(() => forgetAutoApprove());

const blank: AutoApproveMemory = { known: () => false, record: () => {} };

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

describe('an answer that went missing', () => {
  // The failure this exists for: the signer answers, the answer arrives before the client's
  // subscription is back on the relay, and it is gone. The request landed, so the signer
  // shows it handled while the client waits. Retrying recovers it, because the attempt that
  // failed is what put the subscription back up.
  function lossySigner(loseFirst: number): { signer: Signer; calls: number } {
    const state = { calls: 0, signer: null as unknown as Signer };
    state.signer = {
      type: 'nip46',
      getPublicKey: async () => 'ab'.repeat(32),
      signEvent: async (event) => {
        state.calls += 1;
        // A lost answer is silence, not an error: nothing ever resolves.
        if (state.calls <= loseFirst) return new Promise(() => {}) as never;
        return { ...event, id: 'id', pubkey: 'ab'.repeat(32), sig: 'sig' };
      },
      nip44Encrypt: async (_peer, plaintext) => plaintext,
      nip44Decrypt: async (_peer, ciphertext) => ciphertext
    } as Signer;
    return state as { signer: Signer; calls: number };
  }

  it('waits the whole budget on a signer that has never answered quickly', async () => {
    const lossy = lossySigner(1);
    // No fast answer on record, so a person may be deciding: retrying early would put a
    // second prompt in front of them for one record.
    const guarded = withSignerTimeout(lossy.signer, 60, blank);
    await expect(guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' }))
      .rejects.toBeInstanceOf(SignerTimeoutError);
    expect(lossy.calls).toBe(1);
  });

  it('retries quickly once the signer has shown it answers by itself', async () => {
    const lossy = lossySigner(0);
    const guarded = withSignerTimeout(lossy.signer, 900);
    // A first answer, fast, which is what marks the signer as one that needs no human.
    await guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' });
    expect(lossy.calls).toBe(1);

    // Now lose the next answer entirely.
    let dropped = 0;
    const original = lossy.signer.signEvent;
    lossy.signer.signEvent = ((event) => {
      dropped += 1;
      return dropped === 1 ? new Promise(() => {}) : original(event);
    }) as Signer['signEvent'];

    const signed = await guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' });

    // Recovered rather than waiting out the full budget, and without a second prompt
    // because this signer never prompts.
    expect(signed.sig).toBe('sig');
    expect(dropped).toBe(2);
  }, 20000);

  it('carries what it learned into the next wrapper, which is where a page load starts', async () => {
    // The wrapper is rebuilt every sync pass, so evidence held only inside one is blank on
    // the call most likely to need it: the first of a pass, on a cold connection.
    const lossy = lossySigner(0);
    await withSignerTimeout(lossy.signer, 900).signEvent({ kind: 30078, created_at: 0, tags: [], content: '' });

    let dropped = 0;
    const original = lossy.signer.signEvent;
    lossy.signer.signEvent = ((event) => {
      dropped += 1;
      return dropped === 1 ? new Promise(() => {}) : original(event);
    }) as Signer['signEvent'];

    const fresh = withSignerTimeout(lossy.signer, 900);
    const signed = await fresh.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' });

    expect(signed.sig).toBe('sig');
    expect(dropped).toBe(2);
  }, 20000);

  it('spends a remembered retry once, then waits like a signer with a person behind it', async () => {
    // The grant the memory describes can have been revoked since. One early retry is a
    // recoverable surprise; a budget's worth is a prompt storm for a single record.
    const lossy = lossySigner(99);
    const remembered: AutoApproveMemory = { known: () => true, record: () => {} };
    const guarded = withSignerTimeout(lossy.signer, 900, remembered);

    await expect(guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' }))
      .rejects.toBeInstanceOf(SignerTimeoutError);
    expect(lossy.calls).toBe(2);
  }, 20000);

  it('still gives up when every retry is swallowed', async () => {
    const lossy = lossySigner(0);
    const guarded = withSignerTimeout(lossy.signer, 300);
    await guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' });

    lossy.signer.signEvent = (() => new Promise(() => {})) as Signer['signEvent'];
    await expect(guarded.signEvent({ kind: 30078, created_at: 0, tags: [], content: '' }))
      .rejects.toBeInstanceOf(SignerTimeoutError);
  }, 20000);
});
