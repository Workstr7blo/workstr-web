# v2.0-alpha Encrypted Backup Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan issue-by-issue. This plan implements `docs/instruction.md` Phase 2a-alpha; if it conflicts with `docs/instruction.md`, `docs/instruction.md` wins.

**Goal:** Let a signed-in Workstr-web user opt into encrypted training-data backup automatically while the private alpha has fewer than 50 admitted pubkeys.

**Architecture:** IndexedDB remains the source of truth. Workstr-web encrypts private records to the user's own pubkey with NIP-44, wraps them in addressable `kind:30078` events, and syncs them to the Workstr relay after NIP-42 AUTH. A small access service verifies signed opt-in requests, applies the 50-pubkey alpha cap, and updates the relay allowlist; no payment or manual approval is part of the alpha path.

**Tech Stack:** Vite/TypeScript PWA, IndexedDB via `idb`, `nostr-tools`, NIP-07/NIP-46 signer abstraction, Strfry, Caddy, NIP-42, NIP-44, NIP-78, NIP-98-style HTTP auth events.

---

## Non-goals

- No paid access flow, invoice flow, subscription language, or premium tier.
- No generic public relay service.
- No raw `nsec` handling in Workstr-web.
- No server plaintext access to workouts, sets, programs, bodyweight, or settings.
- No custom user relay UI in this alpha; the Workstr relay is the target.

## Alpha policy

| Policy | Value |
|---|---:|
| Admission | Automatic signed opt-in |
| User cap | 50 pubkeys |
| Payment | None |
| Manual approval | None for normal onboarding |
| Default quota | 50 MB/pubkey |
| Private record kind | `30078` |
| Encryption | NIP-44 to the user's own pubkey |
| Relay URL | `wss://relay.workstr.fit:43736` |
| Source of truth | IndexedDB |

Admin tooling may exist for blocking, debugging, status checks, and emergency fixes. It is not the normal onboarding path.

## Issue sequence

### Issue 1: Document v2 encrypted backup alpha

**Objective:** Make the private-alpha decision durable before implementation.

**Files:**
- Modify: `docs/instruction.md`
- Modify: `ROADMAP.md`
- Create: `docs/plans/v2-encrypted-backup-alpha.md`

**Acceptance criteria:**
- `docs/instruction.md` states that Phase 2a-alpha uses automatic signed opt-in with a 50-pubkey cap.
- `ROADMAP.md` has a concise v2.0-alpha milestone summary.
- This plan exists and contains the executable breakdown.
- No private host paths, local machine folders, or secret locations are published.

### Issue 2: Add relay access model and admin tooling

**Objective:** Create the relay-side access state used by both automation and emergency operator actions.

**Scope:**
- Access list data model with pubkey, source, quota, creation time, optional expiry, and block state.
- Atomic updates.
- Admin commands for allow, block, status, and list.

**Acceptance criteria:**
- A pubkey can be added, blocked, listed, and inspected.
- Blocked pubkeys cannot be re-added by self-serve access.
- The 50-user cap and 50 MB default quota are configurable.
- The implementation does not log secrets or private infrastructure paths.

### Issue 3: Enforce NIP-42 relay allowlist policy

**Objective:** Make the relay accept Workstr sync traffic only from admitted pubkeys.

**Scope:**
- Require NIP-42 AUTH.
- Verify authenticated pubkey against the access model.
- Reject blocked or non-admitted pubkeys.
- Require event author to match authenticated pubkey.
- Prefer accepting only Workstr private-sync events for this relay path.

**Acceptance criteria:**
- Non-admitted pubkey cannot publish private sync events.
- Admitted pubkey can publish a valid `kind:30078` event.
- Mismatched authenticated pubkey and event author is rejected.
- NIP-11 and WebSocket relay connectivity still work.

### Issue 4: Add relay backup and restore baseline

**Objective:** Protect encrypted backup data before inviting alpha users.

**Scope:**
- Nightly relay data backup.
- Backup access state and relay config that is safe to store.
- Off-machine copy.
- Retention policy.
- Restore runbook.

**Acceptance criteria:**
- A backup is created on schedule.
- A restore procedure is documented.
- One restore test is performed before alpha invites.
- Secrets and raw private keys are excluded.

### Issue 5: Add self-serve signed access API

**Objective:** Let signed-in users admit themselves while the alpha cap has room.

**Endpoints:**
- `GET /api/status/<pubkey>`
- `POST /api/access`

**Rules:**
- Verify Nostr signature.
- Require request pubkey to match signed event pubkey.
- Require a recent timestamp.
- Require matching URL and HTTP method tags.
- Reject blocked pubkeys.
- Reject new pubkeys when 50 admitted pubkeys already exist.
- Be idempotent for already-admitted pubkeys.

