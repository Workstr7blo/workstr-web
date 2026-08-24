# Workstr relay backup and restore

The relay stores users' encrypted sync records. Once Auto-sync is open to anyone, it may
hold the only remote copy of data a user believes is safe — so host-level backup and
restore must exist before the control does. Sync that loses data is worse than no sync.

Two scripts, one on each side:

| Script | Runs on | Does |
|---|---|---|
| `relay-snapshot.sh` | the relay host | writes one snapshot to stdout as a tar stream |
| `pull-relay-backup.sh` | the backup host | pulls it, verifies it, rotates old ones |

## Why the backup host pulls

The relay never holds a credential for the backup store. A relay that is compromised can
serve bad data, but it cannot reach, rewrite or delete the copies already taken — which is
the failure this is actually protecting against. The direction is the security property,
not a convenience.

## What is in a snapshot

- `events.jsonl.gz` — every event, from `strfry export`. A consistent read against a live
  relay, portable across an LMDB format change, and `strfry import` verifies every
  signature on the way back in, so a tampered archive cannot quietly restore.
- `config/` — `strfry.conf`, `write-policy.mjs`, the strfry `Dockerfile`, `compose.yaml`
  and the `Caddyfile`. An allowlist, never a directory sweep.
- `policy-state/` — present once the write policy keeps quota and block-list state
  (issue #2). Losing it would silently reset every limit.
- `manifest.txt` — timestamp, event count, SHA-256 of the event archive, strfry version,
  and the checksum of the deployed policy plugin.

**Deliberately excluded:** `.env` (VPN credentials), `acme/` and `caddy/data` (the ACME
account key and issued certificate private keys). Certificates are reissued on restore;
private keys must not travel. The allowlist is what keeps a future file in that directory
from being swept up by accident.

## Install

On the relay host, put `relay-snapshot.sh` in a `backup/` directory beside the relay's
`compose.yaml`, mode 755. It takes its paths from its own location, so nothing else needs
configuring in the normal layout.

On the backup host, put `pull-relay-backup.sh` somewhere outside the repo and give it an
environment file, mode 600 — it names the relay's ssh target and this machine's paths, so
it does not belong in git:

```sh
RELAY_SSH=<user>@<relay-host>
SNAPSHOT_CMD=<path to relay-snapshot.sh on the relay host>
BACKUP_DIR=<where snapshots are kept on this machine>
DAILY_KEEP=7
WEEKLY_KEEP=4
```

The backup host needs key-based ssh to the relay host; the relay needs nothing.

Schedule it nightly, off the hour, logging to a file:

```
17 3 * * * set -a; . <env file>; set +a; <path>/pull-relay-backup.sh >> <backup dir>/cron.log 2>&1
```

Test it under cron's environment before trusting it — a minimal `PATH` and no interactive
shell is where scripts like this usually break:

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh -c 'set -a; . <env file>; set +a; <path>/pull-relay-backup.sh'
```

## Retention

Seven nightly snapshots, plus one promoted copy a week kept for four weeks — about a month
of history. A fault noticed within a day is covered by the dailies; one that goes unnoticed
past a week is still recoverable from a weekly after the dailies have rotated away.

Old snapshots are pruned **only after** a new one has landed and been verified. A failed
pull leaves the existing set untouched and exits non-zero, so cron reports it.

## Verification

Every pull checks the archive before accepting it: it must untar, carry a manifest and a
non-empty event archive, pass `gzip -t`, and match the SHA-256 the relay recorded. It is
written under a temporary name and renamed only once all of that passes, so an interrupted
transfer can never be mistaken for a good snapshot.

## Restore

Restoring is `strfry import`, which verifies every signature. Nothing here needs the app.

1. Bring up a strfry with the config from `config/strfry.conf` and an **empty** database.
2. Unpack the snapshot and decompress the events:

   ```sh
   tar -xf <snapshot>.tar -C <workdir>
   gzip -dc <workdir>/events.jsonl.gz > <workdir>/events.jsonl
   ```

3. Import them:

   ```sh
   strfry --config=<config> import < <workdir>/events.jsonl
   ```

   Expect `N added, 0 rejected`. A non-zero rejected count means events failed signature
   verification — stop and use an older snapshot rather than accepting partial data.

4. Confirm the restore rather than assuming it: export from the restored relay and compare
   event ids against the archive. Counts alone do not prove the right events came back.
5. Redeploy `write-policy.mjs` from `config/` and check its SHA-256 against `manifest.txt`
   before opening the relay to writes. A relay restored without its policy is a
   general-purpose relay.
6. Certificates are not in the backup. Let Caddy reissue them on first start.

Note that `strfry` is not on `PATH` inside the upstream container image — invoke it by its
full path in the image (`/app/strfry`), and give the image an explicit shell entrypoint if
you need to pipe into it.

## Restore drill

Run one after any change to these scripts, and after the first real user data arrives.
Restore into a scratch relay with an empty database — never over the live one.

**2026-08-20.** 21 signed `kind:30078` records, snapshotted with `relay-snapshot.sh` and
restored into a fresh strfry with an empty database: `21 added, 0 rejected`, and a
re-export compared equal to the source on both event ids and full event bodies. The
truncated-transfer path was exercised separately: the pull rejected the archive, exited
non-zero, left no partial file behind, and did not prune the existing snapshots.

Recorded against the scratch relay rather than production, which held no events at the
time. Repeat the drill against a production snapshot once real user data exists — that is
the run that gates opening the toggle beyond the operator.
