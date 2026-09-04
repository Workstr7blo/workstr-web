# Workstr Web — Roadmap

Direction and sequence only. Detail lives in GitHub Issues; decisions and specs live in
the build plan (`workstr-web-plan-v2.md`, operator copy) and `docs/instruction.md`.

Milestones are releases. A milestone is done when it is tagged and on the domain.

---

## Standing constraints

- The UI reads and writes only IndexedDB. The network is a catalog to import from and,
  later, an encrypted replica — never a dependency for rendering a screen.
- Keys never touch the app. All signing and encryption goes through the `Signer`
  interface (NIP-07, NIP-46).
- The app opens straight into training. Sign-in is optional and lives in Settings.
  Namespaces are never merged.
- Data is never hostage: JSON export and import ship in every release.
- Public program/exercise events and private user data stay separate. Public relays carry
  plaintext operator catalog events and opt-in creator-published programs; private user
  data is self-encrypted for sync. Nothing private is published by default.
- Exercises are operator-authored, permanently. Programs can be creator-published after
  the self-serve Beast Mode checklist passes; the namespace is indexing, not approval.
- Funding is donations first; any paywall is a documented fallback with a published
  trigger (`instruction.md` §11), never a roadmap item.
- Module discipline: no file over ~400 lines, feature modules never import each other,
  pure logic ships with tests.

---

## Where we are

All four Phase 1 pillars are shipped and the app is public. It is a complete offline
tracker with a working Nostr read path, optional identity, and live training modes,
deployed to the domain and released as v2.4.0 (2026-09-04).

**Shipped**

- **Local-first tracker** — catalog-only exercise library with owned-equipment filtering,
  program builder, live session runner with rest timer and wake lock, progress
  statistics, recovery body map, Quick Workout, PWA install and offline, JSON
  export/import.
- **Workstr catalog (read)** — operator-filtered queries across catalog relays, every
  signature verified, cross-relay merge and dedupe, offline event cache. Import copies a
  snapshot; programs pull their exercises through a dependency walk; update detection
  keys on the full address plus origin timestamp.
- **Beast Mode creator programs** — local program cards can publish signed `kind:33402`
  creator programs to configured public relays after the objective Settings checklist is
  unlocked; Discover shows those alongside official operator programs.
- **Identity and sharing** — optional NIP-07 / NIP-46 sign-in from Settings, per-namespace
  database with never-merge adoption, `kind:1` workout summaries published to the write
  relay set with real acknowledgement checking.
- **Live training modes** — EMOM blocks, supersets, and mixed strength + EMOM programs in
  the session runner, reconciled against wall-clock time on a session clock that runs
  continuously across both halves.
- **Workout history** — a monthly calendar with consistency cards, a timeline grouped by
  local day and driven by calendar selection, and Repeat workout rebuilding a past session
  from its own snapshot.
- **Release and support** — starter seed of three beginner programs, the zap-only support
  and funding panel, and the tag-triggered release pipeline. v0.9.0, v1.0.0 and v1.1.0 are
  tagged, released with build artifacts, and live on the domain.
- **Creator support rails** — Settings picks Lightning zaps or Monero tips. Monero Mode
  swaps the NWC wallet card for a public `kind:10133` address and Discover's zap surfaces
  for a tip action, and touches nothing else. Released in v2.3.0.
- **Mobile-first browsing** — Programs, Discover and the exercise library each put search,
  a filter sheet and their own actions in one toolbar row, cutting the distance from the
  sub-tabs to the first card from 322px and 214px to 76px on a phone. Statistics scopes to
  a date range, and its empty states, Recovery's and the Body tab's each say one true thing
  rather than several. Released in v2.4.0.
- **Delivery** — Pages workflow deploys `main` to the custom domain; more than 900 tests
  across the unit, integration, and browser surfaces are green, and `tests/setup.ts` bars
  any test from reaching the network.

**Next**

No numbered growth milestone is scheduled. New work is selected from observed product
needs and recorded as a focused issue when it is ready to build.

---

## v1.0 — First public release

Released 2026-08-11 as v1.0.0. The shortest path to something a stranger can use. Nothing
here was new architecture.

1. ~~**Starter seed**~~ — done. Three beginner programs and their ten exercises, generated
   from the operator's signed catalog events by `scripts/generate-seed.mjs` and parsed
   through the same codecs as a Discover import. Backfill-only, once per account; seeded
   rows do not count as user data for adoption, and editing a starter program forks it.
2. ~~**Support surface**~~ — done. App and landing tell the same zap-only transparency
   story: zaps are the canonical donation route because they produce public `kind:9735`
   receipts; plain Lightning and on-chain BTC are not normal v1 donation paths. The
   funding panel reads verified zap receipts against the published 85,000 sats monthly
   operating target; unreachable relays report unknown, never zero.
3. ~~**Release plumbing**~~ — done. `CHANGELOG.md`, the tag-triggered release workflow,
   and GitHub Releases carrying the built site as an artifact. Cutting a release is now
   one pass: promote `[Unreleased]`, bump the package version, tag, push.