**Acceptance criteria:**
- Valid signed request creates access.
- Invalid, stale, mismatched, blocked, and capacity-full requests return structured errors.
- Status endpoint reports allowed/blocked/full/quota state.

### Issue 6: Add Workstr-web encrypted backup UI shell

**Objective:** Show backup status without syncing data yet.

**Files likely touched:**
- `src/nostr/pool.ts`
- `src/nostr/access.ts`
- `src/features/support/views.ts`
- `src/app/state.ts`
- `src/app/shell.ts`
- related tests

**Acceptance criteria:**
- Signed-out users are prompted to sign in before enabling backup.
- Signed-in users can see access status.
- Alpha-full and error states are human-readable.
- The Workstr relay is not mixed into catalog or public write relay sets.

### Issue 7: Implement client access request flow

**Objective:** Let Workstr-web request encrypted backup access through the signer abstraction.

**Scope:**
- Build NIP-98-style access request event.
- Sign through NIP-07/NIP-46 abstraction.
- POST request to access API.
- Refresh status after response.

**Acceptance criteria:**
- No raw key handling.
- NIP-07 and NIP-46 use the same signer interface.
- Failure states remain non-blocking.
- Sync does not start until status is allowed.

### Issue 8: Implement `kind:30078` encrypted codecs

**Objective:** Add pure private-record event encoding and decoding.

**Files likely touched:**
- `src/nostr/codecs30078.ts`
- `src/sync/addresses.ts`
- related tests

**Record addresses:**
- `workstr:v1:sheet:<slug>`
- `workstr:v1:session:<uuid>`
- `workstr:v1:bodyweight`
- `workstr:v1:settings`
- `workstr:v1:manifest`

**Acceptance criteria:**
- Round-trip tests pass with a fake signer.
- Missing `d` tag, wrong client tag, unknown address, and decrypt failures are handled safely.
- Ciphertext/plaintext is not logged.

### Issue 9: Add local sync queue and manifest

**Objective:** Track pending outbound private records and remote/local freshness.

**Scope:**
- Queue changed record addresses.
- Build manifest record.
- Compare `updated_at` with last-write-wins semantics.
- Represent deletions as tombstones.

**Acceptance criteria:**
- Session, sheet, bodyweight, and settings changes enqueue correct addresses.
- Local writes succeed when sync is disabled or offline.
- Queue entries are not dropped until relay publish succeeds.

### Issue 10: Push encrypted records to the Workstr relay

**Objective:** Upload queued encrypted records after access is allowed.

**Scope:**
- Handle relay AUTH challenge.
- Publish signed `kind:30078` events.
- Require relay `OK` acknowledgement.
- Clear queue only after accepted publish.

**Acceptance criteria:**
- Admitted test pubkey publishes successfully.
- Non-admitted test pubkey receives a clear failure.
- Accepted event can be queried back.
- Offline/relay failures preserve the queue.

### Issue 11: Pull, decrypt, and merge records from relay

**Objective:** Restore private records on another device.

**Scope:**
- Query by `authors:[pubkey]` and `kinds:[30078]`.
- Decrypt through signer abstraction.
- Merge into IndexedDB by record address and `updated_at`.
- Skip corrupt or undecryptable events with a visible warning.

**Acceptance criteria:**
- Empty IndexedDB can restore from relay.
- Older remote records do not overwrite newer local records.
- Newer remote records update local records.
- Tombstones are applied safely.

### Issue 12: Add automatic sync and resilient UX

**Objective:** Make encrypted backup behave like a background backup feature.

**Scope:**
- Sync on app open when access is allowed.
- Sync after local changes.
- Retry with backoff.
- Show pending count and last-sync timestamp.
- Keep a manual “sync now” action.

**Acceptance criteria:**
- Offline logging works normally.
- Pending changes upload after reconnect.
- Sync errors are visible but non-blocking.
- Local-first behavior is preserved.

### Issue 13: Run phone-to-laptop alpha QA

**Objective:** Prove the full product loop on real devices.

**Checklist:**
1. Phone signs in.
2. Phone enables encrypted backup.
3. Access is granted automatically.
4. Phone logs a real workout.
5. Encrypted event exists on relay.
6. Laptop starts with empty local data for that identity.
7. Laptop signs in with the same pubkey.
8. Laptop restores and displays the workout.
9. Offline logging still works.
10. Reconnect uploads pending changes.

**Acceptance criteria:**
- Phone → relay → laptop works without manual operator action.
- No plaintext private training data leaves the browser.
- The relay has working backups.
