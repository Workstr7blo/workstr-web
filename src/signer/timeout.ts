import { rememberedAutoApprove, type AutoApproveMemory } from './auto-approve';
import type { Signer, UnsignedNostrEvent } from './types';

// Generous on purpose: a NIP-46 request travels to a signer app over a relay and may wait
// on a human tapping approve. What it must not be is absent — a signer that never answers
// leaves a sync pass hanging forever, with no error, no retry, and a status line stuck on
// "Syncing now…" that no button can clear.
export const SIGNER_TIMEOUT_MS = 45000;

export class SignerTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Signer did not respond to ${operation} within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'SignerTimeoutError';
  }
}

// What answering without asking a human looks like. A signer that holds the permission it
// was granted answers in about a second; one that puts the request in front of a person
// cannot. Only the first kind is safe to retry early, because for the other kind an early
// retry is a second prompt for the same record.
export const AUTO_APPROVE_MS = 3000;

// How long to wait before deciding an answer was lost rather than pending, on a signer that
// has shown it answers by itself.
//
// A NIP-46 answer can go missing: the signer publishes it before the client's subscription
// is back on the relay, and an answer nobody is listening for is gone for good. The request
// itself landed, so the signer shows it handled while the client waits out its whole
// timeout. Retrying recovers it immediately — the failed attempt is what puts the
// subscription back up — so the only thing the long wait buys is the delay itself.
export const LOST_ANSWER_MS = 9000;

// Raised only by this wrapper's own deadline, never by the call underneath. Retrying is
// only ever right for the first: a `SignerTimeoutError` coming back out of `run` is a
// nested wrapper that has already spent its whole budget, and retrying that would spend
// this budget waiting for something that has already given up.
class DeadlineExpired extends Error {}

function attempt<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineExpired()), timeoutMs);
    run().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Wraps a signer so no call can hang. The public key is also memoised: it cannot change
// for a given signer, and encoding every record would otherwise spend a round trip re-asking.
export function withSignerTimeout(
  signer: Signer,
  timeoutMs = SIGNER_TIMEOUT_MS,
  memory: AutoApproveMemory = rememberedAutoApprove()
): Signer {
  let pubkey: Promise<string> | null = null;
  // The quickest this signer has ever answered. It is the only evidence available of
  // whether a person is in the loop, and it costs nothing to collect.
  let fastestMs = Number.POSITIVE_INFINITY;

  const guard = <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    // What a remembered answer buys: one early retry, not the run of them a signer observed
    // answering by itself this session gets. The memory describes a permission grant that
    // may since have been revoked, and if it has, every early retry is another prompt in
    // front of a person for the same record. One is a recoverable surprise; a budget's
    // worth is the failure this whole gate exists to prevent.
    let rememberedRetries = 1;

    const once = async (): Promise<T> => {
      const elapsed = Date.now() - started;
      const remaining = timeoutMs - elapsed;
      // The overall budget is unchanged: retrying divides it up rather than extending it,
      // so a signer that is genuinely away still fails when it always did.
      if (remaining <= 0) throw new SignerTimeoutError(operation, timeoutMs);
      const observed = fastestMs <= AUTO_APPROVE_MS;
      const answersItself = observed || (rememberedRetries > 0 && memory.known());
      // Never more than a third of the budget, so there is always room for the retry the
      // short deadline exists to make. A window as long as the budget is just the old
      // single wait wearing a different name.
      const window = Math.min(LOST_ANSWER_MS, Math.floor(timeoutMs / 3));
      const deadline = answersItself ? Math.min(window, remaining) : remaining;

      const attemptStarted = Date.now();
      try {
        const value = await attempt(run, deadline);
        const took = Date.now() - attemptStarted;
        fastestMs = Math.min(fastestMs, took);
        // Written down rather than kept in this wrapper, which is rebuilt every sync pass.
        if (took <= AUTO_APPROVE_MS) memory.record();
        return value;
      } catch (error) {
        // Anything the signer itself raised, including a nested wrapper's timeout, is the
        // answer: it is passed straight on rather than retried.
        if (!(error instanceof DeadlineExpired)) throw error;
        // Only where a retry cannot become a second prompt in front of a person, and only
        // while there is budget left to spend on it.
        if (!answersItself || Date.now() - started >= timeoutMs) {
          throw new SignerTimeoutError(operation, timeoutMs);
        }
        // Spending the remembered retry leaves the rest of the budget as one long wait,
        // which is what a signer with a person behind it needs.
        if (!observed) rememberedRetries -= 1;
        return once();
      }
    };

    return once();
  };
  return {
    type: signer.type,
    getPublicKey: () => {
      if (!pubkey) {
        pubkey = guard('getPublicKey', () => signer.getPublicKey());
        // A failed lookup must not be cached, or the signer can never recover.
        pubkey.catch(() => { pubkey = null; });
      }
      return pubkey;
    },
    signEvent: (event: UnsignedNostrEvent) => guard('signEvent', () => signer.signEvent(event)),
    nip44Encrypt: (peer: string, plaintext: string) => guard('nip44Encrypt', () => signer.nip44Encrypt(peer, plaintext)),
    nip44Decrypt: (peer: string, ciphertext: string) => guard('nip44Decrypt', () => signer.nip44Decrypt(peer, ciphertext))
  };
}
