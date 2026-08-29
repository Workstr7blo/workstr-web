# NWC workout zap manual verification

Date: 2026-08-29
Task: `t_0c477b5f`
Branch: `wt/t_0c477b5f`

## Environment

- Repository/worktree: `/home/vmapps/docker/claude/Nostr/workstr-web/.worktrees/t_0c477b5f`
- OS: Linux 6.8.0-124-generic
- Node.js: v22.22.2
- npm: 10.9.7
- App version: `workstr-web@2.0.0`
- Source baseline for verification: parent branch `wt/t_7c0bffbd` merged into this task branch, bringing the completed NWC connection, workout-program zap logic, and program zap UI.

## Credentials strategy

No live NWC wallet credential or LNURL test wallet credential was present in the task environment. `printenv` showed no NWC/LNURL/Lightning wallet variable; raw environment output was not copied into this document because the shell redacts unrelated secrets.

To avoid using or exposing a funded wallet credential, the successful-payment verification used a local mock wallet and local LNURL-pay endpoint in `tests/nwc-mock-wallet-integration.test.ts`:

- The mock NWC wallet runs a local WebSocket relay on `127.0.0.1`.
- The connection string uses deterministic test-only hex keys from the test file, not user or production wallet material.
- The app client still uses the production NWC relay transport (`SimplePool`, kind `23194` requests, NIP-04 encryption, kind `23195` responses).
- The mock LNURL-pay server runs a local HTTP endpoint and returns a 21-sat invoice string used by the existing invoice parser path.
- The mock wallet can switch between a success response and a `PAYMENT_FAILED` response.

Do not reuse the deterministic test keys outside this mock harness. They are deliberately non-secret fixtures.

## Manual verification steps and results

### 1. Configuration and wallet connection setup

Steps performed:

1. Merged completed NWC UI/workout-zap implementation from `wt/t_7c0bffbd` into this task branch.
2. Inspected the relevant implementation paths:
   - `src/app/nwc-controller.ts`
   - `src/nostr/nwc.ts`
   - `src/nostr/nwc-client.ts`
   - `src/nostr/program-zap.ts`
   - `src/nostr/program-zap-status.ts`
   - `src/nostr/zap-request.ts`
   - `src/nostr/zaps.ts`
   - `src/features/sheets/program-zap-view.ts`
3. Confirmed NWC setup requires a `nostr+walletconnect://...` URI with:
   - 64-hex wallet service pubkey
   - one or more `relay=` WebSocket URLs
   - 64-hex `secret=` client key
   - optional `lud16=` display label
4. Ran the local mock-wallet harness, which validates a connection by sending a real NIP-47 `get_info` request over the local relay.

Expected result:

- Invalid or expired connection strings fail before storage.
- Reachable wallets must answer `get_info` and advertise `pay_invoice` before Workstr treats the connection as active.
- Secrets are masked/redacted in UI and error paths.

Actual result:

- `tests/nwc-mock-wallet-integration.test.ts` validated a local NWC connection using the production relay transport and received mock wallet info with alias `Local Mock Wallet` and methods `get_info`, `pay_invoice`.
- Existing targeted tests also cover invalid format, expired connection, unsupported `pay_invoice`, unauthorized validation, unreachable service, timeout, secure storage, and redaction behavior.

### 2. Zap creation and recipient resolution

Steps performed:

1. The mock program used a valid NIP-101e kind `33402:<pubkey>:mock-program` address.
2. The program author carried `lud06` LNURL metadata pointing at the local mock LNURL-pay server.
3. The zap execution path called `executeWorkoutProgramZap()` with:
   - amount: 21 sats
   - comment: `manual mock-wallet zap`
   - signer: test signer returning a deterministic sender pubkey and signed kind `9734` zap request
   - NWC connection: parsed local mock wallet connection

Expected result:

- Recipient resolution rejects local/unpublished programs, missing pubkeys, malformed pubkeys, malformed addresses, missing LNURL metadata, malformed LNURL metadata, and malformed relays.
- For a valid published program, Workstr signs a NIP-57 kind `9734` zap request with the program author `p` tag, program address `a` tag, `lnurl`, `amount`, `client`, and `app` tags.
- Workstr requests an invoice from the resolved LNURL callback before asking the wallet to pay.

Actual result:

- The success case produced a zap request tagged to the mock program author and `33402` program address.
- The local LNURL callback was called exactly once with `amount=21000` msats and a serialized `nostr` zap request.
- The mock NWC wallet observed exactly `get_info` followed by `pay_invoice` in the setup + successful zap test.

### 3. Successful payment behavior

Steps performed:

