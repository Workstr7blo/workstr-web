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

export const DEFAULT_WRITE_RELAYS = [
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://relay.wellorder.net',
  'wss://bitcoiner.social',
  'wss://relay.powr.build',
  'wss://relay.nos.social',
  'wss://nostr.bitcoiner.social',
  'wss://nostr-pub.wellorder.net'
];
