# Release QA pass

The checks that automation cannot reach: real device, real signer app, real relays, real
network failure. Run it against the **deployed site**, not a dev server, before tagging a
release.

Every line states an expected result, so a failure is unambiguous. If a line is unclear
when you get to it, fix the line — a checklist you have to interpret is not a checklist.

**Time:** about an afternoon. **You need:** an iPhone, a desktop browser with a NIP-07
extension, a NIP-46 signer (Amber), and a second Nostr client (Damus, Primal or Amethyst).

---

## 0. Preconditions

- [ ] `npm test` green, `npm run build` clean.
- [ ] The commit under test is deployed and live at app.workstr.fit.
- [ ] Settings shows the expected version string (this proves you are testing what you
      think you are testing — do this first, not last).

## Already covered by automation — do not redo by hand

The unit suite and the headless-Chromium driver cover these. They are listed so nobody
spends the afternoon re-testing them:

- Seed applies on a fresh profile: 10 exercises, 3 programs, rows resolved.
- Reload does not duplicate or re-seed; a deleted starter stays deleted.
- Sign-in from a seed-only profile adopts silently, with no conflict prompt.
- Import-state resolution: seeded entries report "In library", republished ones "Update".
- Recovery maths, stats, unit conversion, equipment matching, catalog parsing.
- **History (v1.3):** local-date keying, month grids across year and leap-day boundaries,
  active-week streaks, day grouping and selection, calendar markup and accessible names,
  repeat-workout seeding and refusals, and the JSON round trip. The headless driver also
  covers 320/390/768/1280 layouts, keyboard operation, offline, and deletion refresh.
  The full suite is run under eight timezones (see below) — do not redo any of this by hand.

---

## 1. iOS PWA — the highest-risk surface

Nothing in CI touches iOS. Do this section on a real iPhone, not a simulator.

- [ ] **Install.** Safari → Share → Add to Home Screen. Icon is the Workstr mark on an
      opaque background — no white letter tile, no transparency artefacts.
- [ ] **Launch.** Opens standalone: no Safari chrome, no address bar.
- [ ] **Safe areas.** Nothing is clipped by the notch or the home indicator, portrait and
      landscape.
- [ ] **Offline cold start.** Enable airplane mode, force-quit, relaunch from the home
      screen icon. App opens and the library and starter programs are all present.
- [ ] **Offline training.** Still in airplane mode, train a full seeded program: start,
      log every set, rest timer runs, finish and review. This is what the starter seed
      exists for — if only one line in this document gets run, make it this one.
- [ ] **Wake lock.** During a live session the screen does not sleep. If wake lock is
      unavailable, the no-sleep video fallback takes over and the screen still stays on.
- [ ] **Backgrounding.** Leave the app mid-session, take a call or switch apps for a
      minute, come back: the session is intact, the timer reflects real elapsed time.
- [ ] **Storage survival.** Reopen the next day: data still there. (iOS evicts IndexedDB
      for PWAs it considers unused after ~7 days — worth knowing, not worth blocking on.)

## 2. Desktop browser

- [ ] Chrome and Firefox: install as a PWA, train a session, no console errors.
- [ ] Safari on macOS if available — it is the engine closest to iOS.
- [ ] Offline: DevTools → Network → Offline, reload. App renders from cache.

## 3. Signers

The headless driver injects a fake `window.nostr`; none of this is covered.

- [ ] **NIP-07.** Sign in with a real extension (Alby or nos2x). Settings shows
      `connected` and your npub.
- [ ] **NIP-46 by URI.** Connect Amber with a `bunker://` string. Signing succeeds.
- [ ] **NIP-46 by QR.** Connect by scanning. Same result.
- [ ] **Latency.** Time a summary publish end to end with Amber. Record the number below.
      The client allows 120 s for approval; if the real figure is anywhere near that,
      raise it as an issue rather than quietly accepting it.
- [ ] **Decline.** Reject the signing request in the signer. The app reports the failure
      and returns to a usable state — no spinner left running, no half-published note.
- [ ] **Signer unavailable.** Sign in, then remove the extension or kill Amber, then try
      to publish. Failure is reported honestly.

## 4. Accounts and adoption

Path 1 (empty target) is automated. These two are not.

- [ ] **Occupied target.** On a device with local training data, sign in to an identity
      that already has data on that device. The conflict modal appears and offers both
      choices. Pick "keep device" — device data wins, account data is untouched on disk.
- [ ] **Repeat with the other choice** on a fresh profile: account data wins.
- [ ] **Sign out.** Returns to the anonymous account with its data intact; signing back in
      does not prompt again.
- [ ] **Remove account data.** Removes that identity's database and returns to anonymous.
      Local data survives.

