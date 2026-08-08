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

## 6. Data safety

- [ ] **Round trip.** Export JSON, clear site data, import. Library, programs, history and
      body log all return.
- [ ] **Cross-device.** Export from the phone, import on desktop. Same result.

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

**A release is blocked** by any failure in sections 1, 3, 4, 5 or 6. Section 2 failures on
a non-primary browser are recorded, not blocking. Section 0 failing means stop and fix the
deploy before testing anything else.