1. The local LNURL callback returned a 21-sat invoice.
2. The production payment payload builder verified the invoice amount matched the requested zap amount.
3. The production NWC client sent `pay_invoice` over the local relay.
4. The mock wallet returned a successful `pay_invoice` response with a preimage, zero fees, and a payment hash.

Expected result:

- The zap completes successfully only after a matching invoice amount and successful NWC payment response.
- The result includes invoice, recipient metadata, signed zap request, and payment metadata.

Actual result:

- The mock-wallet integration test passed and returned payment metadata:
  - preimage present
  - `feesPaidMsat: 0`
  - payment hash present
- This verifies the Workstr client path can complete a NIP-47 payment round trip against a realistic local wallet relay.

### 4. Missing recipient behavior

Steps performed:

1. Ran the mock-wallet integration case with the program `lud06` removed.
2. Kept the NWC connection available to prove recipient validation happens before invoice or wallet payment work.

Expected result:

- Workstr returns a structured recipient error.
- No LNURL callback is requested.
- No NWC payment request is sent.

Actual result:

- The result was `invalid-recipient` with nested recipient error `missing-lnurl`.
- The local LNURL callback request count remained `0`.
- The mock wallet received no methods for this missing-recipient case.

### 5. Simulated payment failure behavior

Steps performed:

1. Switched the mock wallet to `payment-failure` mode.
2. Ran the same valid program zap flow.
3. The mock wallet returned NWC error code `PAYMENT_FAILED` for `pay_invoice`.

Expected result:

- Workstr maps NWC wallet payment failures to a structured workout-program zap failure.
- The UI/status layer can render a failed creator-zap attempt and preserve safe error metadata without leaking NWC secrets.

Actual result:

- The result was `payment-failed` with `nwcCode: payment_failure` and `nwcKind: payment_failure`.
- The mock wallet observed exactly one `pay_invoice` method for this failure case.
- Existing `program-zap-status` tests cover persistence of pending-to-failed status and safe metadata.

## Commands run

```text
npm test -- --run tests/nwc-client.test.ts tests/nwc.test.ts tests/zaps.test.ts tests/program-zap.test.ts tests/program-zap-status.test.ts tests/nwc-storage.test.ts tests/nwc-ui.test.ts tests/nwc-lifecycle.test.ts tests/support-zap.test.ts
```

Result:

```text
Test Files  9 passed (9)
Tests       92 passed (92)
```

```text
npm test -- --run tests/nwc-mock-wallet-integration.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

```text
npm run check
```

Result:

```text
Result: 0 error(s), 37 warning(s)
Test Files  59 passed | 1 skipped (60)
Tests       681 passed | 6 skipped (687)
✓ built in 787ms
```

```text
npm run preview
curl -I http://localhost:4192/?verify=t_0c477b5f
```

Result:

```text
HTTP/1.1 200 OK
Content-Type: text/html
```

## Limitations and caveats

- No real funded NWC wallet was used. The success and failure payment paths were verified with a local mock NIP-47 wallet relay to avoid spending real funds or handling production wallet secrets in this task.
- No real external LNURL-pay provider callback was used. The invoice callback was local and deterministic.
- The mock harness verifies the production NWC wire protocol path, LNURL callback shape, invoice amount check, and payment/error mapping. It does not prove that a specific third-party wallet app accepts Workstr's UX copy or permission prompt.
- Browser UI behavior was covered by existing jsdom tests for wallet connection, zap modals, and status rendering rather than by a live browser connected to a funded wallet.
- A live browser smoke was attempted against the local preview URL, but the browser harness could not launch Chrome in this headless Kanban environment (`chrome-not-running`). The local preview server itself returned HTTP 200 for the verification URL above.

## Maintainer reproduction checklist

1. From the repo root, run:
   - `npm test -- --run tests/nwc-mock-wallet-integration.test.ts`
   - `npm test -- --run tests/nwc-client.test.ts tests/nwc.test.ts tests/zaps.test.ts tests/program-zap.test.ts tests/program-zap-status.test.ts tests/nwc-storage.test.ts tests/nwc-ui.test.ts tests/nwc-lifecycle.test.ts tests/support-zap.test.ts`
2. For a real wallet smoke test, create a low-budget NWC connection in a test wallet, paste it in Settings → Zap wallet, verify `pay_invoice` is allowed, then zap a published program whose author profile has `lud16` or `lud06` metadata.
3. Use a very small amount and confirm the wallet app's payment history independently before treating the zap as paid.
4. If connection fails, check URI format, expiry, relay reachability, and `pay_invoice` permission.
5. If creator zaps fail, check that the program is published (`33402` address), the author pubkey matches the address, author zap metadata exists, the LNURL endpoint allows Nostr zaps, and the invoice amount matches the requested sats.
