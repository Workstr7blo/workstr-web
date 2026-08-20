#!/usr/bin/env bash
# Pulls one relay snapshot to this machine. Runs on the BACKUP host, not the relay.
#
# Pull rather than push on purpose: the relay holds no credential for the backup store, so
# a relay that is compromised cannot reach, rewrite or delete its own backups.
#
# Configure with environment variables:
#   RELAY_SSH       ssh target for the relay host              (required)
#   BACKUP_DIR      where snapshots are kept on this machine   (required)
#   SNAPSHOT_CMD    path to relay-snapshot.sh on the relay     (required)
#   DAILY_KEEP      nightly snapshots retained  (default: 7)
#   WEEKLY_KEEP     weekly snapshots retained   (default: 4)
set -euo pipefail

RELAY_SSH="${RELAY_SSH:?set RELAY_SSH to the ssh target for the relay host}"
BACKUP_DIR="${BACKUP_DIR:?set BACKUP_DIR to where snapshots should be kept}"
SNAPSHOT_CMD="${SNAPSHOT_CMD:?set SNAPSHOT_CMD to relay-snapshot.sh on the relay host}"
DAILY_KEEP="${DAILY_KEEP:-7}"
WEEKLY_KEEP="${WEEKLY_KEEP:-4}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
daily="$BACKUP_DIR/daily"
weekly="$BACKUP_DIR/weekly"
mkdir -p "$daily" "$weekly"
log() { printf '%s [pull] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$BACKUP_DIR/backup.log" >&2; }

# Written under a temporary name and only renamed once verified, so an interrupted pull
# can never be mistaken for a good snapshot by the retention pass below.
partial="$daily/.$stamp.tar.partial"
final="$daily/$stamp.tar"
trap 'rm -f "$partial"' EXIT

log "pulling snapshot from $RELAY_SSH"
ssh -o BatchMode=yes "$RELAY_SSH" "$SNAPSHOT_CMD" > "$partial"

# Verified here rather than trusted: a truncated stream is the likeliest failure, and the
# point of a backup is that it is known-good before the old ones are pruned.
inspect="$(mktemp -d)"
trap 'rm -f "$partial"; rm -rf "$inspect"' EXIT
if ! tar -xf "$partial" -C "$inspect" 2>/dev/null; then
  log "FAILED: archive is unreadable — a truncated or interrupted transfer"
  exit 1
fi
[ -s "$inspect/events.jsonl.gz" ] || { log "FAILED: no events in archive"; exit 1; }
[ -s "$inspect/manifest.txt" ] || { log "FAILED: no manifest in archive"; exit 1; }
expected="$(grep '^events_sha256=' "$inspect/manifest.txt" | cut -d= -f2)"
actual="$(cd "$inspect" && sha256sum events.jsonl.gz | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || { log "FAILED: checksum mismatch (manifest $expected, archive $actual)"; exit 1; }
gzip -t "$inspect/events.jsonl.gz" || { log "FAILED: events archive is corrupt"; exit 1; }
events="$(grep '^events=' "$inspect/manifest.txt" | cut -d= -f2)"

mv "$partial" "$final"
log "stored $(basename "$final") ($events events, $(du -h "$final" | cut -f1))"

# One promoted copy a week, so a fault that goes unnoticed past a week is still
# recoverable after the dailies have rotated away.
newest_weekly="$(find "$weekly" -name '*.tar' -mtime -7 -print -quit 2>/dev/null || true)"
if [ -z "$newest_weekly" ]; then
  cp "$final" "$weekly/$stamp.tar"
  log "promoted $stamp to weekly"
fi

prune() {
  local directory="$1" keep="$2"
  # Pruned only after a verified snapshot landed above, never before.
  find "$directory" -maxdepth 1 -name '*.tar' -print0 \
    | sort -zr \
    | tail -zn "+$((keep + 1))" \
    | while IFS= read -r -d '' old; do rm -f "$old"; log "pruned $(basename "$old")"; done
}
prune "$daily" "$DAILY_KEEP"
prune "$weekly" "$WEEKLY_KEEP"
log "done"
