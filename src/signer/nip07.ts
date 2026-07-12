import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from './types';

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nostr?.getPublicKey && window.nostr?.signEvent);
}

export function createNip07Signer(): Signer {
  if (!hasNip07() || !window.nostr) {
    throw new Error('NIP-07 signer not available');
  }
  return {
    type: 'nip07',
    getPublicKey: () => window.nostr!.getPublicKey(),
    signEvent: (event) => window.nostr!.signEvent(event),
    nip44Encrypt: (peerPubkey, plaintext) => {
      if (!window.nostr?.nip44?.encrypt) throw new Error('NIP-44 encrypt not supported by signer');
      return window.nostr.nip44.encrypt(peerPubkey, plaintext);
    },
    nip44Decrypt: (peerPubkey, ciphertext) => {
      if (!window.nostr?.nip44?.decrypt) throw new Error('NIP-44 decrypt not supported by signer');
      return window.nostr.nip44.decrypt(peerPubkey, ciphertext);
    }
  };
}
