# Changelog

All notable changes to Workstr Web are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Workstr can now create or restore a device-managed Nostr sync account.** New users can
  create an encrypted sync account from Settings, save the shown recovery key, and keep the
  key only in this browser profile for faster signing and backup checks. Existing Nostr
  users can still use a mobile signer or browser extension instead.

### Fixed

- **Encrypted sync can recover when the relay's wrapped backup key was replaced after records already existed.** A device that still has the older working key cached now republishes it when it sees that the newer relay key would orphan records it had already read, and sync errors no longer leave a stale progress bar stuck on the screen.

- **Mobile signer connection waits until Workstr is listening on the Nostr Connect relay, and recovers a stored reply if the phone backgrounds the app.** This avoids the loop where Clave shows a successful Connect activity, but Workstr misses the answer and returns to Settings still signed out.

- **Backup no longer pauses for 45 seconds at a time on a remote signer.** A signer's answer
  can go missing on its way back — it is published before the app is listening again, and
  the app then waits out its whole timeout before trying once more, even though the signer
  has already done the work. The app now notices much sooner and asks again, but only on
  signers that answer by themselves; where a signer puts the request in front of you, it
  still waits, because asking again there would mean approving the same thing twice.

- **Backup recovers in seconds on a desktop instead of looking broken.** Two waits stacked
  up on the first sync after opening the app: what the app knows about how quickly your
  signer answers was thrown away with every page load, so the first request — the one whose
  answer goes missing most often, on a connection that has just been rebuilt — always waited
  the full timeout; and the retry afterwards then sat behind the same long backoff a dead
  relay gets. The app now remembers that your signer answers by itself, and reconnects a few
  seconds after one stops answering rather than half a minute later. While it does, the
  panel says it is reconnecting instead of telling you to go and open your signer app.

### Changed

- **Workout history cards now read like finished-session receipts.** Collapsed history cards
  separate date/duration from set, exercise, and volume chips; expanded cards add a compact
  summary panel, numbered exercise rows, and a stronger repeat-workout action.

- **Workout program cards have a more polished training-app preview.** The Programs intro is
  shorter, collapsed cards now show concise duration/format/focus metadata instead of long
  descriptions, expanded cards add a compact program preview/timeline, exercise rows are
  numbered, and Start workout is promoted to a full-width primary action.

- **Account setup now uses one focused login flow.** The signed-out account chip and Settings
  account row open a tabbed Account modal with Log in as the default and Create account as
  the second tab, while Data & Sync points back to that single Account action instead of
  adding another sign-in button.

- **The header account control is now a compact Nostr identity chip.** Signed-in users see
  their kind 0 profile avatar, nickname, and a small green status dot in the top-right
  instead of a heavier Account card.

- **Settings is now a compact control center.** Account, Data & Sync, Training Preferences,
  Support Workstr, and Advanced are grouped in that order; encrypted relay behavior is
  described as sync/auto-sync, JSON export/import is presented as manual backup, support
  is compact by default, equipment lives behind a concise row, and diagnostics are tucked
  into Advanced.

- **The backup relay now accepts only the current record format.** The previous format was
  accepted alongside it while the app was being rolled out, so the relay and the app did not
  have to change in the same instant. That window is closed.

- **Backup no longer interrupts a workout.** Logging a set used to queue a backup a few
  seconds later, which on a remote signer meant your signer app waking up over and over
  while you were still training. A workout is now held on the device and copied to the
  relay once you finish it. Editing or deleting a finished workout still backs up straight
  away.
- **Backup starts fresh, and older history stays on the device.** Workout history is now
  copied to the relay one workout at a time, from the day backup is switched on. Workouts
  logged before that are kept on this device and are included in JSON export, but they are
  not sent to the relay. Settings tells you how many of those you have.
- **Restoring is no longer slowed down by an index nobody read.** Backup used to publish
  and re-publish a growing list of everything it had stored, which cost a signer round trip
  on every pass and was never used to restore anything. It has been removed.
