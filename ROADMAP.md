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
- Two event vocabularies stay separate — the public Workstr catalog (operator-signed,
  plaintext) and private user data (self-encrypted). Nothing public is ever derived from
  private data.
- Exercises are operator-authored, permanently. Programs open up in v3.
- Funding is donations first; any paywall is a documented fallback with a published
  trigger (`instruction.md` §11), never a roadmap item.
- Module discipline: no file over ~400 lines, feature modules never import each other,
  pure logic ships with tests.

---

## Where we are

All four Phase 1 pillars are shipped and the app is public. It is a complete offline
tracker with a working Nostr read path, optional identity, and live training modes,
deployed to the domain and tagged through v1.1.0 (2026-08-19).

**Shipped**

- **Local-first tracker** — catalog-only exercise library with owned-equipment filtering,
  program builder, live session runner with rest timer and wake lock, progress
  statistics, recovery body map, Quick Workout, PWA install and offline, JSON
  export/import.
- **Workstr catalog (read)** — operator-filtered queries across catalog relays, every
  signature verified, cross-relay merge and dedupe, offline event cache. Import copies a
  snapshot; programs pull their exercises through a dependency walk; update detection
  keys on the full address plus origin timestamp.
- **Identity and sharing** — optional NIP-07 / NIP-46 sign-in from Settings, per-namespace
  database with never-merge adoption, `kind:1` workout summaries published to the write
  relay set with real acknowledgement checking.
- **Live training modes** — EMOM blocks, supersets, and mixed strength + EMOM programs in
  the session runner, reconciled against wall-clock time on a session clock that runs
  continuously across both halves.
- **Release and support** — starter seed of three beginner programs, the zap-only support
  and funding panel, and the tag-triggered release pipeline. v0.9.0, v1.0.0 and v1.1.0 are
  tagged, released with build artifacts, and live on the domain.
- **Delivery** — Pages workflow deploys `main` to the custom domain; 258 tests across 26
  files, green.

**Next**

v1.2 is complete and awaiting a tag. Then v1.3 workout history, then v2.0-alpha encrypted
backup. Nothing else in v1 is open.

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

Turn History from a newest-first archive into a training record that makes consistency
visible and lets a finished session start the next one. Independent of v2: it reads the
IndexedDB session snapshots that already exist, adds no object store and no network
dependency, and stays usable offline and signed out. Sequence is fixed because each step
consumes the one before it (epic: #37).

1. Timezone-safe history model — local `YYYY-MM-DD` keys, month aggregation, weekly
   consistency, rest-day counts, as pure tested logic.
2. Monthly calendar and compact summary cards above the timeline.
3. Date-driven, grouped session timeline fed by calendar selection.
4. Repeat a completed workout from its stored snapshot, without mutating the original.
5. Responsive, accessibility, timezone/DST, offline, and regression QA.

Local calendar date is the user-facing unit throughout — never UTC slicing that moves a
late-night workout to the next day. Full charts, volume, and 1RM stay in Statistics; this
milestone does not duplicate them.

**Done when:** current-month consistency is legible without opening a session, any workout
is reachable from a date in two interactions, and a compatible past session can be
repeated.

## v2.0-alpha — Encrypted backup private alpha

Automatic self-serve encrypted backup for up to 50 pubkeys. The client remains local-first:
the sync engine is inert unless the user signs in, opts into encrypted backup, and receives
relay access. Everything behaves exactly as it does today if the relay is unreachable or
the user never enables it.

Detailed execution plan: `docs/plans/v2-encrypted-backup-alpha.md`.

**Server**

1. strfry with NIP-42 auth and an allowlist policy.
2. Self-serve signed access API with a 50-pubkey alpha cap; no payment and no manual
   approval in the alpha path.
3. Capacity caps — per-pubkey storage quota, blocked-pubkey handling, and a hard ceiling
   on admitted pubkeys from day one.
4. Off-machine nightly LMDB backups and a restore runbook before inviting alpha users.
5. Publish the real monthly cost, and set the §11.4 threshold to a real number at the same
   time. Do not launch without both.

**Client**

6. NWC/NIP-47 support flow for custom in-app zaps: amount/comment UI, zap request signing,
   LNURL invoice fetch, NWC payment, receipt verification, and funding-panel refresh.
7. Encrypted backup access UI in `features/support/`.
8. `nostr/auth.ts` — NIP-42 challenge signing.
9. `nostr/codecs30078.ts` — NIP-44 encrypted `kind:30078` private-record codecs.
10. `sync/engine.ts` — write queue, manifest, tombstones, LWW merge, push, pull, and lazy
   restore.
11. Automatic non-blocking sync UX with pending count, last-sync state, retry, and manual
    sync-now fallback.

**Done when:** phone → relay → laptop restore works after decryption, with no manual
operator step and no plaintext private training data leaving the browser.

## v3 — Growth

Independently shippable, roughly in order of value. Nothing here blocks v1 or v2.

1. Milestone zap prompts — contextual donation moments at PRs and streaks, built on the
   v2 NWC support flow rather than a separate payment rail.
2. Supporter badge and supporters page, resolved from public zap receipts.
3. **User-published programs** (`kind:33402`) — the one authoring capability that opens
   up. Programs may only reference exercises that already have an address, which keeps
   the exercise vocabulary clean and removes the need for a publish-time dependency walk.
   Separate discovery surface from the operator catalog; imports stay snapshots.
4. Blossom media server on the relay host — and only there does the media-upload question
   reopen, from scratch.
5. Push notifications for scheduled workouts.
6. Coach platform, built on item 3.
7. `signer/idenstr.ts` — one codebase, three signer backends.

## Fallback — paid relay access

Not a milestone and not scheduled. Built only if the funding trigger in `instruction.md`
§11.4 fires, and scoped there so it stays a small delta rather than a redesign.

---

## Continuous

- **Catalog content** — grow from the launch set toward 50–100 exercises and 5–10
  programs, authored and published from the self-hosted Workstr install. Independent of
  every milestone above.
- **Browser-surface verification** — any change to a view, the shell, or the session
  runner is driven in headless Chromium against the production build before it is done.

## Open questions

- **RPE** — the field is typed and unwritten on purpose. Three decisions block it: RPE or
  RIR, prompted per set or per exercise, and what consumes the number. Build the consumer
  before the input.
- **The §11.4 threshold** — deliberately unset until v2 gives it a real denominator.
- ~~**Does this file ship with the repo?**~~ — settled by practice: it is tracked and
  committed, so the accurate description of the project ships alongside the spec.

## Known debt

- `render()` rebuilds the whole root on every state change (54 call sites). Fine at
  current DOM size; the session runner's in-place patching is the pattern to copy if
  lists get janky.
- The app shell and live runner are divided into focused coordinators, controllers,
  views, timing, persistence, and summary modules; neither remains oversized.
