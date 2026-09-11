// Funding configuration. Config, not logic — the maths lives in nostr/zaps.ts.
//
// Workstr is funded by donations; a paid tier is a documented fallback, not a
// plan (docs/instruction.md section 11). The support screen therefore has to
// be honest about two numbers: what came in, and what it costs to run.

// Zap target identity. The Nostr handle is the human-facing target; the active Lightning
// address is read from the operator's live kind:0 `lud16`/`lud06` metadata before
// requesting invoices or trusting receipts. This fallback is only used if every profile
// relay is unavailable.
export const OPERATOR_LUD16 = 'workstr@rizful.com';
export const OPERATOR_NOSTR_HANDLE = 'workstr@workstr.fit';
export const OPERATOR_NOSTR_URL = `https://njump.me/${OPERATOR_NOSTR_HANDLE}`;

// Published monthly operating cost. Section 3.4: asking for money without
// showing the bill is not an option. Denominated in sats deliberately —
// donations arrive in sats, so a sats budget compares directly and the app
// never needs a price feed to tell the truth. This stays aligned with the
// public support page at workstr.fit/support/.
export const MONTHLY_COST_SATS = 85_000;

// Where Workstr itself is supported on the Monero rail. Unlike the Lightning target this
// cannot be resolved from a profile: a Monero address is not Nostr metadata, and the
// operator's own `kind:10133` target belongs to creator support rather than to Workstr. So
// it is a constant, written down once, and validated before anything renders a payment code
// from it.
export const OPERATOR_MONERO_ADDRESS =
  '43SH87nCju4L58vNbzrM88aSQ1yughBNvBzNauUkT71jNzv7rvdPcqpKRY94VUdEGJXbJs5dshSaNi4jAb9x96ecLid3rQq';

// Relays queried for zap receipts. Receipts are published by the wallet
// provider to widely-read relays, so this is the broad read set rather than
// the narrow catalog set.
export const ZAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net'
];