- **Restoring a device now takes seconds instead of minutes.** Your backup used to be
  encrypted and decrypted one record at a time by your signer app, so restoring a full
  history meant hundreds of round trips to it — and on a remote signer, minutes of waiting.
  Your account now has a single backup key, which your signer unlocks once. Everything
  after that is read and written on the device, and your signer is only asked to sign.
- **Workout history no longer tells the relay how often you train.** Every workout used to
  be its own record with its own name on the relay, in the clear, so anyone reading it could
  count them. History now travels in batches: a year of training is around six records
  instead of two hundred, and the relay learns roughly how much you have stored rather than
  exactly how many times you trained.
- **Two devices can no longer lose each other's work.** Body weight used to be copied as one
  whole record, so if two devices each logged a weigh-in before either had synced, one of
  them quietly won and the other entry was gone. Weigh-ins and workouts are now merged one
  at a time, and a deletion is carried explicitly rather than by falling silent.
- **Finished history is written once and left alone.** Once a batch is full it is never
  rewritten, so editing an old workout no longer re-uploads the rest of that month, and a
  correction costs a single small upload however long your history is.
- **Backups take up far less room.** Records are compressed before they are encrypted,
  which takes a typical workout from around 2,900 bytes to 440 on the relay. Compression is
  skipped where it would not help, such as on a deletion marker.

### Fixed

- **A backup that was stuck now unsticks itself.** A device left holding records queued by
  the previous version could not send them and reported "needs attention" on every attempt,
  with no way out. Those entries are now cleared once, automatically, the first time the
  new version syncs.
- **Importing a JSON archive now backs the workouts up.** Workouts restored from an export
  file were treated as older history and quietly left out of backup, while the panel still
  reported everything up to date. An imported archive now joins backup like anything else,
  and the exporting device's pending queue is no longer replayed onto the importing one.

### Changed

- **Connecting a signer now asks for exactly what Workstr needs, once.** It names the two
  kinds of event the app ever signs — your encrypted backup records and the workout
  summaries you choose to share — instead of asking to sign anything at all in your name.
  Connecting by pasting a `bunker://` link previously asked for no permissions whatsoever,
  which left some signer apps asking you to approve every single record; that link now
  requests the same permissions the QR code does. Existing connections are unaffected.

### Fixed

- **The page jumped back to the top constantly.** Expanding a workout in history, or a
  backup progress line ticking over while it worked, threw you back to the top of whatever
  you were reading — on every device. The app redraws the whole page on any change, which
  loses your place; it now keeps it. Moving to another view still starts at the top, which
  is where a new page should start.

- **Signing in on a second device restored your training but did not show it.** The
  restore wrote everything to the device correctly, while the screen kept showing what it
  had read before the restore ran — so a laptop that had just pulled a whole history looked
  empty, and only reloading the page revealed it. The screen is now re-read as soon as a
  restore lands.

- **One press of Sync now backs up everything, instead of one record at a time.** The
  connection to a remote signer can close between records, and backup treated that as the
  signer being away: it stopped, and you had to press Sync now again for the next record —
  eight presses for a month of training. It now reconnects and carries on, so a whole
  month goes up in one attempt. If the signer really is away it still stops promptly
  rather than working through the queue one timeout at a time.

- **Backup managed one record per attempt, then said your signer did not respond.** The
  connection to a remote signer is allowed to close between requests, and reopening it
  raced the reply to the next one — so the first record of every attempt went through and
  the one after it timed out. The connection is now made ready before every request rather
  than only the first.

- **"Sync now" showed no count while a long backup was running.** Progress was counted in
  months rather than in records sent, so a month that uploads as eight records showed
  nothing at all until the whole month finished — on exactly the months that take longest,
  which read as a hang. The count now moves with every record.

- **A big month of training could never finish backing up, resending the same records
  every time.** A month is uploaded in several records, and the month only counted as done
  when all of them were in — so if a backup ran out of time or lost its connection partway,
  the next one started that month again from the beginning. On a month with a lot of
  training it never got to the end, and the same records went to your signer over and over.
  Records already safely on the relay are now skipped, so each attempt picks up where the
  last one stopped.

