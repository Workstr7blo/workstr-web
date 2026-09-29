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
  'wss://relay.primal.net',
  'wss://relay.nos.social'
];

// Relays that no longer answer. relay.nostr.band stopped accepting connections, so every
// lookup that included it waited out its full timeout. Builds before this one saved it into
// the synced `publicRelays` setting, which has no editor, so it is dropped wherever a relay
// list is built rather than trusted from storage.
const RETIRED_RELAYS = new Set(['wss://relay.nostr.band']);

export function withoutRetiredRelays(relays: string[]): string[] {
  return relays.filter((relay) => !RETIRED_RELAYS.has(relay.trim().replace(/\/+$/, '').toLowerCase()));
}

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
