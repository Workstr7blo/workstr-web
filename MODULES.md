# Workstr Web module map

Use this file to route a task to the smallest useful set of source and test files. It
describes the current repository, not future roadmap modules.

## Runtime path

```text
src/main.ts
  -> app/shell.ts          boot, state, handlers, persistence coordination
  -> app/layout.ts         top-level page and session-overlay markup
  -> app/session-runner.ts live-session coordinator
  -> features/*            feature calculations and view markup
  -> db/store.ts           IndexedDB operations
  -> nostr/* / signer/*    network and external signing boundaries
```

`renderShell()` owns the long-lived `AppState`. Most ordinary navigation rerenders the
root. Live-session controllers patch the session overlay directly where frequent timer
or set updates would make full-root rendering inappropriate.

## Route by concern

| Concern | Start here | Usually read next | Tests |
|---|---|---|---|
| Boot and application coordination | `src/main.ts`, `src/app/shell.ts` | `src/app/state.ts`, `src/app/layout.ts` | `tests/shell.test.ts` |
| Identity, signer connection, and adoption | `src/app/identity-controller.ts` | `src/signer/types.ts`, `src/db/adopt.ts` | `tests/shell.test.ts`, `tests/adopt.test.ts`, browser verification |
| Catalog/library actions and cache | `src/app/catalog-controller.ts` | `src/nostr/canon.ts`, `src/nostr/programImport.ts`, `src/db/store.ts` | `tests/discover.test.ts`, `tests/programImport.test.ts`, browser verification |
| Preferences, recovery, history actions, and backup controls | `src/app/preferences-controller.ts` | `src/db/export.ts`, recovery modules, `src/nostr/zaps.ts` | feature tests, `tests/export.test.ts`, browser verification |
| Stored/live session adaptation | `src/app/session-persistence.ts` | `src/db/store.ts`, `src/app/state.ts` | `tests/session-runner.test.ts`, `tests/store.test.ts` |
| Top-level navigation and page markup | `src/app/layout.ts` | relevant `src/features/*/views.ts` | feature view tests, `tests/shell.test.ts` |
| Shared UI formatting/filtering | `src/app/format.ts` | `src/core/equipment.ts`, `src/core/units.ts` | `tests/format.test.ts`, `tests/equipment.test.ts`, `tests/units.test.ts` |
| Shared domain types, IDs, and muscle vocabulary | `src/core/types.ts`, `src/core/ids.ts`, `src/core/muscles.ts` | consuming feature and persistence modules | relevant feature tests |
| Programs and program builder | `src/app/program-builder.ts`, `src/features/sheets/views.ts`, `src/features/sheets/builder-views.ts` | `src/db/store.ts`, `src/nostr/programImport.ts` | `tests/sheets.test.ts`, `tests/sheets-views.test.ts`, `tests/program-builder.test.ts`, `tests/programImport.test.ts`, browser verification |
| Live-session orchestration | `src/app/session-runner.ts` | the applicable controller/view below | `tests/session-runner.test.ts`, `tests/session-logic.test.ts` |
| Standard live workout | `src/features/train/standard-session-controller.ts` | `standard-session-view.ts`, `rest-timer.ts`, `session-logic.ts` | `tests/session-runner.test.ts`, `tests/session-logic.test.ts` |
| EMOM live workout | `src/features/train/emom-session-controller.ts` | `emom-session-view.ts`, `emom.ts`, `emom-clock.ts`, `session-logic.ts` | `tests/emom.test.ts`, `tests/emom-clock.test.ts`, `tests/session-runner.test.ts` |
| Rest timer and countdown audio | `src/features/train/rest-timer.ts`, `countdown-audio.ts` | `session-logic.ts` | `tests/countdown-audio.test.ts`, `tests/session-logic.test.ts` |
| Finish/review and publish-session coordination | `src/features/train/session-summary.ts` | `src/nostr/share.ts`, `src/app/session-runner.ts` | `tests/session-runner.test.ts`, `tests/share.test.ts` |
| Workout History | `src/features/train/views.ts` | `src/app/preferences-controller.ts`, `src/app/session-persistence.ts`, `src/app/state.ts` | currently covered indirectly by shell/session/stats tests; add focused history tests with history work |
| Training statistics and PRs | `src/features/progress/stats.ts` | `src/features/progress/views.ts` | `tests/stats.test.ts`, `tests/progress-views.test.ts` |
| Body-weight UI and calculations | `src/features/progress/views.ts` | `src/db/store.ts`, `src/core/units.ts` | `tests/progress-views.test.ts`, `tests/store.test.ts` |
| Recovery calculation and body map | `src/features/recovery/recovery.ts` | `views.ts`, `src/app/bodymap.ts`, `src/core/muscles.ts` | `tests/recovery.test.ts` |
| Quick Workout generation | `src/features/recovery/quickWorkout.ts` | recovery module, `src/app/preferences-controller.ts` | `tests/recovery.test.ts`, relevant shell/session tests |
| Exercise library UI | `src/features/library/views.ts` | shell library handlers, `src/app/format.ts`, `src/db/store.ts` | `tests/equipment-views.test.ts`, `tests/shell.test.ts`, `tests/store.test.ts` |
| Discover exercise/program UI | `src/features/discover/views.ts` | `src/nostr/canon.ts`, `programImport.ts`, shell import handlers | `tests/discover.test.ts`, `tests/canon.test.ts`, `tests/programImport.test.ts` |
| Catalog event parsing/fetch/cache | `src/nostr/canon.ts` | `src/nostr/pool.ts`, `src/core/types.ts` | `tests/canon.test.ts` |
| NIP-07 signing | `src/signer/nip07.ts` | `src/signer/types.ts` | shell/share tests use fakes |
| NIP-46 remote signing | `src/signer/nip46.ts` | `src/signer/types.ts`, shell sign-in flow | `tests/shell.test.ts` plus browser validation |
| Workout-summary event and relay publish | `src/nostr/share.ts` | `src/features/train/session-summary.ts`, signer contract | `tests/share.test.ts` |
| Zap receipts and support totals | `src/nostr/zaps.ts` | `src/core/funding.ts`, `src/features/support/views.ts` | `tests/zaps.test.ts`, `tests/support-views.test.ts` |
| IndexedDB schema | `src/db/schema.ts` | `src/core/types.ts`, `src/db/store.ts` | `tests/store.test.ts`, `tests/export.test.ts`, `tests/adopt.test.ts` |
| IndexedDB repository operations | `src/db/store.ts` | schema and domain types | `tests/store.test.ts` |
| Anonymous/signed-in namespace adoption | `src/db/adopt.ts` | schema, shell sign-in flow | `tests/adopt.test.ts`, `tests/shell.test.ts` |
| JSON backup and restore | `src/db/export.ts` | schema, store, Settings handlers | `tests/export.test.ts` |
| Starter seed | `src/db/seed.ts`, `src/data/seed-events.json` | catalog codecs, program import, generation script | `tests/seed.test.ts` |
| PWA registration/offline cache | `src/app/pwa.ts`, `public/sw.js` | manifest and Vite build output behavior | production-build browser validation |
| Build/version/deployment | `vite.config.ts`, `src/app/version.ts` | Pages/release workflows | `npm run build`; workflow checks |
| Encrypted sync | `src/sync/engine.ts` | `docs/plans/v2-encrypted-backup-alpha.md` | no sync test exists yet; implementation is not shipped |

