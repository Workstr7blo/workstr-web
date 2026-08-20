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

function guard<T>(operation: string, run: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SignerTimeoutError(operation, timeoutMs)), timeoutMs);
    run().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Wraps a signer so no call can hang. The public key is also memoised: it cannot change
// for a given signer, and encoding every record would otherwise spend a round trip re-asking.
export function withSignerTimeout(signer: Signer, timeoutMs = SIGNER_TIMEOUT_MS): Signer {
  let pubkey: Promise<string> | null = null;
  return {
    type: signer.type,
    getPublicKey: () => {
      if (!pubkey) {
        pubkey = guard('getPublicKey', () => signer.getPublicKey(), timeoutMs);
        // A failed lookup must not be cached, or the signer can never recover.
        pubkey.catch(() => { pubkey = null; });
      }
      return pubkey;
    },
    signEvent: (event: UnsignedNostrEvent) => guard('signEvent', () => signer.signEvent(event), timeoutMs),
    nip44Encrypt: (peer: string, plaintext: string) => guard('nip44Encrypt', () => signer.nip44Encrypt(peer, plaintext), timeoutMs),
    nip44Decrypt: (peer: string, ciphertext: string) => guard('nip44Decrypt', () => signer.nip44Decrypt(peer, ciphertext), timeoutMs)
  };
}
