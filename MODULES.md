# Workstr Web module map

Use this file to route a task to the smallest useful set of source and test files. It
describes the current repository, not future roadmap modules.

## Runtime path

```text
src/main.ts
  -> app/shell.ts          boot, state, handlers, persistence coordination
  -> app/layout.ts         persistent frame, page markup, session-overlay markup
  -> app/session-runner.ts live-session coordinator
  -> features/*            feature calculations and view markup
  -> db/store.ts           IndexedDB operations
  -> nostr/* / signer/*    network and external signing boundaries
```

`renderShell()` owns the long-lived `AppState`. Ordinary navigation rerenders the current
page; the frame around it is mounted once. Live-session controllers own the session overlay
and patch it directly, which is also why a page render can leave it standing.

## Route by concern

| Concern | Start here | Usually read next | Tests |
|---|---|---|---|
| Boot and application coordination | `src/main.ts`, `src/app/shell.ts` | `src/app/state.ts`, `src/app/layout.ts` | `tests/shell.test.ts` |
| Applying a shipped PWA update without interrupting anyone | `src/app/update-controller.ts` | `src/app/pwa.ts`, `public/sw.js`, `docs/device-vault-architecture.md` (why an unlocked vault delays it) | `tests/pwa.test.ts`, production-build browser validation |
| Identity, signer connection, and adoption | `src/app/identity-controller.ts` | `src/signer/types.ts`, `src/db/adopt.ts` | `tests/shell.test.ts`, `tests/adopt.test.ts`, browser verification |
| Local account keys and where the secret lives | `src/signer/local-key.ts` | `src/security/device-vault.ts`, `src/signer/local-key-storage.ts` (the pre-vault store, read only to migrate out of) | `tests/local-key-signer.test.ts`, `tests/local-key-migration.test.ts`, `tests/local-key-storage.test.ts` |
| Device vault: storage, unlocked session, scopes, changing the code | `src/security/device-vault.ts` | `src/security/device-vault-crypto.ts`, `src/security/device-vault-kdf.ts`, `src/security/device-vault-types.ts`, `src/security/device-pin.ts`, `docs/device-vault-architecture.md` | `tests/device-vault.test.ts`, `tests/device-vault-kdf.test.ts` |
| Device vault screens: unlock at launch, protect an existing account, device code prompts, lock, reset | `src/app/device-vault-controller.ts` | `src/app/device-vault-view.ts`, `src/app/device-pin-input.ts`, `src/app/device-vault-backoff.ts` (wrong-code waits, kept across reloads), `src/app/shell.ts` (`boot`), `src/app/identity-controller.ts` | `tests/device-vault-controller.test.ts`, `tests/shell.test.ts` |
| Auto-lock after inactivity (#278): the setting, the activity clock, and locking through the vault's own `lock` | `src/app/auto-lock.ts` | `src/app/device-vault-view.ts` (the Auto-lock select), `src/app/device-vault-controller.ts` (`lock`), `src/app/shell.ts` | `tests/auto-lock.test.ts` |
| Page security: the Content Security Policy, image fallbacks without inline script, XSS regression, and the secret-logging guard (#278) | `index.html` (the CSP), `src/app/image-fallback.ts`, `docs/security-model.md` | `src/main.ts`, `src/browser-smoke.ts` (both install the fallbacks), `src/app/format.ts` (`html`), `scripts/monero-ts-csp.mjs` with `vite.config.ts` (the build patch that keeps monero-ts loadable without `'unsafe-eval'`) | `tests/content-security-policy.test.ts`, `tests/image-fallback.test.ts`, `tests/xss-regression.test.ts`, `tests/secret-logging.test.ts`, `tests/monero-ts-csp.test.ts` |
| QR device pairing crypto and relay transport | `src/signer/pairing.ts` | `src/nostr/device-pairing.ts`, `relay/write-policy.mjs`, `docs/device-pairing-architecture.md` | `tests/pairing.test.ts`, `tests/pairing-relay.integration.test.ts` |
| QR device pairing screens and camera | `src/app/device-pairing-controller.ts` | `src/features/identity/pairing-view.ts`, `src/app/qr-scanner.ts`, `src/app/identity-controller.ts` | `tests/device-pairing-controller.test.ts` |
| Catalog/library actions and cache, and the library following the catalog | `src/app/catalog-controller.ts` | `src/nostr/canon.ts`, `src/nostr/library-updates.ts`, `src/nostr/programImport.ts`, `src/db/store.ts` | `tests/discover.test.ts`, `tests/library-updates.test.ts`, `tests/programImport.test.ts`, browser verification |
| Preferences, recovery, history actions, and backup controls | `src/app/preferences-controller.ts` | `src/db/export.ts`, recovery modules | feature tests, `tests/export.test.ts` |
| Deleting what a Lightning build left on a device | `src/db/retire-lightning.ts`, `src/db/store.ts` (`retireLightningSettings`) | `src/app/shell.ts` (boot, `loadNamespace`) | `tests/retire-lightning.test.ts`, `tests/store.test.ts` |
| Stored/live session adaptation | `src/app/session-persistence.ts` | `src/db/store.ts`, `src/app/state.ts` | `tests/session-runner.test.ts`, `tests/store.test.ts` |
| Catalog surfaces: what a relay answer is written into, and when nothing is | `src/app/catalog-surfaces.ts` | `src/app/catalog-controller.ts`, `src/features/discover/views.ts` (`discoverGrid`) | `tests/shell.test.ts`, `tests/discover.test.ts` |
| The account chip, and writing an arriving profile into the read-only Profile card | `src/app/account-chip.ts` | `src/app/layout.ts`, `src/app/shell.ts` (profile hydration) | `tests/account-chip.test.ts`, `tests/shell.test.ts` |
| The Settings Profile editor (#277): avatar, display name and public Monero address as one card, one Save changes publishing only the changed events, partial-failure retry, Refresh profile, and the local-only state | `src/app/profile-controller.ts` (load, edit, upload, save, refresh), `src/app/profile-view.ts` (markup), `src/app/profile-editor.ts` (draft, dirty state per event, validation) | `src/nostr/profile-metadata.ts`, `src/nostr/media-upload.ts`, `src/app/monero-address-controller.ts` (`publish`, `refresh`), `src/app/shell.ts` | `tests/profile-controller.test.ts`, `tests/profile-editor.test.ts`, `tests/settings-view.test.ts`, `tests/account-chip.test.ts` |
| Writing the user's own `kind:0` without erasing fields other clients own | `src/nostr/profile-metadata.ts` | `src/nostr/replaceable-event.ts`, `src/nostr/profile.ts` (display-only read and cache) | `tests/profile-metadata.test.ts` |
| Profile photo upload: NIP-96 discovery, NIP-98 authorization, response parsing | `src/nostr/media-upload.ts` | `src/signer/types.ts` | `tests/media-upload.test.ts` |
| Reading and publishing the user's own replaceable events: "nobody answered" versus "no event", and relay acknowledgement | `src/nostr/replaceable-event.ts` | `src/nostr/profile-metadata.ts`, `src/nostr/payment-targets.ts` | `tests/replaceable-event.test.ts`, `tests/payment-targets.test.ts` |
| The persistent frame, top-level navigation and page markup | `src/app/layout.ts` (`shellFrame`, `appView`, `pageOverlays`, `updateNavigation`) | relevant `src/features/*/views.ts` | feature view tests, `tests/shell.test.ts` |
| Redrawing the page: what made it happen, and keeping the reader's place | `src/app/root-rebuild.ts`, `src/app/scroll.ts` | `src/app/shell.ts` (`render`), the `.content` pane in `src/app/layout.ts` | `tests/root-rebuild.test.ts`, `tests/scroll.test.ts`, `tests/render-budget.test.ts` |
| How much the app redraws, and what a background answer may never replace | `tests/render-budget.test.ts` | every surface writer below | `tests/render-budget.test.ts` |
| Writing a grid of cards without rebuilding the ones that did not change | `src/app/card-grid.ts` | `src/app/catalog-surfaces.ts`, `src/app/browse-surfaces.ts`, `src/features/discover/views.ts` (`discoverCards`), `src/features/library/views.ts` (`libraryCards`) | `tests/card-grid.test.ts`, `tests/render-budget.test.ts` |
| The account choice screen: create vs. restore, and the order the routes are offered in | `src/app/account-choice-view.ts` | `src/app/identity-controller.ts` (`startAccountChoice` binds every row) | `tests/account-choice-view.test.ts`, `tests/shell.test.ts` |
| The Settings page: which cards exist, the groups they sit in, and their order | `src/app/settings-view.ts` | every settings card below, `src/app/layout.ts` (`appView`) | `tests/settings-view.test.ts`, `tests/shell.test.ts` |
| Settings surfaces written in place rather than rerendered - a background answer, or the reader's own preference change | `src/app/profile-controller.ts` (`repaint`), `src/features/backup/views.ts` (`updateBackupStatus`, `updateBackupCard`), `src/app/settings-view.ts` (`updateTrainingPreferences`) | `src/app/preferences-controller.ts`, `src/app/backup-controller.ts`, `src/app/shell.ts` (`bindBackupCard`), `src/app/tip-jar-controller.ts` (the Tip Jar switch) | `tests/backup-views.test.ts`, `tests/settings-view.test.ts`, `tests/shell.test.ts`, `tests/render-budget.test.ts` |
| Shared UI formatting/filtering | `src/app/format.ts` | `src/core/equipment.ts`, `src/core/units.ts` | `tests/format.test.ts`, `tests/equipment.test.ts`, `tests/units.test.ts` |
| Shared taxonomy: Level, Movement type, Equipment, and the labels filters show | `src/core/training-taxonomy.ts`, `src/core/equipment.ts` | `src/app/format.ts` (exercise facets), `src/features/sheets/program-labels.ts` (`programTaxonomy`), `src/features/sheets/program-browser.ts` | `tests/training-taxonomy.test.ts`, `tests/equipment.test.ts`, `tests/exercise-browser.test.ts`, `tests/program-browser.test.ts` |
| Responsive image delivery for exercise photos | `src/core/media.ts` | `src/features/train/session-hero.ts`, `src/features/library/views.ts`, `src/features/discover/views.ts`, `src/features/sheets/builder-views.ts`, `src/app/catalog-controller.ts` | `tests/media.test.ts`, `tests/session-runner.test.ts` |
| Shared domain types, IDs, and muscle vocabulary | `src/core/types.ts`, `src/core/ids.ts`, `src/core/muscles.ts` | consuming feature and persistence modules | relevant feature tests |
| Programs and program builder | `src/app/program-builder.ts`, `src/app/program-publish-controller.ts`, `src/features/sheets/views.ts`, `src/features/sheets/builder-views.ts`, `src/features/sheets/program-labels.ts`, `src/features/sheets/program-actions.ts`, `src/features/sheets/beast-mode.ts` | `src/db/store.ts`, `src/nostr/programImport.ts`, `src/nostr/program-publish.ts`, `src/nostr/program-ownership.ts` (whether a program is the user's own publication, whether it has unpublished changes, and the load-time repair of a copy imported back beside its source) | `tests/sheets.test.ts`, `tests/program-ownership.test.ts`, `tests/sheets-views.test.ts`, `tests/beast-mode.test.ts`, `tests/program-builder.test.ts`, `tests/programImport.test.ts`, `tests/program-publish-controller.test.ts`, `tests/program-publish.test.ts`, browser verification |
| Programs/Discover browsing chrome: toolbar, filter chips, filter sheet | `src/features/sheets/program-browser.ts`, `src/app/program-browser-controller.ts` | `src/app/layout.ts`, `src/features/sheets/program-labels.ts` | `tests/program-browser.test.ts`, browser verification |
| Exercise browsing chrome: toolbar, filter chips, filter sheet, selection bar | `src/app/exercise-browser.ts`, `src/app/exercise-browser-controller.ts` | `src/app/format.ts`, `src/features/library/views.ts`, `src/features/discover/views.ts` | `tests/exercise-browser.test.ts`, `tests/equipment-views.test.ts`, browser verification |
| Writing a result region when a filter changes it, instead of the page | `src/app/browse-surfaces.ts`, `src/app/program-list-controller.ts` | `src/app/catalog-surfaces.ts`, `src/features/library/views.ts`, `src/features/discover/views.ts`, `src/app/layout.ts` | `tests/shell.test.ts`, browser verification |
| Live-session orchestration | `src/app/session-runner.ts` | the applicable controller/view below, `src/features/train/repeat-workout.ts` | `tests/session-runner.test.ts`, `tests/session-logic.test.ts` |
| Repeat a completed workout | `src/features/train/repeat-workout.ts` | `src/app/session-runner.ts`, `src/features/train/views.ts` | `tests/repeat-workout.test.ts`, `tests/session-runner.test.ts` |
| History release regressions (scale, JSON round trip, neighbouring features) | `tests/history-qa.test.ts` | `docs/RELEASE-QA.md` | `tests/history-qa.test.ts` |
| Relay write policy (server-side, not the browser) | `relay/write-policy.mjs` | `relay/README.md`, `docs/plans/v2-encrypted-backup-alpha.md` | `tests/write-policy.test.ts` |
| Standard live workout | `src/features/train/standard-session-controller.ts` | `standard-session-view.ts`, `rest-timer.ts`, `session-logic.ts` | `tests/session-runner.test.ts`, `tests/session-logic.test.ts` |
| EMOM live workout | `src/features/train/emom-session-controller.ts` | `emom-session-view.ts`, `emom.ts`, `emom-clock.ts`, `session-logic.ts`, `src/core/emom-blocks.ts` (a section's length, shared with program cards and the builder) | `tests/emom.test.ts`, `tests/emom-clock.test.ts`, `tests/session-runner.test.ts` |
| Rest timer and countdown audio | `src/features/train/rest-timer.ts`, `countdown-audio.ts` | `session-logic.ts` | `tests/countdown-audio.test.ts`, `tests/session-logic.test.ts` |
| Finish/review and publish-session coordination | `src/features/train/session-summary.ts` | `src/nostr/share.ts`, `src/app/session-runner.ts` | `tests/session-runner.test.ts`, `tests/share.test.ts` |
| Workout History | `src/features/train/history-timeline.ts` | `src/features/train/history-calendar.ts`, `src/features/train/history-model.ts`, `src/features/train/repeat-workout.ts`, `src/features/train/views.ts`, `src/core/dates.ts`, `src/app/preferences-controller.ts`, `src/app/session-persistence.ts`, `src/app/state.ts` | `tests/history-timeline.test.ts`, `tests/history-calendar.test.ts`, `tests/history-model.test.ts`, `tests/dates.test.ts` |
| Local calendar dates and consistency math | `src/core/dates.ts` | `src/features/train/history-model.ts`, `src/features/progress/stats.ts` | `tests/dates.test.ts`, `tests/history-model.test.ts` |
| Training statistics and PRs | `src/features/progress/stats.ts` | `src/features/progress/views.ts` | `tests/stats.test.ts`, `tests/progress-views.test.ts` |
| Body-weight UI and calculations | `src/features/progress/views.ts` | `src/db/store.ts`, `src/core/units.ts` | `tests/progress-views.test.ts`, `tests/store.test.ts` |
| Recovery calculation and body map | `src/features/recovery/recovery.ts` | `views.ts`, `src/app/bodymap.ts`, `src/core/muscles.ts` | `tests/recovery.test.ts` |
| Quick Workout generation | `src/features/recovery/quickWorkout.ts` | recovery module, `src/app/preferences-controller.ts` | `tests/recovery.test.ts`, relevant shell/session tests |
| Exercise cards shared by Library and Discover: photo, name, muscle and level line | `src/app/exercise-card.ts` | `src/features/library/views.ts`, `src/features/discover/views.ts` | `tests/exercise-cards.test.ts` |
| Exercise library UI | `src/features/library/views.ts` | shell library handlers, `src/app/format.ts`, `src/db/store.ts` | `tests/equipment-views.test.ts`, `tests/shell.test.ts`, `tests/store.test.ts` |
| Discover exercise/program UI | `src/features/discover/views.ts` | `src/nostr/canon.ts`, `programImport.ts`, shell import handlers | `tests/discover.test.ts`, `tests/canon.test.ts`, `tests/programImport.test.ts` |
| Catalog event parsing/fetch/cache | `src/nostr/canon.ts`, `src/nostr/creator-programs.ts` | `src/nostr/pool.ts`, `src/core/types.ts` | `tests/canon.test.ts` |
| Isolated browser smoke verification | `src/app/isolated-browser-smoke.ts`, `src/browser-smoke.ts`, `scripts/browser-smoke.mjs` | `vite.smoke.config.ts`, `smoke.html`, `src/app/program-publish-controller.ts` | `tests/isolated-browser-smoke.test.ts`, `tests/program-publish-controller.test.ts` |
| Workstr account local keys | `src/signer/local-key.ts` | `src/signer/types.ts`, `src/security/device-vault.ts` | `tests/local-key-signer.test.ts`, shell/share tests use fakes |
| Workout-summary and creator-program event publishing | `src/nostr/share.ts`, `src/nostr/program-publish.ts`, `src/nostr/program-delete.ts` | `src/features/train/session-summary.ts`, `src/nostr/secret-redaction.ts`, signer contract | `tests/share.test.ts`, `tests/program-publish.test.ts`, `tests/program-delete.test.ts`, `tests/secret-redaction.test.ts` |
| NIP-A3 Monero payment targets (`kind:10133`) | `src/nostr/payment-targets.ts` | `src/nostr/pool.ts`, `src/signer/types.ts` | `tests/payment-targets.test.ts` |
| Monero wallet phase-1 spike, phase-2 wallet core, and Settings wallet UI (#246): runtime import, node reachability, lazy wallet runtime, per-account vault storage (`monero.hot-wallet.<pubkey>` seed bundle, `monero.hot-wallet-data.<pubkey>` keys/scan cache, adopting the legacy device-wide `monero.hot-wallet` only on request), mock stagenet wallet, and QA evidence | `src/features/monero/wallet-node.ts`, `src/features/monero/wallet-runtime.ts`, `src/features/monero/wallet-core.ts`, `src/features/monero/wallet-storage.ts`, `src/features/monero/wallet-view.ts`, `src/features/monero/wallet-spike.ts`, `src/features/monero/mock-stagenet-wallet.ts`, `src/features/monero/phase1-report.ts`, `src/features/monero/types.ts` | `src/app/monero-wallet-controller.ts`, `src/app/settings-view.ts`, `src/app/shell.ts`, `src/monero-spike.ts`, `monero-spike.html`, `vite.monero-spike.config.ts`, `scripts/monero-spike-browser.mjs`, `docs/monero-wallet-phase1.md`, `docs/monero-wallet-phase2-core.md`, `docs/monero-wallet-phase3-settings-ui.md`, `docs/monero-ios-qa-checklist.md`, `docs/monero-rpc-browser-bridge.md`, `src/security/device-vault.ts`, `src/shims/node-assert.ts` | `tests/monero-wallet-spike.test.ts`, `tests/monero-wallet-core.test.ts`, `tests/monero-wallet-controller.test.ts`, `tests/monero-worker-asset.test.ts`, `tests/browser-assert-shim.test.ts`, `tests/settings-view.test.ts`, `npm run spike:monero:browser` |
| Monero Tip on Discover program cards, and the piggy-bank icon it shares with the Tip Jar (#267) | `src/features/sheets/monero-tip-view.ts`, `src/app/monero-tip-controller.ts`, `src/app/piggy-bank.ts` (`PIGGY_BANK`, `tipPiggyIcon`) | `src/nostr/payment-targets.ts`, `src/app/catalog-controller.ts`, `src/features/sheets/views.ts`, `src/style.css` | `tests/monero-tip-controller.test.ts`, `tests/discover.test.ts` |
| Tip Jar (#257, #260, #266, #268): the bottom-nav piggy bank with its live sync ring and state label, the Tip Jar page and its Receive panel, the on/off switch shared by Settings and the page, and automatic wallet sync | `src/features/monero/tip-jar-state.ts` (`tipJarStatus`, the one wallet-state-to-visual mapping, `tipJarNavLabel`, and the ring's two progress rules: `blockSyncFraction` for the current catch-up session and `syncFraction` for a saved position), `src/features/monero/tip-jar-view.ts`, `src/app/tip-jar-controller.ts` | `src/app/layout.ts` (nav item, `appView`), `src/app/monero-wallet-controller.ts` (`autoSync`, `stop`), `src/app/shell.ts`, `src/app/account-chip.ts` (carries no payment mark), `src/app/piggy-bank.ts`, `src/app/monero-mark.ts` (`moneroQr`), `src/style.css` | `tests/tip-jar.test.ts`, `tests/tip-jar-controller.test.ts`, `tests/account-chip.test.ts`, `tests/shell.test.ts` |
| Sending from the Tip Jar (#246 phase 5): the send sheet (amount, review with fee and total, explicit confirm, result), creator tips from program cards, and plain sends from the Tip Jar page | `src/features/monero/wallet-send.ts` (readiness, amount parsing, network address check, error wording), `src/features/monero/send-view.ts`, `src/app/monero-send-controller.ts` | `src/features/monero/wallet-core.ts` (`prepareTransfer`, `relayTransfer`), `src/app/monero-tip-controller.ts` (`sendTip`), `src/app/tip-jar-controller.ts` (`#tip-jar-send`), `src/features/monero/tip-jar-view.ts`, `src/app/tip-jar-activity-controller.ts` (`recordOutgoing`), `src/app/shell.ts`, `src/style.css` | `tests/monero-send.test.ts`, `tests/monero-wallet-core.test.ts`, `tests/tip-jar.test.ts` |
| Tip Jar activity (#263): the Recent activity card, outgoing-tip metadata joined to wallet transactions by txid, creator name and picture resolution, and its vault storage (`monero.tip-jar-activity.<pubkey>`) | `src/features/monero/tip-jar-history.ts` (model, txid join, resolution, storage), `src/features/monero/tip-jar-history-view.ts`, `src/app/tip-jar-activity-controller.ts` | `src/features/monero/wallet-core.ts` (`transactions`, `storedWalletId`), `src/app/monero-wallet-controller.ts` (`onActivity`), `src/features/monero/wallet-backup.ts` (`activity`), `src/app/tip-jar-backup-controller.ts`, `src/app/shell.ts`, `src/style.css` | `tests/tip-jar-activity.test.ts`, `tests/tip-jar.test.ts`, `tests/monero-wallet-core.test.ts` |
| Tip Jar backup (#261): the encrypted `.wstrwallet` file, its export/restore controls in Data & Sync, and Advanced recovery (recovery phrase, restore height, seed restore) | `src/features/monero/wallet-backup.ts` (format, Argon2id + AES-GCM, validation), `src/features/monero/wallet-backup-view.ts`, `src/app/tip-jar-backup-controller.ts` | `src/features/backup/views.ts` (hosts the section), `src/app/backup-controller.ts`, `src/app/settings-view.ts`, `src/app/shell.ts`, `src/app/monero-wallet-controller.ts` (`backupPayload`, `restore`), `src/security/device-vault-kdf.ts`, `src/style.css` | `tests/tip-jar-backup.test.ts`, `tests/backup-views.test.ts`, `tests/settings-view.test.ts` |
| The Tip Jar switch in Settings, and reading and publishing the user's public Monero address | `src/features/support/payment-mode-views.ts`, `src/app/monero-address-controller.ts` | `src/nostr/payment-targets.ts`, `src/app/settings-view.ts`, `src/app/tip-jar-controller.ts` (the switch handler), `src/app/profile-controller.ts` (the only editor of the address) | `tests/monero-address-controller.test.ts`, `tests/settings-view.test.ts`, `tests/shell.test.ts` |
| Support Workstr | `src/features/support/views.ts` | `src/core/funding.ts`, `src/app/monero-mark.ts`, `src/nostr/payment-targets.ts`, `src/app/settings-view.ts` | `tests/support-views.test.ts`, `tests/settings-view.test.ts` |
| IndexedDB schema | `src/db/schema.ts` | `src/core/types.ts`, `src/db/store.ts` | `tests/store.test.ts`, `tests/export.test.ts`, `tests/adopt.test.ts` |
| IndexedDB repository operations | `src/db/store.ts` | schema and domain types | `tests/store.test.ts` |
| Anonymous/signed-in namespace adoption | `src/db/adopt.ts` | schema, shell sign-in flow | `tests/adopt.test.ts`, `tests/shell.test.ts` |
| JSON backup and restore | `src/db/export.ts` | schema, store, Settings handlers | `tests/export.test.ts` |
| Starter seed | `src/db/seed.ts`, `src/data/seed-events.json` | catalog codecs, program import, generation script | `tests/seed.test.ts` |
| PWA registration/offline cache | `src/app/pwa.ts`, `public/sw.js` | manifest and Vite build output behavior | production-build browser validation |
| Build/version/deployment | `vite.config.ts`, `src/app/version.ts` | Pages/release workflows | `npm run build`; workflow checks |
| Encrypted sync: record shapes and V2 addresses | `src/sync/records.ts`, `src/sync/addresses.ts` | `src/nostr/codecs30078.ts`, `docs/encrypted-sync-architecture.md` | `tests/codecs30078.test.ts`, `tests/sync-backfill.test.ts` |
| Encrypted sync: authenticated envelope (binary header, gzip, AES-GCM) | `src/nostr/envelope.ts` | `src/nostr/codecs30078.ts` | `tests/envelope.test.ts` |
| Encrypted sync: account backup key (wrap, unwrap, cache) | `src/nostr/backup-key.ts` | `src/signer/types.ts`, `src/sync/relay.ts` | `tests/backup-key.test.ts` |
| Encrypted sync: append-only chunk log (pack, replay, compaction) | `src/sync/chunks.ts` | `src/sync/addresses.ts`, `src/nostr/envelope.ts` | `tests/chunks.test.ts` |
| Encrypted sync: publishing the journal (tail, sealing, compaction) | `src/sync/journal.ts` | `src/sync/chunks.ts`, `src/db/sync-store.ts` | `tests/sync-journal.test.ts` |
| Encrypted sync: object queue and first-run setup | `src/sync/backfill.ts` | `src/db/store.ts` (change listener, `sync_queue`) | `tests/sync-backfill.test.ts` |
| Encrypted sync: relay transport and upload | `src/sync/relay.ts`, `src/sync/push.ts` | `src/nostr/codecs30078.ts`, `relay/write-policy.mjs` | `tests/sync-push.test.ts`, `tests/sync-relay.integration.test.ts` (opt-in, needs `WORKSTR_TEST_RELAY`) |
| Encrypted sync: pull, decrypt and merge | `src/sync/merge.ts` | `src/sync/relay.ts`, `src/db/store.ts` (`applyRemote`, `sync_seen`) | `tests/sync-merge.test.ts`, `tests/sync-pull.test.ts`, `tests/sync-relay.integration.test.ts` (opt-in) |
| Encrypted sync: orchestration and retry | `src/sync/engine.ts`, `src/sync/retry.ts`, `src/sync/key-repair.ts` | `src/sync/backfill.ts`, `src/sync/push.ts`, `src/sync/merge.ts` | `tests/sync-engine.test.ts` |
| Signer call timeouts | `src/signer/timeout.ts`, `src/signer/auto-approve.ts` | `src/signer/types.ts`, `src/sync/engine.ts` | `tests/signer-timeout.test.ts` |
| Encrypted sync controls, inline Data & Sync panels, and status | `src/features/backup/views.ts`, `src/app/backup-controller.ts` | `src/sync/engine.ts`, `src/app/layout.ts`, `src/features/monero/wallet-backup-view.ts` | `tests/backup-views.test.ts`, `tests/settings-view.test.ts`, `tests/tip-jar-backup.test.ts`, `tests/sync-engine.test.ts` |
| Sync-facing half of the store | `src/db/sync-store.ts` | `src/db/store.ts` (extends it) | `tests/sync-backfill.test.ts`, `tests/sync-merge.test.ts`, `tests/sync-pull.test.ts` |

## Important module groups

### App composition

- `src/app/shell.ts` initializes state and namespaces, mounts the shell, renders pages,
  binds global navigation, and composes focused controllers. Feature-specific workflows
  live behind controller interfaces and the shell is below the 400-line target. Boot calls
  `mount()` once - it writes the frame from `shellFrame` and binds the frame's own
  listeners in `bindFrame()`, which is why clicking a nav item after twenty renders still
  fires one handler. Every render after that is a page render: `#page-host` gets
  `appView(state)`, `#page-overlays` gets the sheets belonging to that page, page controls
  are rebound, and the navigation and account chip are patched rather than rebuilt. The
  topbar, avatar, `.content` pane, session overlay, modal host and toast are never touched
  by a render.
- `src/app/root-rebuild.ts` owns the one way a page is redrawn - the frame around it is
  mounted once and is not part of this - scroll-preserving through `src/app/scroll.ts`. It
  used to refuse to run at all while a workout was live, because a rebuild of the whole root
  took away the reps and load typed into the current set and reset a running rest countdown.
  A render writes the page host now and the overlay is not in it, so the hold is gone and
  the session is safe by construction rather than by waiting. It also counts renders: every
  one passes through here, so `createRenderTrace` is the only place that can say how many a
  cold start costs and what asked for each one. The count is on the shell handle as
  `renders`; the reasons reach a dev console and are stripped from a production build.
  `tests/render-budget.test.ts` asserts that count and the identities a background answer
  must not replace - it is the regression floor for #178, not a performance benchmark.
- `src/app/card-grid.ts` writes a keyed grid: a card whose markup has not changed keeps its
  node, and with it the exercise photo already painted. Scoping a catalog answer to the grid
  stopped the page being rebuilt, but writing the grid with one `innerHTML` still destroyed
  every card in it. Note it parses every card before comparing - a node the parser has
  serialised and the template it came from are not the same string, and comparing them raw
  finds every card changed and preserves nothing.
- `src/app/browse-surfaces.ts` writes the surfaces a filter changes and nothing else: the
  Library grid and its empty line, the Discover grid, a program list, the selection bar's
  labels and counts, and the open filter sheet's option states and match count. The sheets
  and the bar are patched rather than rendered again, so the control that was tapped is
  still the focused element afterwards - which is why no handler restores focus any more.
- `src/app/program-list-controller.ts` owns the two program lists: every action a program
  card offers, and writing a list when a filter changes what belongs in it. Card bindings
  are scoped rather than delegated, so a freshly written list binds its own cards without
  doubling a listener on one that was already there; the exercise grids delegate instead,
  because they carry one action per card and these carry nine.
- `src/app/program-builder.ts` owns program-builder modal state, exercise selection,
  normal/superset and EMOM prescriptions, row ordering, validation, and persistence.
- `src/app/program-publish-controller.ts` owns Beast Mode local program publish
  execution through the active signer and configured public relays, and Delete from relays:
  a NIP-09 request built by `src/nostr/program-delete.ts`, after which the program leaves
  Discover and the catalog snapshot and any linked local program becomes local-only.
- `src/app/isolated-browser-smoke.ts` owns the production-build browser-smoke
  composition: an in-memory signer/publisher and an empty relay list that fail
  closed before any creator-program public transport is reachable.
- `src/browser-smoke.ts` is the `/smoke.html` entrypoint; `src/app/shell-types.ts`
  carries its narrow shell composition contract. `npm run smoke:browser` builds
  these entries and drives the isolated page with Playwright.
- `src/features/sheets/builder-views.ts` renders the builder's row and EMOM-section
  markup from `BuilderState`. It is pure markup; all builder state lives in the
  controller above.
- `programCard` in `src/features/sheets/views.ts` draws the collapsed program card shared by
  Programs and Discover: the map, the title, a byline (creator - Workstr for the official
  catalog - then the level and, in Discover, the Monero Tip), the duration and format line, and
  one goal and focus line from `programSummary` in `src/features/sheets/program-labels.ts`. No
  badges or pills; the only status it shows is Unpublished changes.
- `src/features/sheets/program-actions.ts` renders a program card's expanded
  Start/Publish/Edit/Delete or Import/Update actions. The user's own publication reads
  Published or Unpublished changes (Publish update) in Programs and Yours in Discover; the
  state compares `creatorProgramFingerprint` from `src/nostr/program-publish.ts` with the
  fingerprint stored when the publish landed. The card's only payment action, the Monero Tip, comes
  from `src/features/sheets/monero-tip-view.ts`.
- `src/features/sheets/beast-mode.ts` owns the objective local Beast Mode eligibility
  helper, compact Settings category summary, and reusable Settings and locked-Publish
  checklist markup.
- `src/app/catalog-controller.ts` owns catalog refresh/cache/profile loading and local
  library import, update, deletion, favorite, and detail actions.
- `src/app/identity-controller.ts` owns Workstr account creation/restore, adoption choices, sign-out,
  and device pairing. A local key it creates, restores or receives by pairing is handed to the
  device vault controller and signed in only once it is stored.
- `src/app/device-vault-controller.ts` owns the device vault's user flows: `prepareBoot`
  decides whether launch shows the lock screen, Protect this device, or nothing;
  `protectLocalAccount` is the only route a local Nostr key takes into storage; and it binds
  Settings → Device security. The lock screen is `#vault-lock`, a layer above the frame and
  the modal written by `shellFrame`. While it is up the account is not opened, so no store,
  local signer or sync exists. `src/security/device-vault.ts` holds the session; the
  controller never keeps a code.
- `src/app/preferences-controller.ts` owns settings persistence, body/history actions,
  backup controls, and Quick Workout/recovery handlers.
- `src/app/monero-address-controller.ts` owns the current user's public NIP-A3 Monero
  address as a service with no screen of its own: the `kind:10133` lookup, validation, and
  `publish` (an empty address clears only the Monero target). It never writes the address to
  the database, so the relays stay the only source of truth and nothing about it enters
  encrypted sync. It reads the address on the first Settings visit whether or not the Tip Jar
  is on, because an address left published after tips are switched off must stay removable.
- `src/app/profile-controller.ts` owns the Settings Profile editor. It shows the avatar,
  display name, npub and Monero address as one card, and on Save changes publishes `kind:0`
  only when the name or picture changed and `kind:10133` (through the address controller) only
  when the address changed. Each lands independently: whichever succeeded becomes the new
  baseline, so a retry never republishes it. It refuses to write `kind:0` until the complete
  event has been read. A chosen photo is uploaded (`src/nostr/media-upload.ts`) into the draft
  and published only with Save changes. The card is repainted in place, never rendered.
- Settings order is Profile, Training, Payments, Access & Security, Support, System & Data.
  Access & Security holds Add device, Sign out, Remove local data (set apart as destructive)
  and the Device security card; it does not repeat the avatar or name.
- `src/app/piggy-bank.ts` owns the Tip Jar's piggy bank: the one `PIGGY_BANK` path, drawn by the
  bottom-nav item and by an incoming activity row, and `tipPiggyIcon`, the same pig with a plus
  on its back for a Tip control. It sits in `app/` because the nav and activity draw it from
  `features/monero` and the program card's Tip draws it from `features/sheets`, and features do
  not import each other. The plus is why the program card no longer shows a Monero mark: the
  button's job is to say "add to this creator's Tip Jar", not which rail carries it (#267).
- `src/app/monero-mark.ts` owns the vendored Monero mark, the badge, and `moneroQr`, the
  payment code with the Monero symbol knocked into its middle. It lives in `app/` because the
  creator tip sheet and the Monero support card both draw it and features do not import
  each other. The mark and badge are monochrome and take `currentColor`: they identify the
  payment mechanism, never Workstr itself. What sits inside a code is not that mark but
  `src/assets/monero-symbol.png`, the Monero project's own symbol from its press kit
  (https://www.getmonero.org/press-kit/) - resized and palette-optimised, nothing else - bundled
  so a code draws offline and small enough that Vite inlines it (#268). A receive code is the one
  surface where the reader is looking at a Monero destination, so the network's own mark belongs
  there and nowhere else in the shell.
- `src/features/sheets/monero-tip-view.ts` owns the program-card Tip button, whether an author can
  be tipped at all, and the creator-address helper. `moneroMode(state)` is the single answer to
  "are Monero tips on" for the sheets feature. It renders no total and no status, because a
  Monero transfer leaves nothing Workstr can read.
- `src/app/monero-tip-controller.ts` owns the program-card Tip. It resolves the creator's NIP-A3
  address and always starts the Workstr Tip Jar flow through `sendTip`: ready wallets open the
  amount sheet, while not-ready wallets show native enable, setup, unlock, sync or Add funds
  states. It never shows a creator QR, copy-address action or `monero:` external-wallet link.
  The address is consumed internally as the transaction destination.
- `src/features/monero/wallet-send.ts` decides whether a send may start (`sendReadiness`: Tip
  Jar on, signed in, unlocked, wallet open and synchronized, spendable XMR) and turns amounts
  into atomic units without floating point. `src/app/monero-send-controller.ts` drives the send
  sheet drawn by `send-view.ts`: `prepareTransfer` signs on this device with `relay: false` so
  the real fee is shown, and only an explicit confirm calls `relayTransfer`. There is no
  automatic retry: a broadcast that fails with an unknown outcome ends in a "not confirmed"
  state with no way to resend, because the node may already have taken it. After a broadcast
  the txid, creator pubkey and program go to `recordOutgoing` for Recent activity.
- `src/features/monero/tip-jar-state.ts` is the single answer to "what state is the Tip
  Jar in": off, connecting, syncing (with progress), ready, or error. The nav badge, the page
  status word and the spoken label all read it. "Tip Jar" is the user-facing name only; the
  setting stays `paymentMode` and the code keeps its `monero` names. `tipJarNavLabel` collapses
  those five states to the three words the nav can say: Tip Jar, Syncing, Offline.
  `tip-jar-view.ts` draws the nav icon and the page, and patches both in place
  (`updateTipJarNav`, `updateTipJarPage`) so a sync tick never renders the page. The icon is a
  piggy bank taking the nav colour with a progress ring drawn behind it, and nothing else:
  #260 removed the Monero badge here and the payment medallion from the account chip, so the
  ring is the only orange in the app shell and only while a sync runs. What the ring measures is
  the current catch-up session - `blockSyncFraction`, from the height this sync started at to the
  daemon tip it is heading for, which `monero-wallet-controller.ts` fixes on the first progress
  report and keeps for the rest of the sync. The wallet's place on the chain
  (`syncFraction`, height over daemon height) is only the opening hint, because a wallet a
  thousand blocks behind a three-million-block chain is 99.97% along it and nowhere near caught
  up (#266). Until scanning starts the icon is `data-live="off"` and the ring stays the faint
  track, and the runtime's own percentage is the fallback for a runtime that reports no useful
  heights. Raw block heights stay in the Settings wallet card's diagnostics. The page is balance, Receive, Send and Recent
  activity; whether tips reach this wallet and the backup live in Settings (#263). Receive is the
  code, one shortened line of address with a copy glyph, Copy address, and one line of help; both
  copy controls carry the whole address however little of it the row shows (#268).
- `src/features/monero/tip-jar-history.ts` owns Tip Jar activity: the wallet reports each
  transaction (amount, direction, state, time) and is the source of truth for it; Workstr adds
  only what the chain cannot say, the recipient's Nostr pubkey and the program, recorded once a
  send has been broadcast (`outgoingTipRecord`). The two are joined by txid, never by address.
  Incoming records carry no sender fields at all. Names and pictures resolve current profile,
  then `profileNames`, then the snapshot taken at send time, then the short pubkey. Records are
  kept per account and per wallet id in the device vault, never in IndexedDB app stores, so the
  training JSON export cannot see them; outgoing metadata travels only inside the encrypted
  `.wstrwallet` backup. `tip-jar-history-view.ts` renders the card and patches it in place, and
  `src/app/tip-jar-activity-controller.ts` loads, joins, records and fetches missing creator
  profiles. `recordOutgoing` is called by the send controller once a broadcast has returned
  its txid, never before.
- `src/features/monero/wallet-backup.ts` owns the Tip Jar's portable backup and nothing else:
  it turns a stored wallet bundle into the fields a restore needs, seals them under the user's
  password (Argon2id at the device-vault parameters, then AES-GCM with the type, version and
  network as authenticated data), and validates a file before a password is ever asked for. It
  touches no network, vault or DOM. The private spend and view keys, the node configuration and
  the vault scope are deliberately left out: they describe the device, not the wallet. This is
  a separate artifact from `src/db/export.ts` on purpose - the JSON export carries training
  data and is handed around freely, this file carries spend authority.
  `wallet-backup-view.ts` renders the Data & Sync section and Advanced recovery, and
  `src/app/tip-jar-backup-controller.ts` owns the export, restore and reveal flows, patching
  the section in place. The recovery phrase is not in the document until it is revealed, and a
  restore that would replace a stored wallet is confirmed first.
- `src/app/tip-jar-controller.ts` owns turning the Tip Jar on and off from either surface,
  the page's delegated actions, and `applyPaymentMode`. `monero-wallet-controller.ts` owns
  `autoSync`: while the Tip Jar is on, signed in and unlocked it opens the account's stored
  wallet, syncs it, and re-syncs every two minutes while the page is visible. It never
  creates, restores or overwrites a wallet.
- `src/features/support/payment-mode-views.ts` renders the Tip Jar settings card: a
  `role="switch"` checkbox and nothing else. The public address moved to the Profile card
  (#277), and the switch neither publishes nor removes it. The card is a `<section>`, not a
  `<details>`: one control, nothing to collapse. The stored setting keeps its `paymentMode` name, now `'off' | 'monero'`.
- `src/features/support/views.ts` owns the Support Workstr card: `supportPanel` renders the
  canonical `OPERATOR_MONERO_ADDRESS` as an amount-free `monero:` QR, a shortened display,
  and a copy action. It does not follow the Monero tips switch, because supporting Workstr
  is not creator tipping, and it shows no funding meter, because a Monero transfer leaves
  nothing Workstr can count.
- `src/features/sheets/program-browser.ts` owns the search/filter/action toolbar above
  Programs and Discover, the active-filter chips, and the filter sheet. Both browsers share
  `state.programFilter` and `state.programFilters`; `state.programFilterSheet` only records
  which one has the sheet open. One exported `programMatcher(state)` filters both rendered
  lists and produces the sheet's "Show N" count, so the number and the list cannot disagree.
  Each filter reads its own source through `programTaxonomy` in
  `src/features/sheets/program-labels.ts`: Goal only from the author's explicit tags, Level
  from the stated difficulty, Focus, Format and Equipment from the exercises and blocks.
  Equipment uses the same keys as the exercise facet and a saved kit.
  The sheet is rendered next to the modal in `shellMarkup`, not inside the page: `.content`
  is a fixed stacking context at z-index 1, so a sheet inside it cannot paint over the
  mobile bottom nav. `src/app/program-browser-controller.ts` owns its event bindings.
- The account pill in `src/app/layout.ts` carries a Monero-mark medallion and an orange
  perimeter on every view while Monero tips are on, and neither while they are off. It reads
  the setting and never sets it. The green connection badge on the avatar is a separate
  state and does not follow the switch.
- `src/app/exercise-browser.ts` owns the Library and Discover toolbar, chips, filter sheet
  and selection bar. It lives in `app/` rather than either feature because both features use
  it and a feature-to-feature import is not allowed. Unlike the program browser, the two
  exercise views keep **separate** filter state — Library in `state.filter` +
  `state.exFilter`, Discover in `state.discoverFilter` (whose `q` is its search, not a
  facet) — so every function takes the view as an argument and `state.exerciseFilterSheet`
  only records which one has the sheet open. `exerciseResults(view, state)` produces both
  the grid and the sheet's "Show N". Sheet options are derived from the exercises that view
  holds, and a selected value whose option has disappeared stays listed so the filter can
  still be undone. Favorites only is the Library-only `fav` facet, switched by the toolbar star
  rather than the sheet, so the chip, the badge count, Clear and Reset treat it like any other;
  Discover always reads it as off. `src/app/exercise-browser-controller.ts` owns its event bindings.
- `src/app/session-persistence.ts` adapts stored session rows into live/history state.
- `src/app/layout.ts` composes top-level pages from feature view functions. It owns the
  Settings category order and disclosure shell; backup, payment, support, and Beast Mode
  views render their category bodies and summaries. It does not persist data.
- `src/app/state.ts` defines render/session state and cross-feature session helpers.
- `src/app/session-runner.ts` creates a live session, selects standard versus EMOM
  controller, controls the overlay lifecycle, and delegates finish/publish behavior.
- `src/app/bodymap.ts` owns the reusable SVG body map and muscle-region painting.

### Live training seams

```text
app/session-runner.ts
  +-- train/standard-session-controller.ts -> standard-session-view.ts
  |                                      -> rest-timer.ts
  +-- train/emom-session-controller.ts     -> emom-session-view.ts
  |                                      -> emom.ts + emom-clock.ts
  +-- train/session-logic.ts                shared pure session timing/state rules
  +-- train/session-summary.ts              finish review and summary publishing
```

The coordinator supplies controllers with persistence/render callbacks; controllers do
not open IndexedDB directly. Keep frequent DOM updates inside the controllers/views.

### Persistence model

`src/db/schema.ts` currently creates these object stores:

- `exercises`
- `sheets` and `sheet_exercises`
- `sessions` and `session_sets`
- `bodyweight`
- `settings`
- `sync_queue`
- `sync_seen` (v4: which relay events this device has already read, so a pull decrypts
  only what is new)
- `blobs`
- `plan` (unused and scheduled for removal)

`WorkstrStore` is the normal persistence API. JSON export/import includes user/config
stores but deliberately excludes `blobs`, whose cached images are re-fetchable.
Namespace adoption copies the entire IndexedDB namespace, including blobs, while
preserving keys and cross-store references.

### Completed-session data flow

```text
Program snapshot + live set logging
              |
              v
   sessions + session_sets (IndexedDB)
              |
              v
     shell adapter -> ActiveSession[]
       |       |       |       |
       v       v       v       v
    History  Stats  Recovery  kind:1 summary
       |
       +---------------------> JSON export/import
```

The stored `Session.exercises` snapshot is deliberate. Do not rebuild historical names,
targets, or muscle metadata solely from the current exercise library.

### Catalog versus user data

- `src/nostr/canon.ts` accepts only valid operator events, parses exercises/programs,
  merges relay results, and maintains an offline catalog cache.
- `src/nostr/creator-programs.ts` also applies a temporary, exact-match suppression for the
  known browser-smoke creator-program fixture. Keep this guard narrow: it must not suppress
  other Beast Mode creators or their programs, and it can be removed once relay copies of the
  fixture are confirmed gone.
- Discover shows relay/catalog objects. Import copies them into IndexedDB.
- `src/nostr/programImport.ts` plans program dependency imports and detects new,
  already-imported, or update states.
- A locally edited imported or seeded program loses its catalog identity and becomes a
  local fork. Confirm this behavior in `WorkstrStore.saveSheet()` before changing it.

### Identity and network

- `src/signer/types.ts` is the common signing/encryption contract.
- `local-key.ts` owns Workstr account NSEC signup/restore and keeps that key on this device,
  stored only in the device vault under `nostr.local-key`. The generic `Signer` contract remains
  for Nostr features, but Workstr Web no longer ships NIP-07 or NIP-46 signer adapters.
- `src/security/` is the device vault: Argon2id from the device code wraps a random root
  key, HKDF derives one AES-GCM key per scope, and the unlocked session is a non-extractable
  WebCrypto key in memory. It knows no Nostr or Monero; modules name a scope.
- `src/nostr/share.ts` builds and publishes public workout summaries, requiring actual
  relay acknowledgement/verification before reporting success.
- `src/nostr/profile.ts` fetches kind-0 identity metadata across configured/default
  relays, retries transient failures, and maintains the per-browser public profile cache. It
  keeps a name and a picture only, so it is for display and never the start of a publish.
- `src/nostr/profile-metadata.ts` writes the user's own `kind:0`: it reads the complete
  event (rejecting when no relay answered), preserves every property, and changes only
  `display_name` and `picture`. `name` is never touched.
- `src/nostr/media-upload.ts` uploads a profile photo to a NIP-96 server (nostr.build by
  default), reading the API URL and size limit from its discovery document and authorizing
  with a NIP-98 event signed by the active signer. Only the returned URL enters `kind:0`.
- `src/nostr/secret-redaction.ts` redacts wallet connection strings, secret parameters,
  nsecs and bare 64-hex keys. `src/nostr/program-publish.ts` refuses to publish a program
  carrying any of them, and the publish controller redacts relay errors through it.
- `src/nostr/payment-targets.ts` reads and writes NIP-A3 `kind:10133` payment targets. It is
  Monero-only on purpose: Workstr pays on no other rail, so other `payto` targets are
  neither read nor dropped when the event is rewritten. It writes the canonical `monero`
  method and accepts the `xmr` alias when reading. The signed event is the only source of
  truth — the address is never written to encrypted sync or workout records, and
  `tests/payment-targets.test.ts` enforces that boundary.
  Reading tolerates relay failure (returns null, so cards still render); publishing does not,
  because writing a replaceable event without first reading it would drop the user's other
  `payto` targets.
- Local training must remain usable when every relay operation fails.

### Relay-side policy (not client code)

- `relay/write-policy.mjs` is the strfry write-policy plugin that runs on the relay host,
  not in the browser. It is plain JavaScript because the relay host has no build step;
  `relay/write-policy.d.mts` carries its type contract so the tests can import it.
- Policy: accept `kind:30078` whose first `d` tag starts with `workstr:v2:`, reject
  everything else. The relay is open — no allowlist, no NIP-42 — so this plugin is the
  only control over what the relay stores.
- It is stateless and per-event. Quotas, the storage ceiling, and the block list are
  separate stateful concerns and are not here.
- `relay/README.md` covers installation into `strfry.conf` and post-deploy verification.

## Styling and static assets

- `src/style.css` contains Workstr Web-specific and live-runner overrides. Its last block is
  the Monero tips override.
- `src/workstr-reference.css` is imported design/reference CSS used by the app. Its `:root`
  block owns the theme tokens. Colour is expressed as channel tokens (`--accent-rgb` and
  friends, bare `R, G, B` triplets) so rules pick their own alpha via
  `rgba(var(--accent-rgb), .18)` while still resolving through one definition. Do not write
  theme colour literals in a rule; `tests/theme-tokens.test.ts` fails the build if you do.
- **Two theme layers, and they must stay apart.** `--accent-*`, `--surface-*`, `--void-*`,
  `--chrome-*`, `--text`/`--muted`/`--dim` and `--shadow` are the Workstr/Nostr app identity:
  purple, owned by `:root`, and identical in every payment mode. `--payment-rgb`,
  `--payment-accent`, `--payment-accent-strong` and `--on-payment` are the creator-support
  layer, and are the only tokens a payment mode may override. Purple means "this is Workstr";
  orange means "this is Monero payment" — never "this is selected". A creator-payment control
  reaches for `--payment-*`; everything else reaches for `--accent-*`. While Monero tips are
  off the payment tokens resolve to the Workstr accent, so a payment surface still on screen
  (Support Workstr, an address left published) is not orange.
- `public/workstr-reference.css` is a static public copy; confirm which copy a proposed
  change targets before editing both.
- `public/sw.js` is copied as-is into the production build.
- `dist/` is generated output and should not be edited manually.

## Documentation roles

- `MODULES.md`: current code ownership and routing (this file).
- `README.md`: short project entry point.
- `ROADMAP.md`: release sequence and known debt.
- `docs/instruction.md`: broad product/protocol specification, including future phases.
- `docs/plans/`: detailed plans for unshipped milestones.
- `docs/RELEASE-QA.md`: real-device release checklist.
- `docs/device-vault-architecture.md`: device code, vault format, security limits, recovery.
- `docs/security-model.md`: the Tip Jar as a hot wallet, the browser compromise boundary, the
  Content Security Policy and its `<meta>` limits, backups, secret logging.
- `relay/README.md`: relay-side write policy, its rationale, and how to deploy it.
- `CHANGELOG.md`: shipped and unreleased user-visible behavior.

Update this map when files move, responsibilities split, or the persistence/data flow
changes. A stale map costs more agent context than no map.

## Statistics date range

`src/features/progress/stats.ts` scopes Training statistics to a window. `getStats` takes a
`StatsRange` and filters on `sessionDayKey`, the same "which day was that?" answer History,
the calendar and the streak use, so a late-evening session lands in the range that shows it
in History.

Two populations, deliberately. Sessions, volume and muscle distribution follow the range.
**Personal records and the day streak do not**: a record scoped to four weeks would report a
lower number under a heading that still says "personal record", and a streak is a fact about
right now rather than about a window. Volume bars bucket weekly for 4W and 3M and monthly
beyond, because a year is 52 bars. `state.statsRange` is transient view state; the binding
lives in `src/app/preferences-controller.ts` beside the quick-workout duration.

## Tests may not reach the network

`tests/setup.ts` blocks every non-loopback WebSocket and `fetch`. Background relay work
started by `renderShell` is not awaited, so a socket opened during a test outlives it and
calls `render()` after the jsdom environment is gone — which failed runs at random with
`ReferenceError: document is not defined`, on whichever file happened to be running, with
every assertion passing. Naming each fetch in a `vi.mock` did not hold: the list fell behind
every new relay call.

A test that needs relay data mocks the module it calls, or injects a fake pool through the
`poolFactory` option `src/nostr/payment-targets.ts` and `src/nostr/program-publish.ts`
accept. Loopback is allowed so a test can stand up its own server. `tests/no-network.test.ts` asserts the guard itself.

## Automated drift check

Run `npm run modules` for the fast structural check or `npm run check` for the full
module/test/build validation. `scripts/check-modules.mjs` reads
`scripts/module-policy.json` and enforces only deterministic boundaries:

- every repository path written in backticks in this file must exist;
- modules over 400 lines must be within an explicit existing-debt baseline;
- a baseline module may not grow and must leave the baseline after shrinking to 400;
- feature directories may not directly import different feature directories;
- generic module buckets such as `utils.ts` are rejected.

Documentation coverage, likely test coverage, modules approaching 400 lines, and broad
import surfaces are warnings because those checks are heuristic. The script protects
this map from structural drift; it does not generate or replace the architectural
meaning in this file.