## Important module groups

### App composition

- `src/app/shell.ts` initializes state and namespaces, renders the root, binds global
  navigation, and composes focused controllers. Feature-specific workflows live behind
  controller interfaces and the shell is below the 400-line target.
- `src/app/program-builder.ts` owns program-builder modal state, exercise selection,
  normal/superset and EMOM prescriptions, row ordering, validation, and persistence.
- `src/features/sheets/builder-views.ts` renders the builder's row and EMOM-section
  markup from `BuilderState`. It is pure markup; all builder state lives in the
  controller above.
- `src/app/catalog-controller.ts` owns catalog refresh/cache/profile loading and local
  library import, update, deletion, favorite, and detail actions.
- `src/app/identity-controller.ts` owns signer connection, adoption choices, sign-out,
  and the NIP-46 connection modal lifecycle.
- `src/app/preferences-controller.ts` owns settings persistence, body/history actions,
  backup controls, support funding refresh, and Quick Workout/recovery handlers.
- `src/app/session-persistence.ts` adapts stored session rows into live/history state.
- `src/app/layout.ts` composes top-level pages from feature view functions. It does not
  persist data.
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

`src/db/schema.ts` currently creates these version-1 object stores:

- `exercises`
- `sheets` and `sheet_exercises`
- `sessions` and `session_sets`
- `bodyweight`
- `settings`
- `sync_queue`
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
- Discover shows relay/catalog objects. Import copies them into IndexedDB.
- `src/nostr/programImport.ts` plans program dependency imports and detects new,
  already-imported, or update states.
- A locally edited imported or seeded program loses its catalog identity and becomes a
  local fork. Confirm this behavior in `WorkstrStore.saveSheet()` before changing it.

### Identity and network

- `src/signer/types.ts` is the common signing/encryption contract.
- `nip07.ts` wraps `window.nostr`; `nip46.ts` owns remote/bunker connections and cached
  connection metadata.
- `src/nostr/share.ts` builds and publishes public workout summaries, requiring actual
  relay acknowledgement/verification before reporting success.
- Local training must remain usable when every relay operation fails.

## Styling and static assets

- `src/style.css` contains Workstr Web-specific and live-runner overrides.
- `src/workstr-reference.css` is imported design/reference CSS used by the app.
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
- `CHANGELOG.md`: shipped and unreleased user-visible behavior.

Update this map when files move, responsibilities split, or the persistence/data flow
changes. A stale map costs more agent context than no map.

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
