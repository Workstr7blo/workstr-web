# Monero wallet phase 5: sending and integrated tips

Issue #246 phase 5 lets the Tip Jar spend. A creator tip from a program card and a plain send
from the Tip Jar page go through the same sheet, and no external wallet is needed.

## Flow

1. **Amount.** A creator tip shows the creator, the program, the spendable balance and three
   quick amounts (0.001, 0.005, 0.01 XMR). A plain send also asks for an address. Amounts are
   parsed into atomic units as strings and BigInts; a floating-point XMR value never exists.
2. **Review.** `MoneroWalletCore.prepareTransfer` calls `createTx({ accountIndex: 0, address,
   amount, relay: false })`. The transfer is built and signed inside the wallet runtime on this
   device, and the node sees nothing yet. The sheet shows amount, recipient, a shortened
   address, the network fee and the total, every one to full precision.
3. **Confirm.** Only the explicit Send tip / Send button calls `relayTransfer`, which relays the
   signed transaction's metadata through the configured node and returns the txid. The wallet's
   keys and scan cache are saved straight after, so a restart does not offer the spent outputs
   again.
4. **Result.** The sheet shows the txid and says the transfer is final once the network confirms
   it. The txid, creator pubkey, program and profile snapshot go to Tip Jar activity (#263) as a
   `submitted` record, which the next sync joins to the wallet's own transaction by txid.

## When a send may start

`sendReadiness` in `src/features/monero/wallet-send.ts`: the Tip Jar is on, the user is signed
in, the device vault is unlocked, the wallet is open and synchronized, and it holds spendable
(unlocked) XMR. Received XMR is spendable after 10 confirmations, and the sheet says so.

A program card's Tip never falls back to a creator address, QR or `monero:` link. If the Tip
Jar is not ready, Workstr shows the native Tip Jar state instead: enable Tip Jar, open Settings
to sign in or unlock, set up the Tip Jar, wait for sync, or add funds to the user's own Receive
code. The creator's public NIP-A3 address is still the internal transaction destination once the
Tip Jar is ready. The Tip Jar page's generic Send button stays disabled until the same readiness
check passes.

## Failure handling

- **Wrong address or network.** Rejected before anything is built. A mainnet wallet accepts only
  mainnet addresses (`4`/`8` prefixes), and the same rule applies per network for stagenet and
  testnet.
- **Insufficient balance.** Checked against the spendable balance before building, and against
  amount plus the real fee after.
- **Build failure** (fee estimate, node, wallet). The sheet goes back to the amount with the
  reason. Nothing was broadcast, so trying again is safe.
- **Broadcast failure.** The outcome is unknown, because the node may have accepted the
  transaction before the error. The sheet says so, points to Recent activity, and offers only
  Close. There is no automatic or manual resend from this state, so a tip cannot be paid twice.
- **Sheet closed mid-send.** The send finishes and its result arrives as a toast.

## Boundaries

- The seed and private spend key stay in the wallet runtime. The node receives the signed
  transaction and nothing else.
- Nothing is published to Nostr. Who was tipped, the amount and the txid stay in the device
  vault and the encrypted Tip Jar backup.
- No priority controls, output selection, address book or fiat values, as the issue's non-goals
  require.

## Not covered here

- Custom node settings. The node is fixed to the Workstr node the wallet was created with.
- A real mainnet send has not been run from automated tests. The runtime calls are exercised
  against a fake wallet, and the monero-ts proxy's `createTx`/`relayTx` contract was checked
  against the installed library source. A first small real tip on device is the remaining QA
  step (see `docs/monero-ios-qa-checklist.md`).
