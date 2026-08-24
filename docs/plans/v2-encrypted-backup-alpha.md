# v2.0-alpha Encrypted Backup Implementation Plan

> **Historical plan — superseded.** This records the issue sequence and design that led
> to the alpha; it is not the current wire contract. The shipped implementation replaced
> per-session/monthly records, manifest diffing, and per-record signer encryption with an
> account backup key, compressed AES-GCM envelopes, append-only device journals, and a
> V2-only namespace. See `docs/encrypted-sync-architecture.md` for the authoritative
> architecture and `CHANGELOG.md` for shipped behavior.

> Do not implement this plan issue-by-issue. It remains only as a decision-history record.

**Goal:** A signed-in Workstr-web user flips one **Auto-backup** toggle in Settings and every private training record is encrypted and backed up to the Workstr relay from then on, with no request, no approval, and no waiting.

**Architecture:** IndexedDB remains the source of truth. Workstr-web encrypts private records to the user's own pubkey with NIP-44, wraps them in addressable `kind:30078` events, and publishes them to the Workstr relay. The relay is open to every pubkey and runs a **write-policy plugin** that accepts only Workstr's own encrypted records, so it never becomes a general-purpose relay carrying other clients' notes.

**Tech Stack:** Vite/TypeScript PWA, IndexedDB via `idb`, `nostr-tools`, NIP-07/NIP-46 signer abstraction, Strfry, Caddy, NIP-44, NIP-78.

---

## What changed from the first draft of this plan

The first version gated the relay behind a 50-pubkey allowlist reached through a signed access API, and treated automatic sync as the final polish stage. Both are gone. Backup is open to anyone, admission does not exist, and automatic-on-a-toggle *is* the feature rather than its last milestone. The consequences are recorded here so nobody reintroduces them by accident:

- **No NIP-42.** It existed to enforce the allowlist and, optionally, to scope reads. Neither job remains: signatures already bind authorship, and open reads are accepted (below).
- **No access API, no NIP-98 request, no status endpoint, no allowlist file.** Deleted, not deferred.
- **Open reads are a deliberate trade.** Anyone may query the relay. Payloads are NIP-44 ciphertext so no training data leaks, but `d` tags are cleartext by design — an observer can enumerate which pubkeys back up, roughly how many sessions each holds, and when they train. Accepted; revisit only if that metadata becomes a real complaint.
- **The write policy is the only limiter.** With neither payment nor admission bounding anything, the kind + `d`-prefix filter, a per-pubkey quota, a total storage ceiling, and a block list are the whole defence.
- **The retention perk is dropped.** Mirroring users' public events to the relay is incompatible with a policy that rejects every kind but `30078`.
- **The paid fallback got more expensive.** Phase 2b must now *introduce* admission control rather than reuse it. That is the honest price of an open 2a and it is written down in `instruction.md` §Phase 2b.

## Policy

| Policy | Value |
|---|---:|
| Admission | None — open to every pubkey |
| User cap | None |
| Payment | None |
| Accepted kind | `30078` only |
| Accepted `d` prefix | `workstr:v1:` only |
| Relay AUTH | Not used |
| Reads | Open |
| Default quota | 50 MB/pubkey |
| Encryption | NIP-44 to the user's own pubkey |
| Relay URL | `wss://relay.workstr.fit:43736` |
| Source of truth | IndexedDB |

Admin tooling exists for blocking, debugging, status checks, and emergency fixes. There is no onboarding path for it to be an exception to.

## Issue sequence

Server work (1–3) must land before any real device test. Client work (4–8) can be built against the dev relay stack in parallel with 2 and 3. Issue 3 is a hard gate before anyone other than the operator turns the toggle on.

### Issue 1: Enforce the Workstr relay write policy

**Objective:** Make the relay accept Workstr encrypted records and nothing else.

**Scope:**
- strfry write-policy plugin.
- Accept an event only when `kind == 30078` **and** its `d` tag starts with `workstr:v1:`.
- Reject every other kind, `kind:1` included, with a clear `OK: false` message.
- No NIP-42, no allowlist, no author check beyond the signature strfry already verifies.

**Why the `d` prefix and not the kind alone:** `30078` is NIP-78 "arbitrary app data", a kind other clients publish too. Filtering on kind alone would let unrelated apps' data accumulate on the disk.

**Acceptance criteria:**
- A valid `kind:30078` with a `workstr:v1:` `d` tag is accepted from any pubkey.
- A `kind:1` note is rejected.
- A `kind:30078` with a foreign or missing `d` tag is rejected.
- Rejections return a readable message, not a silent drop.
- NIP-11 and WebSocket connectivity still work; reads are unaffected.

### Issue 2: Add relay abuse controls

**Objective:** Bound what an open relay can cost, since nothing else does.

**Scope:**
- Per-pubkey storage quota, enforced in the policy plugin (default 50 MB), which needs per-author accounting rather than a stateless check.
- Total storage ceiling with an alert well before the disk fills.
- Block list: a blocked pubkey's writes are rejected.
- Admin commands: block, unblock, status, list, per-pubkey usage.

**Acceptance criteria:**
- A pubkey over quota is rejected with a readable message; one under it is accepted.
- A blocked pubkey cannot write; unblocking restores it.
- Usage is inspectable per pubkey and in total.
- The alert fires against a threshold, not on a full disk.
- No secrets or private infrastructure paths are logged.

### Issue 3: Add relay backup and restore baseline

**Objective:** Protect encrypted backup data before anyone relies on it. **Hard gate before inviting users** — a toggle labelled backup that loses data is worse than no toggle.

