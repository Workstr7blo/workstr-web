#!/usr/bin/env bash
# Writes one relay snapshot to stdout as a tar stream. Runs ON the relay host.
#
# Everything it says goes to stderr, so stdout stays a clean archive the caller can pipe
# straight into a file across ssh. Nothing is staged on the relay beyond a temp directory
# that is removed on the way out.
#
# Configure with environment variables; nothing here hard-codes a host or a path:
#   RELAY_DIR            the compose project directory (default: this script's parent)
#   RELAY_CONTAINER      strfry container name        (default: workstr-strfry)
#   STRFRY_BIN           binary inside the container  (default: /app/strfry)
#   STRFRY_CONF          config inside the container  (default: /app/strfry.conf)
#   RELAY_POLICY_STATE   write-policy state directory (default: $RELAY_DIR/strfry/policy-state)
set -euo pipefail

RELAY_CONTAINER="${RELAY_CONTAINER:-workstr-strfry}"
STRFRY_BIN="${STRFRY_BIN:-/app/strfry}"
STRFRY_CONF="${STRFRY_CONF:-/app/strfry.conf}"
RELAY_DIR="${RELAY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RELAY_POLICY_STATE="${RELAY_POLICY_STATE:-$RELAY_DIR/strfry/policy-state}"

log() { printf '[snapshot] %s\n' "$*" >&2; }

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# strfry's own export rather than a copy of data.mdb: it is a consistent read against a
# live relay, it survives an LMDB format change, and `strfry import` verifies every
# signature on the way back in, so a tampered archive cannot quietly restore.
log "exporting events from $RELAY_CONTAINER"
docker exec "$RELAY_CONTAINER" "$STRFRY_BIN" --config="$STRFRY_CONF" export 2>/dev/null \
  | gzip -9 > "$staging/events.jsonl.gz"
events="$(gzip -dc "$staging/events.jsonl.gz" | wc -l | tr -d ' ')"
log "exported $events event(s)"

# Allowlist, never a directory sweep. The relay directory also holds the gluetun VPN
# credentials (.env), the ACME account key and issued certificate keys (acme/, caddy/data).
# None of those belong in a backup that leaves the machine, and a sweep would take them.
mkdir -p "$staging/config"
for relative in strfry/strfry.conf strfry/write-policy.mjs strfry/Dockerfile compose.yaml caddy/Caddyfile; do
  source_path="$RELAY_DIR/$relative"
  if [ -r "$source_path" ]; then
    cp "$source_path" "$staging/config/$(basename "$relative")"
    log "included config/$(basename "$relative")"
  else
    log "WARNING: $relative missing or unreadable, not included"
  fi
done

# The write policy is stateless today. Quotas and the block list (issue #2) will keep
# state here, and losing it would silently reset every limit, so it is backed up from the
# start rather than remembered later.
if [ -d "$RELAY_POLICY_STATE" ]; then
  cp -r "$RELAY_POLICY_STATE" "$staging/policy-state"
  log "included policy state"
fi

checksum="$(cd "$staging" && sha256sum events.jsonl.gz | cut -d' ' -f1)"
strfry_version="$(docker exec "$RELAY_CONTAINER" "$STRFRY_BIN" --version 2>/dev/null | head -1 || echo unknown)"
{
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "events=$events"
  echo "events_sha256=$checksum"
  echo "strfry_version=$strfry_version"
  echo "policy_sha256=$(sha256sum "$RELAY_DIR/strfry/write-policy.mjs" 2>/dev/null | cut -d' ' -f1 || echo unknown)"
} > "$staging/manifest.txt"

log "streaming archive"
tar -cf - -C "$staging" .