## 5. Network and relays

- [ ] **All relays unreachable.** Block the relay hosts (airplane mode after a successful
      first load, or a hosts-file block). Discover renders the cached snapshot and the
      status says so — it must never claim the catalog is empty.
- [ ] **Never-connected install.** Fresh profile with no network at all: Discover shows an
      honest "cannot reach the catalog" state, and the seeded library and programs still
      work.
- [ ] **Publish for real.** Publish a workout summary, then find it in Damus, Primal or
      Amethyst. Text is readable, the muscle map renders when the program has one, and the
      note is attributed to your npub.
- [ ] **Publish failure.** With relays blocked, attempt a publish. The UI reports failure
      and does **not** mark the session as shared.
- [ ] **Catalog update.** Republish one catalog entry from self-hosted Workstr. Discover
      moves it from "In library" to "Update"; applying the update does not clobber a
      locally edited copy.

## 5b. Workout history (from v1.3)

Automation covers the layout, the maths and the flow. These are the parts it cannot reach:
a real thumb, a real screen reader, and a device whose clock is not the build machine's.

- [ ] **Thumb targets.** On the iPhone, tap five different calendar days without mis-hitting
      a neighbour. Cells are 38px on the narrowest supported layout — if they feel cramped
      in the hand, that is a finding even though it passes the automated check.
- [ ] **VoiceOver.** Swipe through the calendar. Each day announces its full date and either
      its workout and set count or "no workout"; today announces as today; days with nothing
      to open are skipped by the rotor rather than announced as empty buttons.
- [ ] **A real late-night workout.** Train (or finish) a session after 23:00 local. It lands
      on that day, not tomorrow, in both the calendar and the timeline heading.
- [ ] **Travel.** Change the phone's timezone by more than a day boundary, reopen History,
      and confirm no workout jumps to an adjacent date.
- [ ] **Repeat on device.** Repeat a real completed workout: the exercises, order and
      structure match, last time's weights are pre-filled, nothing shows as already logged,
      and the source session in History is unchanged afterwards.
- [ ] **Repeat an EMOM and a superset**, not just a straight-sets session.

## 6. Data safety

- [ ] **Round trip.** Export JSON, clear site data, import. Library, programs, history and
      body log all return.
- [ ] **Cross-device.** Export from the phone, import on desktop. Same result.

## 6b. Encrypted sync (from v2.0-alpha)

Needs **two real devices and a real signer**. Everything else about sync is covered by
automation (see the evidence section below); this section exists for what a browser driver
and an integration suite cannot reach — a real NIP-46 signer round trip on a phone, an
installed PWA that has been backgrounded, and a genuinely offline radio.

- [ ] **Turning it on.** Phone, signed out, Settings → Data & Sync → Sign in to sync.
      Sign-in is offered, and Auto-sync is on after the identity flow completes.
- [ ] **First sync and era boundary.** Eligible programs/settings upload and the status
      settles on "up to date". Workouts completed before the V2 era remain local-only,
      their count is shown calmly, and JSON export includes them. No V1 or monthly record
      is published.
- [ ] **A new workout.** Log one on the phone; within a minute the status line says the
      sync is current. It uploads after the workout finishes, not after every set.
- [ ] **Restore.** Laptop, same identity, no local data for it. Sign in, turn Auto-sync
      on, and the phone's synced programs, V2-era history, body log and unit preference
      come back. Local-only pre-era history is not invented on the laptop.
- [ ] **Offline.** Put the phone in airplane mode, log a full workout. Nothing blocks, and
      no error interrupts training. Restore the network; pending changes upload.
- [ ] **NIP-46 specifically.** A remote signer sleeps and the tab is backgrounded. Sync
      reports a readable error rather than hanging, reconnects, and does not repeatedly
      ask for approval while a workout is running.
- [ ] **Off is off.** Turn Auto-sync off, log a workout, confirm nothing new reaches the
      relay (`relay-admin usage <pubkey>` does not grow), and that turning it back on does
      not duplicate anything.

## 7. Support surface (from v1.0)

Skip until the support screen ships.

- [ ] Lightning address and QR render; the QR scans correctly in a wallet.
- [ ] A real zap to the operator npub appears in the funding panel within a minute.
- [ ] The published monthly cost figure shown is current.

---

## Sign-off

| Field | Value |
|---|---|
| Version tested | |
| Date | |
| iPhone model / iOS version | |
| Desktop browser(s) | |
| NIP-46 signing latency (observed) | |
| Failures found | |
| Tagged? | |

**A release is blocked** by any failure in sections 1, 3, 4, 5, 5b or 6. Section 2 failures
on a non-primary browser are recorded, not blocking. Section 0 failing means stop and fix
the deploy before testing anything else.

