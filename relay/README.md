# Workstr relay write policy

The Workstr relay stores users' encrypted training backups. It is **open**: any pubkey may
write, there is no allowlist, and NIP-42 AUTH is not used. Reads are open too — payloads
are NIP-44 ciphertext, and cleartext `d` tags are an accepted trade (`docs/instruction.md`
§13).

That makes `write-policy.mjs` the only control on what the relay stores. It accepts an
event when:

- `kind` is `30078`, **and**
- the first `d` tag starts with `workstr:v1:` and carries something after the prefix.

Everything else is rejected, `kind:1` included. This is what stops the relay becoming a
general-purpose relay carrying other clients' notes, and there is no second line of
defence: the relay URL ships inside public JavaScript and relay crawlers index it whether
or not anyone advertises it.

**Why the `d` prefix and not the kind alone.** Kind `30078` is NIP-78 "arbitrary app data",
a shared kind that unrelated clients also publish. Filtering on kind alone would let their
records accumulate on the disk.

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
beside the config, so updating the policy is a file copy plus a container restart rather
than an image rebuild:

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

## Verify after deploying

`npm test -- write-policy` covers the decision table and drives the executable over the
real stdin/stdout protocol, but it cannot prove the relay is wired up. Against the
deployed relay, confirm all four:

1. A `kind:30078` with a `workstr:v1:` `d` tag is accepted.
2. A `kind:1` note is rejected, with the reason visible in the `OK` message.
3. A `kind:30078` with a foreign `d` prefix is rejected.
4. NIP-11 still serves over HTTPS and reads still work — the policy is write-path only.

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
