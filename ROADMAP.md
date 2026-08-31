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
deployed to the domain and tagged through v2.0.0 (2026-08-28).

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
- **Delivery** — Pages workflow deploys `main` to the custom domain; 370 tests across 30
  files, green.

**Next**

Complete the measured funding numbers and EMOM transition tone tracked for v2.2,
then scope v3 growth work.

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

## v2.2 — Funding numbers and training polish

Deferred items that do not gate the alpha. Both were written down elsewhere and never
reached the issue queue, which is the only reason they are called out here.

1. Publish the real monthly relay cost and set the §11.4 threshold to a real number at the
   same time (#59). The alpha is the thing that generates the cost, so this follows it
   rather than blocking it — but it is still a pair: a published cost without a threshold
   restates the problem instead of answering it.
2. Mark the EMOM work-to-recovery transition with a tone (#60). Work counts down and then
   goes silent, while recovery ends on the round-boundary tone; the two halves of an
   interval are not treated the same.

**Done when:** the funding figures in the app and on the landing page are measured rather
than placeholder, the §11.4 trigger is a number with its reasoning recorded, and a timed
EMOM step ends audibly.

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
- **The §11.4 threshold** — deliberately unset until the alpha gives it a real
  denominator. Scheduled as v2.2 #59, not as an alpha launch gate.
- ~~**Does this file ship with the repo?**~~ — settled by practice: it is tracked and
  committed, so the accurate description of the project ships alongside the spec.

## Known debt

- `render()` rebuilds the whole root on every state change (54 call sites). Fine at
  current DOM size; the session runner's in-place patching is the pattern to copy if
  lists get janky.
- The app shell and live runner are divided into focused coordinators, controllers,
  views, timing, persistence, and summary modules; neither remains oversized.
