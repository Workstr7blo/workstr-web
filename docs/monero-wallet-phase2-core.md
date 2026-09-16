# Monero wallet phase 2 core

Issue #246 phase 2 adds the wallet-core boundary without shipping the final wallet UI or native tip send flow.

## What is implemented

- `wallet-runtime.ts` builds the lazy `monero-ts` creation config only after the browser has proved the selected daemon is reachable and on the expected network.
- `wallet-core.ts` owns create, restore, open, sync, balance, and close lifecycle methods behind a small service API.
- `wallet-storage.ts` persists wallet material only through per-account device vault scopes: `monero.hot-wallet.<account pubkey>` for the seed bundle and `monero.hot-wallet-data.<account pubkey>` for the runtime keys and scan cache.
- The core records a dedicated Workstr creator subaddress in wallet metadata so later phases can publish it through `kind:10133` without exposing the primary address by default.

## Storage boundary

The phase-2 wallet bundle is a device-vault secret:

```text
device vault
├── monero.hot-wallet.<account pubkey>        written on create, restore, or legacy adoption
│   ├── seed
│   ├── private spend/view key when exposed by the runtime
│   ├── restore height
│   ├── node config
│   ├── primary address
│   └── Workstr creator subaddress
└── monero.hot-wallet-data.<account pubkey>   rewritten after each sync or balance refresh
    ├── wallet id it belongs to
    ├── monero-ts keys and scan cache, so an open resumes the last sync
    ├── last balance snapshot
    └── last sync snapshot
```

Each Nostr account has its own wallet, so Workstr never links two identities through one
wallet on its own. A user who wants one wallet behind several accounts restores the same seed
in each. A wallet saved by an earlier build under the device-wide `monero.hot-wallet` scope is
moved to an account only when that account's user chooses "Use for this account"; the legacy
copy is deleted after the account copy is written and read back.

Create and restore refuse to run while the account already has a wallet, and check again just
before saving, so no path can overwrite a stored seed. A seed restore without a restore height
scans from block 0. If the saved keys and cache cannot be opened, the wallet is rebuilt from
the seed.

It is not written to Workstr settings, JSON export, encrypted sync records, Nostr events, or localStorage.

## Runtime boundary

`monero-ts` remains lazy-loaded. Normal Workstr startup and the existing Monero address/tip handoff screens do not import the wallet runtime. A future UI should instantiate `MoneroWalletCore` only after the user opens wallet functionality or enables a production wallet flow.

## Lock behavior

Every wallet-core operation checks `vault.isUnlocked()` before using or updating wallet state. `close()` drops the held runtime wallet. The application integration phase must call `close()` whenever the Workstr device vault locks so spend-capable runtime state is discarded with the session.

## Non-goals in this phase

Phase 2 intentionally does not add:

- final wallet UI;
- real mainnet send/tip screens;
- transaction construction/broadcast;
- custom-node settings UI;
- iOS production QA sign-off.

Those belong to later #246 phases after this core boundary is integrated into the app shell and Settings screens.
