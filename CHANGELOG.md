# Changelog

All notable changes to Workstr Web are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Mixed program details split into Strength and EMOM.** Opening a program that combines
  both now shows each half under its own heading, in the order the session trains them,
  with its own exercise count and time. Timed exercises are described by rounds, interval
  and work duration instead of the sets, reps and rest a timed step never had, and an
  exercise used in more than one EMOM section reports each section's own numbers.

### Fixed

- The countdown beeps now cover a timed EMOM step's own work phase. Cues followed the
  interval clock, so a step that finished before its interval did counted down only the
  recovery that followed it and the work timer ran out in silence. Work and recovery each
  count down on their own clock, and a step that fills its whole interval still beeps once
  per second rather than twice.
- The time on a program's EMOM summary counted only the EMOM half while the program card
  counted the whole program, so a mixed program advertised two different durations. Both
  now come from one estimate and agree.

- Countdown beeps no longer go silent after the first EMOM round. When the device
  interrupts the audio session mid-workout, the app now recovers instead of dropping
  every later cue: an inaudible keep-alive source holds the audio session open through
  the quiet part of each round, a resume that never completes can no longer latch audio
  off for the rest of the session, and any touch inside a live session re-primes sound.
  Settings reports the audio state next to the version.

## [1.1.0] - 2026-08-19

### Changed

- Retired relay and catalog-source names are migrated to current Workstr vocabulary
  when an existing local database opens.

### Added

- **Mixed program builder sections.** A program can now combine a normal strength
  portion with EMOM sections, and EMOM sections can hold multiple movements in the same
  interval for superset-style timed work.
- **Live supersets.** Normal programs can pair consecutive exercises into grouped
  rounds. The live runner advances through every movement before starting round rest,
  stores block/round/step coordinates with each set, and labels supersets in history.
- **EMOM program blocks.** Programs can define rounds of one or more timed intervals,
  including several duration-based exercises inside the same interval. The live runner
  reconciles from wall-clock time, restores unfinished EMOM sessions, and logs actual
  reps independently from prescribed work duration for training statistics.

### Fixed

- Mixed normal + EMOM programs now run the normal strength section before opening the
  EMOM timer instead of treating the presence of any EMOM block as EMOM-only.
- Starting the EMOM half of a mixed session no longer discards the strength half's start
  time. The session clock continues from where the strength work left off instead of
  resetting to zero, and finished-session duration counts both halves.
- A mixed session can be finished from the strength half. The handoff moved to its own
  "Start EMOM" button, which appears once every prescribed strength set is logged, so the
  finish button always finishes.
- Program cards estimate a mixed program as its strength section plus its EMOM sections,
  and list the exercise and superset counts alongside the EMOM label rather than hiding
  them behind it.
- The program builder refuses to place one exercise in both the strength and EMOM halves,
  which previously saved without complaint and then silently dropped the strength copy.

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

[Unreleased]: https://github.com/Workstr7blo/workstr-web/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Workstr7blo/workstr-web/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v1.0.0
[0.9.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v0.9.0