- **Backup could stop doing anything at all — no request reaching your signer, and Sync
  now doing nothing.** Waiting for the connection to your signer to be ready was meant to
  stop replies being missed, but it waited for *every* relay it could reach your signer
  through, with nothing to end the wait if one of them stalled while connecting. On a
  phone that happens routinely, and then nothing was ever sent. It now goes ahead as soon
  as one relay is up, and never waits more than a few seconds regardless.

- **Backup could still fail to sign a month of training, on months made up of shorter
  workouts.** The limit on how much training goes into one record was set from a month of
  long workouts, which never fills a record completely. A month of shorter, more frequent
  workouts packs one full — and those records came out just over what a signer will accept,
  so encrypting worked and signing failed. The limit is now worked out from the signer
  limit itself rather than set by hand, and checked against a record packed completely
  full.

- **Backup said your signer did not respond while the signer app showed it had already
  answered.** The reply from a signer travels back over a relay connection that was still
  being opened when the request went out, so a signer quick enough to answer immediately —
  any signer you have already given permission to — answered before anything was listening,
  and the reply was lost. Every retry started a new connection and lost the reply the same
  way. The connection is now open before the first request is sent.

- **Backup stayed broken until you reloaded the app, once your signer had gone quiet
  once.** A remote signer is reached over a connection your phone closes when it puts the
  app to sleep, and the app kept using that closed connection for the rest of the session
  — so every backup afterwards waited 45 seconds and gave up, even with the signer app
  wide open. It now drops a signer that stops answering and reconnects on the next
  attempt. Backup also no longer asks your signer to confirm which account you are: it
  already knows, and that request was both the slowest part of starting a backup and the
  first thing to fail. The message when a signer really is away now says so plainly
  instead of naming an internal call.

- **Backup failed with "your signer did not respond" and never got past the first few
  records.** A month of training was packed into a record large enough that asking a
  remote signer app to sign it meant sending that signer a message twice the size again —
  bigger than any relay will carry — so the request never arrived and backup waited out
  its timeout. Months are now packed to a size a signer can handle, split across a few
  more records where needed. Anything already uploaded in the oversized shape is rewritten
  automatically the next time backup runs.

- **A deleted workout could come back on a restore.** A training month heavy enough to be
  split across several relay records left the extra record behind when it later shrank,
  and a workout deleted from that month was still listed in it — so setting up a new
  device could bring the workout back. The leftover record is now cleared when the month
  no longer needs it, and a deletion always outranks an older record that still mentions
  the workout, whichever order they arrive in.

- **Opening the app no longer restores your whole history every time.** Backup re-read and
  re-decrypted every record on the relay at every start, which meant one signer round trip
  per session just to conclude nothing had changed. It now remembers which records it has
  already read and asks the relay only for what is newer, so a routine start does no
  decryption at all and a restore only covers what actually changed on another device.

- **Backup could get stuck on "Syncing now…" and never recover.** If a signer app stopped
  answering — backgrounded on a phone, or the connection dropped while switching apps to
  approve — backup waited on it forever: no error, no retry, and Sync now did nothing.
  Signer requests now time out, backup says your signer did not respond and to open it and
  tap Sync now, and it retries on its own. Nothing queued is lost while the signer is away.

- **A long first backup no longer looks like a hang.** The status line now counts through
  what it is doing — restoring, preparing, or backing up, with a running total — instead of
  showing one unchanging "Syncing now…" for the whole run.

### Added

- **Auto-backup.** One switch in Settings → Backup copies your programs, workout history,
  body log and preferences to the Workstr relay, and keeps them there as you train.
  Everything is encrypted on your device to your own key before it leaves: the relay holds
  ciphertext it cannot open, and only your key can read it back. Sign in on another device
  with the same identity and your training is restored. Turning it on the first time backs
  up the history you already have, and picks up where it left off if that is interrupted.
  A status line says what is waiting to upload and when the last backup ran; Sync now is
  there when you want it, and a relay that cannot be reached retries on its own without
  ever interrupting a workout. Turning it off stops the copying and leaves both your device
  and the relay untouched. Backup needs an identity, so turning it on while signed out
  takes you through sign-in and comes back on by itself.

