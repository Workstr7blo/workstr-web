export interface RelayProfile {
  pubkey: string;
  name?: string;
  picture?: string;
  nip05?: string;
  createdAt?: number;
}

export const DEFAULT_PUBLIC_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];
