# Workstr relay write policy

The Workstr relay stores users' encrypted training backups. It is **open**: any pubkey may
write, there is no allowlist, and NIP-42 AUTH is not used. Reads are open too — payloads
are NIP-44 ciphertext, and cleartext `d` tags are an accepted trade (`docs/instruction.md`
§13).

That makes `write-policy.mjs` the only control on what the relay stores. It accepts exactly
two narrowly defined Workstr protocol families, each validated on its own terms, and
rejects everything else — `kind:1` included. This is what stops the relay becoming a
general-purpose relay carrying other clients' notes, and there is no second line of
defence: the relay URL ships inside public JavaScript and relay crawlers index it whether
or not anyone advertises it.

**Encrypted sync** — persistent user records:

- `kind` is `30078`, **and**
- the first `d` tag starts with `workstr:v2:` and carries something after the prefix.

**Device pairing** — ephemeral transport for the QR sign-in flow:

- `kind` is `20078`, **and**
- exactly three tags: `d` = `workstr:pair:<32 lowercase hex>`, `expiration` (NIP-40, in the
  future and no more than 300 seconds ahead), `v` = `1`, **and**
- non-empty content, and a serialised event of 2 KB or less.

The two are kept apart deliberately. Sync records are addressable, persistent and charged
against a per-author quota; pairing events are ephemeral, tiny, expire in minutes and are
bounded by a rate window instead. A single predicate accepting both prefixes would let
pairing inherit sync's storage budget and let sync inherit pairing's laxer shape, so
`decide()` dispatches to `decideSync()` or `decidePairing()` and they share nothing. Either
can be changed — or the pairing branch removed outright to roll back — without touching the
other.

**Why the `d` prefix and not the kind alone.** Kind `30078` is NIP-78 "arbitrary app data",
a shared kind that unrelated clients also publish. Filtering on kind alone would let their
records accumulate on the disk.

**What the relay never sees.** Pairing content is NIP-44 ciphertext holding a recovery key,
encrypted to an ephemeral public key that exists only in the QR code on the new device's
screen. The relay cannot decrypt it, and neither can anyone reading the relay. See
`docs/device-pairing-architecture.md` for the protocol and its security argument — in
particular why the recipient's ephemeral pubkey must never appear as a tag.

## Install

Copy `write-policy.mjs` onto the relay host, make it executable, and point strfry at it:

```
relay {
    writePolicy {
        plugin = "/app/write-policy.mjs"
        timeoutSeconds = 10
    }
}
```

strfry runs the plugin as a subprocess, so the interpreter has to exist **inside** the
relay container. The upstream `ghcr.io/hoytech/strfry` image is Alpine carrying only
`/bin/sh` — no node, python or perl — so `Dockerfile` here derives from it and adds the
one package the plugin needs:

```dockerfile
FROM ghcr.io/hoytech/strfry:latest
USER root
RUN apk add --no-cache nodejs
USER strfry
```

Alpine 3.18 ships Node 18. The plugin uses only `node:readline`, `node:url` and plain
ESM, so it does not need the Node 22 the client's `package.json` asks for — that floor is
Vite's, and Vite never runs on the relay.