- **The app now updates itself.** An installed PWA resumes its existing page instead of
  navigating, so a phone could keep running a build for days and never pick up a fix. The
  app now checks for a new version while it is open, and applies it the next time you
  leave the app, so you come back to the current build without ever seeing a reload. An
  update is never applied during a workout, with the session overlay open, or with a form
  open, and a short message says when one is waiting.

### Changed

- Shortened the History intro line. On a short phone screen it ran to seven lines and
  pushed the calendar almost entirely below the fold; the calendar now leads on every
  iPhone size, and fits above the fold outright from the iPhone 13 up.

## [1.3.0] - 2026-08-19

### Added

- **A monthly workout calendar at the top of History.** Every day you trained is filled in,
  graded by how many sets you completed, with a count when you trained more than once that
  day. Move between months or jump back to the current one; picking a day selects it. Three
  cards underneath say how many workouts you have done this month, how many weeks in a row
  you have trained, and how long it has been since your last session. Every state reads
  without relying on colour, each day carries its full date and workout count for screen
  readers, and the grid fits a 320px phone without sideways scrolling.

- **Repeat workout.** Any completed session can start the next one. Expand a workout in
  History and tap Repeat workout: it rebuilds from what that session actually recorded, so
  it still works after the original program was edited or deleted, and it carries normal,
  superset and EMOM structure alike. The weight you finished each exercise on last time is
  offered as the starting value; nothing counts as logged until you complete the set. The
  original workout is never modified, and a session too old to hold what you trained says
  so on a disabled button rather than starting something broken.

### Changed

- **History is grouped by day and follows the calendar.** Completed sessions now sit under
  Today, Yesterday or a dated heading instead of running together in one list, and picking
  a day on the calendar shows just that day's workouts with a "Show all" way back. Deleting
  a session has moved behind a "More actions" disclosure so it is no longer sitting next to
  Publish summary; it still asks for confirmation. Deleting the last workout on the day you
  were viewing returns you to the full timeline instead of an empty screen.

### Fixed

- The training streak now counts the days you actually trained. It derived each workout's
  day in UTC and then compared it against your device's local midnights, so depending on
  your timezone an evening or early-morning session could land on the wrong day and break
  or extend a streak that was intact. History and Statistics now answer "which day was
  that?" the same way, using the day the workout finished in local time.

## [1.2.0] - 2026-08-19

### Changed

- **A mixed session now runs as one workout instead of two.** Finishing the strength half
  no longer offers "Start EMOM" and "Finish session" as equal choices: the EMOM section
  takes the advance slot as "Next: EMOM", and ending there is demoted to a quiet "Finish
  early", matching the EMOM half's own early exit. Every strength card names its section
  ("Strength · Exercise 2 of 3 · EMOM next") so reaching the last exercise never reads as
  reaching the end, and the progress bar now spans both sections rather than filling to
  100% while a whole EMOM block is still ahead.

- **Mixed program details split into Strength and EMOM.** Opening a program that combines
  both now shows each half under its own heading, in the order the session trains them,
  with its own exercise count and time. Timed exercises are described by rounds, interval
  and work duration instead of the sets, reps and rest a timed step never had, and an
  exercise used in more than one EMOM section reports each section's own numbers.

### Removed

- **The vestigial `plan` object store is gone**, at an IndexedDB upgrade to database
  version 2. It was created by version 1 and never read or written, so opening an existing
  database simply drops it and new databases never create it — no data moves and nothing
  is lost. Backups keep working in both directions: exports no longer carry a `plan`
  section, and an older export file that still has one imports fine.

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

[Unreleased]: https://github.com/Workstr7blo/workstr-web/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Workstr7blo/workstr-web/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Workstr7blo/workstr-web/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Workstr7blo/workstr-web/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v1.0.0
[0.9.0]: https://github.com/Workstr7blo/workstr-web/releases/tag/v0.9.0
