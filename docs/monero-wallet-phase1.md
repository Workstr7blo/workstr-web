# Monero wallet phase 1 technical spike

Issue: [#246](https://github.com/Workstr7blo/workstr-web/issues/246)

This phase deliberately does **not** ship a production wallet UI. It answers whether the
current Workstr PWA can safely move toward an integrated, self-custodial Monero hot wallet.

## Scope

Phase 1 adds:

- a lazy, standalone Monero spike entry point (`monero-spike.html`);
- `monero-ts` as a temporary spike dependency;
- default/custom/mock node configuration helpers;
- a browser daemon probe for the Workstr node;
- a mock stagenet wallet model for storage/security boundary tests;
- a desktop headless check script;
- an iOS Safari / installed-PWA QA checklist.

It does not add:

- real wallet creation with spendable funds;
- mainnet transaction construction or relay;
- production wallet screens;
- Monero secrets in Workstr sync/export payloads;
- external-wallet removal from the current copy/QR fallback flow.

## Default node

The issue-specified default is represented exactly as:

```ts
{
  mode: 'workstr',
  host: 'xmr.workstr.fit',
  port: 43736,
  ssl: true,
  network: 'mainnet'
}
```

The browser probe calls `https://xmr.workstr.fit:43736/json_rpc` with `get_info`.

## Current finding

From this environment, TLS and daemon RPC work outside the browser, but the browser probe
returns `TypeError: Failed to fetch`. In Chromium this is the same failure shape produced by
CORS/network policy blocks. The daemon's direct HTTP responses did not include
`Access-Control-Allow-Origin` in the preflight/RPC checks.

That means the next wallet phase should not assume a browser can talk directly to the
Workstr daemon. The likely solution is documented in `docs/monero-rpc-browser-bridge.md`: keep the daemon
restricted and TLS-protected, but front it with a browser-aware proxy that answers `OPTIONS`
and adds explicit `Access-Control-Allow-Origin` for `https://app.workstr.fit` (plus the local
preview origin during testing). A same-origin RPC bridge is the fallback if Workstr later
moves off pure static hosting.

Do not build production wallet UI until this blocker is resolved and rerun against a real
stagenet wallet.

## `monero-ts` result

The spike verifies that `monero-ts` can be dynamically imported in a production-built Vite
page. It is intentionally not imported by the normal app shell, so the base Workstr bundle is
not increased for users who never open the spike/wallet path.

Vite emits browser-compatibility warnings because `monero-ts` includes Node-oriented modules
such as `assert`, `http`, `https`, `fs`, `path`, `child_process`, and `crypto`. The phase-1
headless check is therefore required evidence: a successful bundle alone is not enough.

## Mock stagenet wallet

`src/features/monero/mock-stagenet-wallet.ts` creates fake stagenet wallet metadata and
secret material for boundary tests. It proves the intended storage path:

```text
Workstr device vault
└── monero.hot-wallet
    ├── seed
    ├── private spend key
    ├── private view key
    └── metadata
```

The mock is not a real Monero wallet and must never be presented as one. It exists so the
storage, sync/export exclusion, and lock requirements can be tested without spending real XMR
or depending on an unstable browser wallet runtime.

## Commands

```bash
npm test -- --run tests/monero-wallet-spike.test.ts
npm run build:monero-spike
npm run spike:monero:browser
```

`npm run check` remains the repository baseline before any handoff.

## Security boundaries confirmed by this phase

- Monero wallet scope is `monero.hot-wallet`, separate from `nostr.local-key`.
- Mock wallet material is independent of Nostr keys and contains no `nsec`.
- Wallet secret writes require an unlocked device vault interface.
- Wallet secret material is not added to synced settings.
- Wallet secret material is not added to JSON export stores.
- Public Monero payment target remains sourced from Nostr `kind:10133`, not private Workstr
  sync state.

## Stop condition

If browser daemon access stays blocked, pause production wallet work and solve transport
first. A UI without a browser-compatible daemon path would create an unusable wallet shell.
