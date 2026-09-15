# Monero wallet iOS QA checklist

Use this checklist after the desktop/headless phase-1 spike passes and before building the
production wallet UI for issue #246.

## Devices

- [ ] iPhone Safari, current iOS.
- [ ] Installed Workstr PWA launched from the home screen.
- [ ] Optional older iPhone with lower memory pressure tolerance.

## Setup

- [ ] Use a stagenet or mock wallet only.
- [ ] Do not use real mainnet funds.
- [ ] Confirm the build is served over HTTPS.
- [ ] Confirm the build version/commit under Settings -> Advanced.
- [ ] Confirm the device vault unlock flow works before opening the Monero spike/wallet path.

## Browser/runtime

- [ ] Open the Monero phase-1 spike page.
- [ ] Confirm `monero-ts` loads without a blank page.
- [ ] Confirm no console error mentions missing `WebAssembly`, worker, `SharedArrayBuffer`,
      `fs`, `path`, `crypto`, `http`, `https`, or `child_process`.
- [ ] Confirm any required CSP changes are documented before changing production headers.
- [ ] Confirm no `unsafe-eval` or `wasm-unsafe-eval` requirement is introduced without an
      explicit security review.

## Node connectivity

- [ ] Test Workstr default node: `xmr.workstr.fit:43736`, TLS enabled.
- [ ] Confirm whether Safari reports CORS / `Failed to fetch` / certificate errors.
- [ ] If direct access fails, test the chosen CORS/proxy fix before proceeding.
- [ ] Confirm the node reports mainnet for the default mainnet config.
- [ ] Confirm stagenet/testnet is never silently accepted for a mainnet wallet.

## Persistence and lifecycle

- [ ] Create a mock/stagenet wallet.
- [ ] Verify creator subaddress is generated.
- [ ] Close Safari tab and reopen.
- [ ] Relaunch installed PWA from home screen.
- [ ] Background the PWA for at least one minute and foreground it.
- [ ] Force-kill the PWA and reopen.
- [ ] Toggle airplane mode during sync/probe and restore network.
- [ ] Switch Wi-Fi to cellular and cellular to Wi-Fi.
- [ ] Confirm wallet/cache state is not corrupted or silently reset.

## Locking/security

- [ ] Lock Workstr from Settings.
- [ ] Confirm wallet signing/spend capability becomes unavailable while locked.
- [ ] Unlock with the Workstr device code.
- [ ] Confirm wallet availability resumes only after unlock.
- [ ] Confirm the recovery seed/spend key is never logged or displayed outside an explicit
      backup/reveal flow.

## Performance

- [ ] Record initial load time before opening Monero wallet.
- [ ] Record time to load Monero runtime.
- [ ] Record approximate memory pressure symptoms: reloads, tab kills, slow keyboard, or
      Safari warning banners.
- [ ] Confirm normal Workstr workout flows remain usable after opening/closing the Monero path.

## Pass/fail decision

Proceed to wallet core only if:

- [ ] Monero runtime loads in Safari and installed PWA.
- [ ] Browser-compatible daemon/RPC path is confirmed.
- [ ] Wallet state survives reload/PWA restart/background/foreground.
- [ ] Locking removes spend capability.
- [ ] No real secrets are logged or synced.

If any item fails, document the exact device/iOS version/build/console error and solve that
blocker before production UI work.
