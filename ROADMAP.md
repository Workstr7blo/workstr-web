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

Three of the four Phase 1 pillars are shipped. The app is a complete offline tracker with
a working Nostr read path and optional identity. It has never been released.

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
- **Delivery** — Pages workflow deploys `main` to the custom domain; 156 tests across 18
  files, green.

**Not started**

Starter seed, the support/donation surface, the release process itself, and everything in
v2 and beyond.

---

## v1.0 — First public release

The shortest path to something a stranger can use. Nothing here is new architecture.

1. ~~**Starter seed**~~ — done. Three beginner programs and their ten exercises, generated
   from the operator's signed catalog events by `scripts/generate-seed.mjs` and parsed
   through the same codecs as a Discover import. Backfill-only, once per account; seeded
   rows do not count as user data for adoption, and editing a starter program forks it.
2. **Support surface** — implemented, with one v1 alignment pass remaining. App and
   landing support must tell the same zap-only transparency story: zaps are the canonical
   donation route because they produce public `kind:9735` receipts; plain Lightning and
   on-chain BTC are not normal v1 donation paths. The funding panel reads verified zap
   receipts against the published 85,000 sats monthly operating target; unreachable relays report
   unknown, never zero.
3. **Release plumbing** — mostly done for v0.9.0: `CHANGELOG.md`, tag-triggered release
   workflow, and a GitHub Release exist. For v1.0, promote `[Unreleased]` to `1.0.0`, tag
   after QA clears, and verify the release artifact/domain.
4. **Release pass** — work `docs/RELEASE-QA.md` against the deployed site: real iPhone,
   real signers, real relays. Blocking sections must be clear before the v1.0 tag.

**Done when:** a stranger installs from the domain, trains a real session with no network
and no identity, and can support the project without leaving the app. Whether people
actually stick with it is measured after the tag, not before — see the two Phase 1 bars in
`instruction.md` §14.

## v1.1 — Live-training modes

Feature first, refactor second — the mode is what exposes the real seam in the runner.

1. EMOM set mode inside the session runner.
2. Split the runner along the seams EMOM exposes.
3. Supersets on top of the split structure.
4. Test backfill for the remaining pure modules.

## v1.2 — Cleanup and debt

Small, mechanical, and worth its own tag so it does not ride along with features.

1. ~~`app/shell.ts` extraction pass~~ — reduced from 1,291 to under 400 lines by
   extracting program builder, catalog/library, identity/adoption,
   preferences/history/recovery, and session-persistence controllers.
2. ~~Rename retired relay/source vocabulary~~ — stored legacy settings and catalog rows
   migrate to `workstrRelay` and `imported` when the namespace opens.
3. Drop the unused `plan` object store at a schema migration.

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
- **This file is gitignored.** The accurate description of the project is untracked while
  the committed one is the spec. Decide whether it ships with the repo.

## Known debt

- `render()` rebuilds the whole root on every state change (54 call sites). Fine at
  current DOM size; the session runner's in-place patching is the pattern to copy if
  lists get janky.
- The app shell and live runner are divided into focused coordinators, controllers,
  views, timing, persistence, and summary modules; neither remains oversized.