4. ~~**Release pass**~~ — done. The mobile blockers found working `docs/RELEASE-QA.md`
   against the deployed site were fixed before the v1.0 tag.

**Done when:** a stranger installs from the domain, trains a real session with no network
and no identity, and can support the project without leaving the app. Whether people
actually stick with it is measured after the tag, not before — see the two Phase 1 bars in
`instruction.md` §14.

## v1.1 — Live-training modes

Released 2026-08-19 as v1.1.0. Feature first, refactor second — the mode is what exposed
the real seam in the runner.

1. ~~EMOM set mode inside the session runner.~~ — done. Block-based rounds, sequential
   sections, a dual-ring work timer, restore of unfinished sessions, and actual reps
   logged independently from prescribed work duration.
2. ~~Split the runner along the seams EMOM exposes.~~ — done. Coordinators, controllers,
   views, timing, persistence and summary modules; nothing left oversized.
3. ~~Supersets on top of the split structure.~~ — done. Grouped rounds in normal programs,
   several movements inside one EMOM interval, and block/round/step coordinates stored
   with every set.
4. ~~Test backfill for the remaining pure modules.~~ — done. 243 tests across 26 files.

## v1.2 — Cleanup and debt

Small, mechanical, and meant to have its own tag. All three items are done; items 1 and 2
landed on `main` before the v1.1 tag and so shipped inside v1.1.0 anyway. Item 3 moves the
IndexedDB version, so it sets the version bump for whatever tag carries it.

1. ~~`app/shell.ts` extraction pass~~ — reduced from 1,291 to under 400 lines by
   extracting program builder, catalog/library, identity/adoption,
   preferences/history/recovery, and session-persistence controllers.
2. ~~Rename retired relay/source vocabulary~~ — stored legacy settings and catalog rows
   migrate to `workstrRelay` and `imported` when the namespace opens. Shipped in v1.1.0.
3. ~~Drop the unused `plan` object store at a schema migration.~~ — done. Database
   version 2 deletes the store on open and never creates it; no data moves, and export
   files stay compatible in both directions.

## v1.3 — Workout history

Released 2026-08-19 as v1.3.0. History became a training record rather than an archive,
without an object store, a network dependency or an export schema change.

1. ~~Timezone-safe history model~~ — done. `core/dates` owns the local calendar vocabulary
   and `features/train/history-model` the aggregation. Day arithmetic goes through calendar
   fields, so DST cannot shift a date; `computeStreak` moved onto the same vocabulary,
   fixing a UTC-versus-local day-key bug it had carried from the self-hosted port.
2. ~~Monthly calendar and compact summary cards~~ — done. Intensity by completed sets,
   multi-session counts, and workouts/active weeks/rest days, all legible without colour.
3. ~~Date-driven, grouped session timeline~~ — done. Today/Yesterday/dated headings, and a
   selected day renders only that day. Delete moved behind a disclosure.
4. ~~Repeat a completed workout~~ — done. Rebuilt from the session's own snapshot, so it
   survives the source program being edited or deleted; the original is never mutated.
5. ~~Responsive, accessibility, timezone and regression QA~~ — done. 370 tests under eight
   timezones from UTC+14 to UTC-11, plus a headless pass at 320/390/768/1280.

Local calendar date is the user-facing unit throughout — never UTC slicing that moves a
late-night workout to the next day. Full charts, volume, and 1RM stay in Statistics; this
milestone does not duplicate them.

Deferred on purpose, recorded in `docs/RELEASE-QA.md`: year heatmap, monthly recap,
history search, save-a-repeat-as-a-program, progressive overload, and virtualisation.

## v2.0 — Encrypted sync

Released 2026-08-28 as v2.0.0. Settings presents
**Auto-sync** to signed-in users and manual JSON backup to everyone. There is no
allowlist, access request, subscription, or NIP-42. The client remains local-first and
sync failures never block training.

The relay write policy accepts `kind:30078` under `workstr:v2:` only. The client uses a
signer-wrapped account backup key, compressed AES-GCM envelopes, replaceable object
records, append-only device journals for workout/body history, and incremental restore.
The authoritative protocol is `docs/encrypted-sync-architecture.md`; the detailed alpha
plan is retained as historical issue-sequence context.

**Server**

1. ~~strfry write policy — kind `30078` plus the `workstr:v2:` `d` prefix, everything
   else rejected.~~ — done, including V1 cutover removal.
2. ~~Abuse controls — per-pubkey quota, total storage ceiling with an alert, block list.~~
   — done. Usage is counted per record address rather than per publish, because `30078` is
   addressable and charging every upload would bill a daily sync for storage that never
   grew. Blocks take effect without a restart, and `rebuild` recomputes the ledger from
   the relay's own contents when it drifts.
3. ~~Off-machine nightly LMDB backups and a restore runbook.~~ — done. The backup host
   pulls a verified snapshot nightly, so the relay holds no credential for its own
   backups; seven dailies plus four weeklies, and `relay/backup/README.md` carries the
   restore procedure and the drill record. Repeating the drill against a production
   snapshot is what gates the toggle beyond the operator.

