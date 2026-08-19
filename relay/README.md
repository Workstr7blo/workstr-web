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
        plugin = "<path to write-policy.mjs>"
        timeoutSeconds = 10
    }
}
```

Requires Node 22+ on the relay host. strfry starts the plugin as a long-lived child
process and restarts it if it exits, so a config reload is enough to pick up a new
version. Rejections are returned to the client as the NIP-20 `OK: false` message.

## Verify after deploying

`npm test -- write-policy` covers the decision table and drives the executable over the
real stdin/stdout protocol, but it cannot prove the relay is wired up. Against the
deployed relay, confirm all four:

1. A `kind:30078` with a `workstr:v1:` `d` tag is accepted.
2. A `kind:1` note is rejected, with the reason visible in the `OK` message.
3. A `kind:30078` with a foreign `d` prefix is rejected.
4. NIP-11 still serves over HTTPS and reads still work — the policy is write-path only.

## Scope

This plugin decides accept/reject per event and holds no state. Per-pubkey storage quotas,
the total storage ceiling, and the block list are separate and stateful; they are issue #2.

Do not add an allowlist here. If the funding trigger in `docs/instruction.md` §11.4 ever
fires, admission control arrives as part of Phase 2b along with NIP-42, and that is a
deliberate, announced change rather than a quiet edit to this file.