**Scope:**
- Nightly LMDB snapshot, off-machine copy, retention policy.
- Back up the policy plugin's state and relay config that is safe to store.
- Restore runbook.

**Acceptance criteria:**
- A backup is created on schedule and lands off-machine.
- The restore procedure is documented.
- One restore test is performed before anyone but the operator enables the toggle.
- Secrets and raw private keys are excluded.

### Issue 4: Implement `kind:30078` encrypted codecs

**Objective:** Add pure private-record event encoding and decoding.

**Files likely touched:** `src/nostr/codecs30078.ts`, `src/sync/addresses.ts`, related tests.

**Record addresses:**
- `workstr:v1:sheet:<slug>`
- `workstr:v1:session:<uuid>`
- `workstr:v1:bodyweight`
- `workstr:v1:settings`
- `workstr:v1:manifest`

> Superseded after the alpha: sessions are written as `workstr:v1:sessions:<YYYY-MM>`, one
> record per training month, with `-p2`, `-p3` … when a month outgrows one event. A signer
> round trip per session made a first sync unusably slow. `workstr:v1:session:<uuid>` is
> still read, and is still what a deletion tombstone uses. See `src/sync/records.ts`.

**Acceptance criteria:**
- Round-trip tests pass with a fake signer.
- Every emitted `d` tag carries the `workstr:v1:` prefix the relay policy requires.
- Missing `d` tag, wrong client tag, unknown address, and decrypt failures are handled safely.
- Ciphertext/plaintext is not logged.

### Issue 5: Add the sync queue, manifest, and first-run backfill

**Objective:** Track what needs uploading — including everything that already exists.

**Scope:**
- Queue changed record addresses.
- **First-run backfill:** enabling the toggle enqueues every existing session, sheet, body-weight entry and synced setting, not just subsequent changes.
- Build manifest record.
- Compare `updated_at` with last-write-wins semantics.
- Represent deletions as tombstones.

**Acceptance criteria:**
- Enabling backup on a populated database enqueues the whole history exactly once.
- Backfill is resumable and does not restart from zero after an interruption.
- Session, sheet, bodyweight and settings changes enqueue correct addresses.
- Local writes succeed when backup is off or the device is offline.
- Queue entries are not dropped until relay publish succeeds.

### Issue 6: Push encrypted records to the Workstr relay

**Objective:** Upload queued encrypted records.

**Scope:**
- Publish signed `kind:30078` events; no AUTH handshake.
- Require relay `OK` acknowledgement.
- Clear queue entries only after an accepted publish.
- Surface a policy rejection distinctly from a network failure — they need different user copy and different retry behaviour.

**Acceptance criteria:**
- A test pubkey publishes successfully and can query the event back.
- A policy-rejected event does not silently vanish from the queue.
- Offline and relay failures preserve the queue.
- Backfill of a large history completes without blocking the UI.

### Issue 7: Pull, decrypt, and merge records from the relay

**Objective:** Restore private records on another device.

**Scope:**
- Query `authors:[pubkey]`, `kinds:[30078]`.
- Decrypt through the signer abstraction.
- Merge into IndexedDB by record address and `updated_at`.
- Skip corrupt or undecryptable events with a visible warning.

**Acceptance criteria:**
- An empty IndexedDB restores from the relay.
- Older remote records do not overwrite newer local records; newer ones do update.
- Tombstones are applied safely.
- Lazy decryption keeps NIP-46 round-trips off the critical path.

### Issue 8: Add the Auto-backup toggle and automatic sync

**Objective:** The whole user-facing feature: one toggle, then it just works.

**Files likely touched:** `src/features/backup/views.ts` (new), `src/app/layout.ts`, `src/app/state.ts`, `src/app/shell.ts`, `src/sync/engine.ts`, related tests.

**Scope:**
- An **Auto-backup** toggle in the existing Settings → Backup panel, beside JSON export/import. Backup is a data-durability control and does not belong in `features/support/`.
- Flipping it on while signed out routes through sign-in first — the one unavoidable step.
- Flipping it on triggers the Issue 5 backfill, then continuous sync.
- Sync on app open and after local changes, with backoff on failure.
- A status line: pending count, last-sync time, and a readable error state.
- Manual "sync now" as a fallback, not the normal path.
- Flipping it off stops syncing and leaves both sides intact; it does not delete relay data.

**Acceptance criteria:**
- A signed-out user flipping the toggle is taken through sign-in and lands with backup on.
- Offline logging works normally; pending changes upload after reconnect.
- Sync errors are visible but never block training.
- The Workstr relay is never mixed into the catalog or public write relay sets, and never appears in the user's `kind:10002`.
- Turning backup off and on again does not duplicate records.

### Issue 9: Run phone-to-laptop QA

**Objective:** Prove the full product loop on real devices.

**Checklist:**
1. Phone signs in and flips Auto-backup on.
2. Existing history backfills to the relay.
3. Phone logs a new workout; the encrypted event appears on the relay.
4. Laptop starts with empty local data for that identity.
5. Laptop signs in with the same pubkey and restores the workout.
6. Offline logging still works; reconnect uploads pending changes.
7. A `kind:1` publish aimed at the Workstr relay is rejected by the write policy.
8. A second app's `kind:30078` (foreign `d` prefix) is rejected.

**Acceptance criteria:**
- Phone → relay → laptop works with no operator action at any point.
- No plaintext private training data leaves the browser.
- The relay carries Workstr encrypted records and nothing else.
- The relay has working, restore-tested backups.