The relay's compose service builds from that Dockerfile and mounts the plugin read-only
beside the config, so updating the policy is a file copy plus a stack cycle rather than an
image rebuild — see [Restarting the stack](#restarting-the-stack), which is not the same as
restarting the container:

```yaml
build:
  context: ./strfry
image: workstr-strfry:local
volumes:
  - ./strfry/strfry.conf:/app/strfry.conf:ro
  - ./strfry/write-policy.mjs:/app/write-policy.mjs:ro
```

The plugin file needs mode 755 on the host — strfry executes it directly, through its
`#!/usr/bin/env node` shebang. Rejections reach the client as the NIP-20 `OK: false`
message.

## Restarting the stack

**Never restart or recreate these services individually. Always cycle the whole stack:**

```sh
docker compose down && docker compose up -d
```

strfry and Caddy run with `network_mode: service:gluetun`, so all three share one network
namespace and the published port belongs to the gluetun container. Restarting one service
leaves that arrangement half-rebuilt:

- Recreating gluetun destroys the namespace that strfry and Caddy are still attached to.
  They keep running and keep listening, on a namespace nothing routes to any more.
- gluetun tears down and rebuilds its firewall on every VPN restart, and the rule for the
  relay port goes with it. A tunnel that is flapping removes the allowed input port every
  few seconds, so the relay is unreachable from outside while looking healthy inside.

Both failures present as "the relay is down" with every container reporting `Up`, and
neither is fixed by restarting the service that looks broken. `down` removes all three
containers and the network; `up` rebuilds them in dependency order. That is the only clean
restart this stack has.

This matters for routine changes, not just outages: **`strfry.conf` and `write-policy.mjs`
are read at startup**, so editing either needs a full cycle before it takes effect. The
files are mounted, so the container sees the new content immediately and behaves as though
nothing changed — which reads as the edit having failed.

### Checking whether the relay is actually up

Test through the hostname, never a bare IP:

```sh
curl -s -H "Accept: application/nostr+json" https://<relay-host>:<port>
curl -s --resolve <relay-host>:<port>:<ip> -H "Accept: application/nostr+json" https://<relay-host>:<port>
```

Caddy holds a certificate for the relay hostname only. `curl -k https://<ip>:<port>` aborts
with a TLS internal error and returns an empty response, which looks exactly like an
outage. Use `--resolve` to reach a specific address with the right SNI.

Inside the container the relay answers on plain HTTP, which separates "the stack is broken"
from "the network path is broken":

```sh
docker exec <container> wget -qO- --header="Accept: application/nostr+json" http://127.0.0.1:7777
```

## Verify after deploying

`npm test -- write-policy` covers the decision table and drives the executable over the
real stdin/stdout protocol, but it cannot prove the relay is wired up. Against the
deployed relay, confirm all seven:

1. A `kind:30078` with a `workstr:v2:` `d` tag is accepted.
2. A `kind:1` note is rejected, with the reason visible in the `OK` message.
3. A `kind:30078` with a foreign `d` prefix is rejected.
4. NIP-11 still serves over HTTPS and reads still work — the policy is write-path only.
5. A well-formed `kind:20078` pairing event is accepted, and is retrievable by a `#d`
   filter on a *new* connection — that is what a backgrounded PWA relies on.
6. A pairing event with a foreign namespace, a stale or far-future `expiration`, an extra
   tag, or an oversized payload is rejected in each case.
7. The accepted pairing event is gone from the relay once its lifetime passes, without
   anyone deleting it — **after one further event is written**. strfry's cleanup pass runs
   every 9 seconds, but never deletes the single most recently written event, so on an idle
   relay the last pairing event published lingers until the next write of any kind. Publish
   a second event and the first disappears within seconds. See
   `docs/device-pairing-architecture.md` for why this is a property of the relay rather than
   a policy failure, and why it does not weaken pairing.

A rejection must carry the plugin's own `blocked: ...` message. If it reads
`error: internal error`, the plugin is not running — most often because the file lost mode
755 in transit — and strfry is failing closed on every write, valid records included.

Publish those from a throwaway key, then remove the accepted event so verification does
not leave data behind:

```
docker exec <container> /app/strfry --config=/app/strfry.conf delete --filter '{"authors":["<throwaway pubkey>"]}'
```

`strfry` is not on `PATH` inside the upstream image, so invoke it by its full path.

## Limits

With neither payment nor admission bounding anything, the kind and prefix filter plus these
limits are the entire defence. Organic use is not the worry — `30078` is addressable, so an
honest user's footprint is capped by their distinct `d` tags — deliberate abuse is.

| Limit | Default | Environment variable |
|---|---|---|
| Per-pubkey quota | 50 MB | `WORKSTR_QUOTA_BYTES` |
| Total storage ceiling | 20 GB | `WORKSTR_CEILING_BYTES` |
| Alert threshold | 80% of the ceiling | `WORKSTR_ALERT_RATIO` |
| State directory | — | `WORKSTR_POLICY_STATE` |
| Pairing events per pubkey per hour | 30 | `WORKSTR_PAIR_MAX_PER_AUTHOR` |
| Pairing events relay-wide per hour | 600 | `WORKSTR_PAIR_MAX_TOTAL` |

**`strfry.conf` must keep `ephemeralEventsLifetimeSeconds` at or above the policy's
`PAIR_MAX_LIFETIME_SECONDS` (300).** The policy accepts a pairing `expiration` up to that
far ahead, so a shorter relay lifetime would delete responses that are still valid and break
pairing for any device that backgrounded and came back for its answer. Both are 300 today;
they move together or not at all.

**Pairing is counted, not weighed.** It never touches the quota ledger. Those events are
reaped by strfry within `ephemeralEventsLifetimeSeconds`, so charging an author permanently
for bytes nobody holds would be wrong, and letting pairing consume a backup quota would be
worse. The bound is instead how many pairing events a pubkey may publish per rolling hour,
held in memory and never persisted — after a restart the counts are empty, which is correct,
because the events they described are gone too. The storage ceiling still applies: a relay
already over it stops accepting writes of either kind.

The state directory must be **writable by the container user**, and must be a mounted
volume — the plugin itself is mounted read-only. If it cannot be written the plugin says so
once and keeps enforcing from memory: failing open on quota would be bad, and refusing every
write because a disk is read-only would be worse for a backup relay.

**Usage is counted per address, not per publish.** Kind 30078 is addressable, so
republishing a record replaces the stored event; charging every publish would bill a user
who syncs daily for storage that never grew. The ledger therefore tracks the size of the
current event at each `d` tag, and a replacement is charged the difference.

Two files, two owners, so neither clobbers the other: the plugin writes `usage.json`, the
admin tool writes `blocklist.json`, and the plugin re-reads the block list whenever it
changes on disk — a block takes effect without a relay restart.

The alert fires against the threshold rather than on a full disk, once per crossing rather
than once per event, and goes to the container log. It names no path and no pubkey.

## Admin commands

The relay host has no node, so these run inside the container:

```sh
admin() { docker exec -e WORKSTR_POLICY_STATE=/app/policy-state <container> node /app/relay-admin.mjs "$@"; }

admin status                     # totals, ceiling, alert threshold, block count
admin list [n]                   # the n largest authors
admin usage <pubkey>             # one author's footprint
admin block <pubkey> [reason]    # takes effect immediately, no restart
admin unblock <pubkey>
```

`rebuild` recomputes the ledger from what the relay actually holds, which is the fix for
drift after a restore, a manual delete, or a lost state file:

```sh
docker exec <container> /app/strfry --config=/app/strfry.conf export \
  | docker exec -i -e WORKSTR_POLICY_STATE=/app/policy-state <container> node /app/relay-admin.mjs rebuild
```

Restart the relay afterwards so the plugin reloads the ledger.

## Scope

Do not add an allowlist here. If the funding trigger in `docs/instruction.md` §11.4 ever
fires, admission control arrives as part of Phase 2b along with NIP-42, and that is a
deliberate, announced change rather than a quiet edit to this file.

## Running it locally for client tests

The client's opt-in integration tests (`tests/sync-relay.integration.test.ts`) need a real
relay carrying this policy — a mock cannot prove the policy or NIP-44 interop, which is
the only reason those tests exist. Build the image here, mount the stock strfry config
with `writePolicy.plugin` pointed at `/app/write-policy.mjs` and `bind` set to `0.0.0.0`,
then:

```bash
WORKSTR_TEST_RELAY=ws://localhost:7788 npx vitest run tests/sync-relay.integration.test.ts
```

With `WORKSTR_TEST_RELAY` unset the suite skips, so CI stays green without a relay.
