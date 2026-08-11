# Changelog

All notable changes to Workstr Web are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-11

### Added

- **Starter programs.** A fresh install now ships with three beginner programs —
  Foundation Full Body, Core Stability Starter, and Legs & Glutes — and the ten exercises
  they use. The app is usable offline, with no account and before Discover has ever been
  opened. The seed is the operator's own signed catalog events, so a seeded entry is
  identical to the imported one: Discover reports it as already in your library instead of
  offering a duplicate, and still offers an update if the catalog entry is republished.
- Settings shows the running app version.
- **Support Workstr.** A zap-first support panel in Settings with the project's Nostr
  identity, a canonical "Zap on Nostr" action, and a copy button for the npub. Below it,
  a live funding panel shows what came in this month against the published 85,000 sats
  monthly running cost — read directly from public NIP-57 zap receipts, with no account,
  analytics or server. Plain Lightning and on-chain routes are not presented as separate
  donation paths. Only receipts signed by the wallet provider are counted, and when the
  relays cannot be reached the panel says the total is unknown rather than reporting zero.

### Changed

- Seeding is backfill-only and applies once per account: a starter exercise you delete
  stays deleted, a program you edit becomes your own, and anything already occupying a
  slot is left untouched.

### Fixed

- Rest timers now reconcile against wall-clock time after iOS suspends and resumes the
  installed PWA.
- Android opens mobile signer deep links in the existing app context instead of leaving
  users in a blank browser window.
- Exercise images loaded from the Workstr catalog are cached for offline cold starts.

## [0.9.0] - 2026-08-08

First tagged release. The app is feature-complete as a local-first tracker with a working
Nostr read path; it is versioned here so releases are traceable while v1.0 is finished.

### Added

- **Training** — live session runner with rest timer, wake lock, per-set logging, and a
  finish-and-review flow. Sessions store a denormalized snapshot of what was trained, so
  history survives later library changes.
- **Exercise library** — browse, search, filter by category, muscle, equipment and
  difficulty, mark favourites, remove entries. Filled from the Workstr catalog rather
  than authored locally.
- **Owned equipment** — record the equipment you actually have; drives a "My equipment"
  filter and keeps generated workouts from proposing exercises you cannot do. Bodyweight
  movements stay available under every kit.
- **Programs** — program builder with ordered exercises, per-exercise targets, stable
  slugs, and a browsable library picker.
- **Progress** — weekly volume, muscle distribution, estimated-1RM records, training
  streak, and a body-weight log.
- **Recovery** — muscle recovery state computed from session history, rendered as a body
  map, plus a one-tap Quick Workout drawn from recovery state and owned equipment.
- **Workstr catalog** — Discover reads operator-signed exercises (kind 33401) and
  programs (kind 33402) from public relays, verifies every signature, merges across
  relays, dedupes by address, and caches events for offline use. Import copies a
  snapshot; programs pull in their exercises through a dependency walk; bulk select
  imports many at once.
- **Update detection** — imported rows keep their origin address and timestamp, so a
  newer catalog event surfaces as an available update rather than a duplicate.
- **Optional Nostr identity** — NIP-07 and NIP-46 sign-in from Settings, with a QR
  connect flow for remote signers and cached signer sessions.
- **Local-first accounts** — the app opens straight into training with no identity at
  all. Signing in adopts the anonymous account's data into a per-pubkey database;
  namespaces are never merged, and signing out returns to the anonymous account.
- **Workout summaries** — publish a session summary as a kind:1 note to a broad write
  relay set, with the program's muscle map attached when one exists. Publishes are only
  reported as successful when a relay actually acknowledged the event.
- **Data export** — JSON export and import of the entire local database, from Settings.
- **PWA** — installable, offline-capable, with a same-origin service worker cache and a
  capped image cache.

### Notes

- Weights are stored canonically in kilograms; the display unit is a user preference.
- `session_sets.rpe` exists in the schema but is never written — see `ROADMAP.md`.

[Unreleased]: https://github.com/Workstr7blo/workstr-web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v1.0.0
[0.9.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v0.9.0
