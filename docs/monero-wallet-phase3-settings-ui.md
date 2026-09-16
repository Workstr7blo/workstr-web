# Monero wallet phase 3 Settings UI

Issue #246 phase 3 exposes the phase-2 wallet core through Settings without adding the final send/tip transaction flow.

## What is implemented

- A signed-in Settings card named **Monero wallet**.
- The card stays locked while the Workstr device vault is locked.
- Once unlocked, users can:
  - create a local hot wallet;
  - open an existing wallet stored under `monero.hot-wallet`;
  - restore from a Monero recovery seed and optional restore height;
  - sync the opened wallet;
  - refresh balance;
  - copy the wallet creator subaddress into the public Monero tips address field.
- Copying the creator subaddress does **not** publish it automatically. The user must still use the existing public address Save flow, which signs and publishes `kind:10133` with their Nostr signer.

## Boundaries intentionally preserved

- No send transaction UI.
- No transaction construction or broadcast.
- No automatic publish of a payment target.
- No wallet seed/private material in Workstr settings, encrypted sync, JSON export, Nostr events, logs, or generic local storage.
- The wallet runtime is closed when the Workstr vault locks or resets.

## Files

- `src/features/monero/wallet-view.ts` renders the Settings wallet card.
- `src/app/monero-wallet-controller.ts` binds wallet actions to `MoneroWalletCore` and the public address card.
- `src/app/shell.ts` composes the wallet controller and closes it on device-vault lock/reset.
- `src/features/support/payment-mode-views.ts` keeps a copied wallet subaddress visible as an unpublished draft.
- `tests/monero-wallet-controller.test.ts`, `tests/settings-view.test.ts`, and `tests/monero-wallet-core.test.ts` cover the UI/controller/core seams.

## Validation notes

`npm run spike:monero:browser` still builds and exercises the browser spike, but after production CORS tightening it is expected to report the local loopback origin as blocked. Production-origin CORS should be verified with an explicit `Origin: https://app.workstr.fit` RPC probe instead.

## Next phase

The next phase should be the integrated tip-send flow:

1. show a send confirmation from Discover only after a creator has a valid Monero payment target;
2. construct a transaction from the opened wallet;
3. require explicit human confirmation before signing/broadcasting;
4. test with mocks/stagenet only before any mainnet broadcast path is allowed.