**Client**

4. ~~Account key, compressed authenticated envelope, and `kind:30078` codecs.~~ — done.
5. ~~Replaceable-object queue, append-only journals, tombstones, deterministic replay,
   incremental pull, retry, and V2-era cutover.~~ — done.
6. ~~Data & Sync control center with Auto-sync, status/progress, retry, Sync now, and
   manual JSON backup.~~ — done, including the iOS layout follow-up.

**Done when:** phone toggles backup on → relay → laptop restore works after decryption,
with no operator step at any point, no plaintext private training data leaving the
browser, and a `kind:1` aimed at the Workstr relay bouncing off the write policy.

Moved out of this milestone: NWC/NIP-47 custom in-app zaps (issue #26) is support work,
not backup work, and ships independently. Publishing the real monthly cost and setting the
§11.4 threshold (issue #59) moved to v2.2 — the alpha is what produces the cost figure, so
gating the alpha on it was circular.

## v2.2 — Wallet, creator publishing, and sync hardening

Released 2026-09-01 as v2.2.0. This release adds NWC workout-program zaps, verified zap
totals, self-serve Beast Mode creator publishing and discovery, compact Settings, isolated
browser smoke verification, and backup-key lineage fingerprints that stop conflicting
encrypted-sync writes before they can deepen a key fork.

The proposed EMOM transition tone (#60) was retired by owner direction rather than shipped.
The catalog-growth target (#23) was completed by the live operator catalog with more than
55 exercises and five programs.

## v2.3 — Monero Mode

Released 2026-09-04 as v2.3.0. Creator support stopped being a Lightning assumption and
became a rail the user picks in Settings. Lightning is still the default and is unchanged:
NWC setup, the zap CTA, verified sats totals and the top-zapped ranking all behave exactly
as they did in v2.2. Monero Mode swaps the payment layer and nothing else.

1. ~~Mode setting and theme foundation~~ — done (#129, PRs #134, #136, #138, #139). The
   setting is a two-option rail, Lightning zaps or Monero tips, rather than an on/off
   toggle, because the app is always on one rail or the other.
2. ~~NIP-A3 payment-target primitives~~ — done (#130, PR #140). `kind:10133` `payto` tags,
   parsed and built; `kind:10133` is canonical for Monero and `kind:0` `lud16`/`lud06`
   stays canonical for Lightning, with neither read as a substitute for the other.
3. ~~Public Monero address in Settings~~ — done (#131, PR #141). Monero Mode replaces the
   NWC wallet card with the signed-in user's address, read from relays and published
   through the same signer as every other event; clearing it removes only the Monero
   target. The address is public Nostr metadata — never in IndexedDB, never in encrypted
   sync, never beside NWC credentials — so auto-sync is unchanged on either rail.
4. ~~Monero tips in Discover~~ — done (#132, PR #142). A card carries a tip action only
   when its author publishes a Monero address, looked up for every visible author in one
   batched, cached query. The zap CTA, sats totals and top-zapped ranking are withdrawn
   rather than recoloured, and nothing is invented to replace them: Workstr cannot see a
   Monero transfer, so there is no Monero total, ranking or receipt. An author with no
   address gets no payment control at all — not a disabled button, not "no address".
5. ~~Boundary documented and gated~~ — done (#133, PR #143). `docs/instruction.md` §6.4
   carries the two-rail table and the theme rule.

The theme boundary is the lesson of this milestone. It eroded twice — first as tokens that
repainted nothing, then as an app repainted graphite and orange — before #137 pinned the
rule down: purple is Workstr and Nostr, orange is Monero. The shell tokens are owned by
`:root` and identical in every mode; only `--payment-*` and `--on-payment` may be
overridden, and `tests/theme-tokens.test.ts` fails the build otherwise. A view with no
payment control on screen must look the same on both rails, which a computed-style diff
across seven views confirms rather than a screenshot hash.

Workstr never holds Monero keys, custody, balances or transaction status, and Monero
direct payments are never presented as NIP-57 zaps.

## Fallback — paid relay access

Not a milestone and not scheduled. Built only if the funding trigger in `instruction.md`
§11.4 fires, and scoped there so it stays a small delta rather than a redesign.

---

## Continuous

- **Catalog content** — maintain and curate the live set of more than 55 exercises and
  five programs from the self-hosted Workstr install.
- **Browser-surface verification** — any change to a view, the shell, or the session
  runner is driven in headless Chromium against the production build before it is done.

## Open questions

- **RPE** — the field is typed and unwritten on purpose. Three decisions block it: RPE or
  RIR, prompted per set or per exercise, and what consumes the number. Build the consumer
  before the input.
- ~~**Does this file ship with the repo?**~~ — settled by practice: it is tracked and
  committed, so the accurate description of the project ships alongside the spec.

## Known debt

- `render()` rebuilds the whole root on every state change (54 call sites). Fine at
  current DOM size; the session runner's in-place patching is the pattern to copy if
  lists get janky.
- The app shell and live runner are divided into focused coordinators, controllers,
  views, timing, persistence, and summary modules; neither remains oversized.
