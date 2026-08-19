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
strfry delete --filter '{"authors":["<throwaway pubkey>"]}'
```

## Scope

This plugin decides accept/reject per event and holds no state. Per-pubkey storage quotas,
the total storage ceiling, and the block list are separate and stateful; they are issue #2.

Do not add an allowlist here. If the funding trigger in `docs/instruction.md` §11.4 ever
fires, admission control arrives as part of Phase 2b along with NIP-42, and that is a
deliberate, announced change rather than a quiet edit to this file.
