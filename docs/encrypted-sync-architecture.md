# Encrypted sync architecture

Status: shipped on `main` (record format 5). This document is the authoritative protocol
description for Workstr's current private-data sync. It supersedes the per-record,
per-session, monthly-bundle, and manifest proposals retained in older issues and plans.

## Product contract

- IndexedDB remains the source of truth. Sync is an encrypted replica and never blocks
  local training.
- Sync is optional, open to every signed-in pubkey, and uses one Workstr relay. There is
  no admission API, allowlist, NIP-42 flow, subscription, or client-side gate.
- The relay receives signed `kind:30078` events whose `d` tag begins `workstr:v2:`. It
  rejects retired `workstr:v1:` records and every other kind or prefix.
- Older workouts present before the V2 era remain local and in JSON export. Workouts
  created in the V2 era participate in encrypted sync.
- The signer owns identity and never exposes a private key to Workstr.

## Key and envelope

Each account has one random 256-bit backup key. The client asks the user's signer to
NIP-44-wrap or unwrap that key to the account pubkey. The wrapped key is stored at
`workstr:v2:key`; the usable key is cached only in the account's local IndexedDB.

New wrapped-key events and encrypted records also carry a non-secret, domain-separated
SHA-256 fingerprint of that key. Fingerprint-free records from older releases remain
valid. A declared mismatch pauses uploads before any record is written; it never rotates
or overwrites a key. A previously synced device may republish its cached key only when
older readable or seen records establish that key as the known-good lineage.

Private payloads are canonical JSON, compressed with gzip when that makes them smaller,
and encrypted locally with AES-256-GCM. The binary envelope authenticates its version,
compression mode, author pubkey, and record address, so ciphertext cannot be moved to a
different account or address undetected. The signer signs the outer NIP-78 event but is
not asked to encrypt or decrypt every record. This keeps restore practical with NIP-46.

## Record vocabulary

Replaceable object records use stable addresses where replacement is desirable:

- `workstr:v2:sheet:<slug>`
- `workstr:v2:exercise:<slug>`
- `workstr:v2:settings`
- `workstr:v2:key`

Append-heavy data uses immutable, device-owned journal chunks:

- `workstr:v2:log:<device>:<sequence>` for workout entries and deletions
- `workstr:v2:body:<device>:<sequence>` for body-weight entries and deletions

A journal entry contains a stable object UID, update timestamp, payload or tombstone,
and ordering information supplied by its device and chunk. A sealed chunk is not
rewritten during ordinary sync. The active tail may be republished until sealed.

## Write and restore flow

1. A local change commits to IndexedDB first.
2. Replaceable objects enter `sync_queue`; workout and body changes enter their local
   journal.
3. A sync pass fetches unknown V2 events, decrypts them with the cached account key, and
   merges them into IndexedDB.
4. The pass publishes queued objects and journal tails. Payloads are packed against the
   tested signer/relay byte budget, compressed, encrypted, signed, and only marked sent
   after relay acknowledgement.
5. Event IDs already processed are recorded incrementally. Later passes fetch and open
   only records the device has not seen.

Journal replay chooses the newest valid entry for each UID using deterministic ordering.
A winning tombstone deletes that object; replaying the same records is idempotent. Since
each device appends to its own sequence, concurrent devices do not replace one another's
unseen changes.

## Chunking and compaction

Chunks are sized using the sealed payload's actual byte count, under
`MAX_CHUNK_CONTENT_BYTES`, leaving headroom for the signed NIP-46 request. A single entry
that exceeds the budget is surfaced as a publish failure rather than silently dropped.

Sealed chunks are immutable in normal operation. Compaction is allowed only for a
device's own sequence and only when superseded entries justify it. Restore does not rely
on a separate manifest or snapshot generation: the account key removes per-record signer
round trips, compression reduces transfer size, and the seen-event ledger makes routine
restore incremental.

## Cutover and compatibility

`workstr:v1:*` is obsolete. The engine removes stale V1 queue entries, normal restore
ignores V1 relay records, and the relay policy rejects new V1 writes. The cutover does not
backfill pre-era workout history. JSON export/import remains the complete manual archive;
an explicit JSON import joins the current backup era without replaying the exporting
device's internal sync queue.

## Operational invariants

- Never log plaintext, ciphertext, account keys, signer secrets, or private keys.
- Never report a record synced before an accepted relay acknowledgement.
- Never mix the Workstr relay into catalog relays, public write relays, or a user's
  `kind:10002` relay list.
- Keep per-pubkey quota, total storage ceiling, alerting, blocklist, and off-machine LMDB
  backups operational.
- Restart the full relay stack when changing its write-policy deployment.

## Verification owners

The implementation map and test owners live in `MODULES.md`. The baseline is
`npm run check`; relay integration additionally requires the opt-in integration suite and
the real-device/real-relay checks in `docs/RELEASE-QA.md`.