---

## Automated evidence: v1.3 workout history

Recorded so the next release can tell what was actually proven rather than assumed.

**Suite.** 370 tests across 30 files, green under eight timezones spanning UTC+14 to
UTC-11, including a 45-minute offset and southern-hemisphere DST:

```bash
for tz in UTC Pacific/Kiritimati Pacific/Niue America/New_York \
          Europe/Berlin Australia/Sydney Asia/Kathmandu America/Santiago; do
  TZ=$tz npx vitest run
done
```

**Headless Chromium, production build**, against a fixture of 16 completed sessions
covering normal, superset and EMOM shapes, a legacy row with no recorded exercises, a
23:00 session, and a dense mid-month stretch:

| Check | Result |
|---|---|
| No horizontal scroll at 320 / 390 / 768 / 1280 | pass; smallest touch target 38px at 320 |
| Calendar day reachable and operable by keyboard | pass; `Enter` selects, focus outline solid |
| States legible without colour | pass; dots, `aria-current`, disabled future days |
| 23:00 workout stays on today | pass |
| Multi-workout day expands with detail and repeat | pass; delete stays behind its disclosure |
| Repeat opens a clean session | pass; 0 logged rows, elapsed `00:00` |
| History and repeat work offline, signed out | pass; 14 days, 16 cards with the network cut |
| Signed out blocks publish, never repeat | pass |
| Deleting a session refreshes the calendar and cards | pass |

Zero uncaught page errors throughout.

**iPhone device profiles** (Chromium with the real viewport, DPR and touch emulation —
not a substitute for section 1, which still needs a physical device and Safari's engine):

| Profile | Viewport | Result |
|---|---|---|
| iPhone SE | 320x568 | pass; 38px day targets, no overflow, tap-through to Repeat works |
| iPhone 12 Mini | 375x629 | pass |
| iPhone 13 | 390x664 | pass; whole calendar grid above the fold |
| iPhone 14 Pro Max | 430x740 | pass |

Checked per profile: no horizontal overflow, day and month-nav targets at least 24px,
summary-card labels not clipped, month title on one line, tap to filter a day, tap to
expand a card, tap to repeat opening a clean session, and the session footer inside the
viewport. This pass is what caught the over-long History intro line burying the calendar
below the fold on short screens.

**Deliberately deferred** — non-goals in the v1.3 issues, not oversights:

- Year or multi-year heatmap, and monthly recap (#43, #41).
- Free-text history search (#38).
- Saving a repeated workout as a reusable Program, and automatic progressive overload (#42).
- Virtualisation of long histories. A 600-session fixture renders one month and one day at
  a time, so there is no measured evidence it is needed; #38 says not to do it without.
- The "unfinished session already exists" guard on repeat is covered by unit test, not the
  browser driver: the live-session overlay is fullscreen, so the path is not reachable by
  ordinary navigation.

---

## Required evidence: v2.0-alpha encrypted sync

The 2026-08-20 V1 policy drill is historical and does not validate the current V2
namespace. Before a release, run the following against the **production relay**, record
the date in sign-off, remove the throwaway event, and rebuild the usage ledger if the
verification changed it.

**The relay's own policy** — verified by publishing directly at it and reading the NIP-20
reason back:

| Case | Result |
|---|---|
| `kind:30078` with a valid `workstr:v2:` `d` tag | accepted |
| `kind:30078` with a `workstr:v1:` `d` tag | rejected |
| `kind:1` note | rejected — *"this relay only stores Workstr encrypted sync records"* |
| `kind:30078` with a foreign `d` prefix | rejected |
| `kind:30078` with no `d` tag | rejected |
| Blocked pubkey | rejected, and restored by `unblock` without a restart |
| Over quota | rejected — *"storage quota reached (…). Existing records are kept"* |

Record the event id and cleanup result. A local policy unit test is not evidence that the
deployed relay is running the same policy.

**The client loop** — `tests/sync-relay.integration.test.ts` run with
`WORKSTR_TEST_RELAY=wss://relay.workstr.fit:43736`: all six must be green. The suite covers
an encrypted V2 event on the wire, account isolation, a full phone → relay → laptop
restore, policy rejection, queue drain, and offline logging uploading after reconnect.
Section 6b adds the real-device and signer surface around that sync logic.

**What automation could not reach.** Browser WebSockets to the relay are blocked in the
build sandbox, so the headless pass drives the UI (toggle, sign-in routing, status line,
errors not blocking training, state surviving reload) but never completes a real relay
round trip in a browser. That gap is exactly section 6b.

All test data was deleted afterwards and the ledger rebuilt; the relay was left at zero
events, zero authors, zero blocked.
