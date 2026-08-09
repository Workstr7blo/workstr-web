// Funding configuration. Config, not logic — the maths lives in nostr/zaps.ts.
//
// Workstr is funded by donations; a paid tier is a documented fallback, not a
// plan (docs/instruction.md section 11). The support screen therefore has to
// be honest about two numbers: what came in, and what it costs to run.

// Zap target identity. The Lightning address is published in the operator's
// kind:0 as `lud16`, but v1 support copy treats it as LNURL-pay plumbing behind
// zaps rather than as a separate donation rail: every counted donation should
// leave a NIP-57 receipt.
export const OPERATOR_LUD16 = 'workstr@coinos.io';
export const OPERATOR_NOSTR_HANDLE = 'workstr@workstr.fit';
export const OPERATOR_NOSTR_URL = `https://njump.me/${OPERATOR_NOSTR_HANDLE}`;

// The wallet provider's nostr key, taken from the LNURL-pay metadata for
// OPERATOR_LUD16 (`nostrPubkey`). Zap receipts are signed by the provider, not
// by the donor, so this is the only key that can legitimately say a payment
// happened.
//
// Pinned rather than fetched: it needs no HTTP call, works offline, and is
// deterministic in tests — the same reasoning as the pinned catalog operator
// key. Changing wallet provider means changing this constant and shipping a
// release; historical receipts signed by the old key stop counting, which is
// correct, since the old wallet is no longer the operator's.
export const ZAP_RECEIPT_SIGNER_PUBKEY = '72bdbc57bdd6dfc4e62685051de8041d148c3c68fe42bf301f71aa6cf53e52fb';

// Published monthly operating cost. Section 3.4: asking for money without
// showing the bill is not an option. Denominated in sats deliberately —
// donations arrive in sats, so a sats budget compares directly and the app
// never needs a price feed to tell the truth. This stays aligned with the
// public support page at workstr.fit/support/.
export const MONTHLY_COST_SATS = 85_000;

// Relays queried for zap receipts. Receipts are published by the wallet
// provider to widely-read relays, so this is the broad read set rather than
// the narrow catalog set.
export const ZAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net'
];
