# Changelog

All notable changes to Workstr Web are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Next up is v1.0: bundled starter programs, the support surface, and the release QA pass.
See `ROADMAP.md`.

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

[Unreleased]: https://github.com/Workstr7blo/workstr-web/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v0.9.0
