# Device pairing architecture

How a signed-in Workstr device hands its local account to a new device by QR. This is the
authoritative protocol reference; the relay half is implemented in `relay/write-policy.mjs`
and the client half tracked in issue #168.

Pairing is a transport, not an identity system. It ends in the same local signer that a
pasted recovery key produces — `importLocalAccount(nsec)` then
`completeSignIn(pubkey, 'local')`. Create account, restore from nsec and QR transfer are
three ways to provision one thing.

`workstr:v2:` remains the encrypted sync namespace and is untouched by any of this.
`workstr:pair:` is temporary transport and never carries user data.

## Purpose

The only way onto a second device used to be pasting a 63-character nsec. Pairing replaces
that with two taps — scan, approve — without the app gaining a server, an account database,
or a new signer type.

## The shape of it

```
NEW DEVICE                             TRUSTED DEVICE
generate ephemeral secp256k1 keypair
show QR                    ── scan ──> validate, then ask the person
                                       nip44Encrypt(ephemeralPubkey, payload)
subscribe by #d = pairing id           publish kind:20078
decrypt, verify, import    <─ relay ──
```

Only one event crosses the relay: the response. The request travels inside the QR, which
the trusted device reads off the new device's screen. There is no request event, and
therefore no unauthenticated write path — every pairing event is signed by an account key,
so the block list applies to pairing exactly as it applies to sync.

The relay is used rather than WebRTC because an iOS PWA backgrounds, sockets reconnect, and
the two devices are rarely in the foreground at the same instant. An asynchronous rendezvous
tolerates all three; a live peer connection does not.

## QR contents

```
workstr://pair?v=1&id=<32 hex>&pub=<ephemeral pubkey hex>&c=<challenge hex>&exp=<unix>
```

Every field is public and temporary. A photograph of the QR yields nothing: the ephemeral
*private* key never leaves the new device, so an observer cannot decrypt a response even
with the whole QR in hand.

The QR never carries the nsec, the backup key, NWC credentials or Monero keys.

## Event format

```
kind:       20078 (ephemeral)
pubkey:     the account pubkey — the trusted device signs with the key being transferred
content:    NIP-44 v2 ciphertext, encrypted to the new device's ephemeral pubkey
created_at: now
tags:       exactly three, any order:
              ["d",          "workstr:pair:<32 lowercase hex>"]
              ["expiration", "<unix seconds>"]
              ["v",          "1"]
```

Encrypted plaintext, which exists only in memory on each device:

```json
{ "version": 1, "pairingId": "...", "challenge": "...",
  "accountPubkey": "...", "nsec": "nsec1...", "issuedAt": 0, "expiresAt": 0 }
```

## Why an ephemeral kind

Verified against the production strfry image on 2026-09-05:

- Ephemeral events are **stored and served to a later `REQ` on a new connection**, not only
  broadcast to subscriptions open at the time. This is what lets a backgrounded PWA
  reconnect and still collect its response.
- They are **reaped automatically** once `ephemeralEventsLifetimeSeconds` passes.
  Persistent events in the same database are untouched.
- `#d` filters work on them, so the new device can find its response by pairing id alone.
- `rejectEphemeralEventsOlderThanSeconds` (60) refuses stale ones before the write policy
  runs.
- **The write policy is invoked for ephemeral kinds.** There is no enforcement bypass.

So retention needs no code and no cleanup job: production sets
`ephemeralEventsLifetimeSeconds = 300`, matching `PAIR_MAX_LIFETIME_SECONDS`.

Kind 20078 is unassigned in the NIP registry. Assigned kinds in the ephemeral range are
22242, 23194, 23195, 24133, 24242, 27235 and 28934-28936.

## Encryption model

The ephemeral keypair is secp256k1, so the trusted device encrypts with
`signer.nip44Encrypt(ephemeralPubkey, payload)` — already on the `Signer` interface and
already implemented for the local signer. No new primitives.

NIP-44 v2 is authenticated encryption, and that supplies response authentication for free.
A ciphertext that decrypts under `conversationKey(ephemeralSecret, event.pubkey)` proves the
sender held the account secret; there is no separate signature to check. The new device then
verifies that the pubkey derived from the transferred nsec equals the event's pubkey, and
aborts on mismatch.

## What the new device must verify

Before importing anything: protocol version, pairing id matches, challenge matches,
`expiresAt` has not passed, `getPublicKey(nsec) === event.pubkey`, and this pairing session
has not already been consumed. On success it marks the session consumed, destroys the
ephemeral private key, unsubscribes, and ignores every later response.

## Security argument

**An observer of the relay learns nothing.** Reads are open, so assume an attacker lists
every pairing event. They see ciphertext and a random pairing id.

**An observer cannot forge a response.** Forging one requires encrypting to the new device's
ephemeral public key, which exists only in the QR — a channel that travelled physically,
from one screen to a camera held in front of it. A forged response fails the NIP-44 HMAC and
is discarded, and the new device keeps waiting.

This is why **the ephemeral pubkey must never appear as a tag**, and why the policy rejects
any fourth tag rather than ignoring it. Tagging it would hand an attacker the one value that
breaks the scheme. `decidePairing()` enforces the exact three-tag set for this reason, not
for tidiness.

**A screenshot of the QR is not enough.** The ephemeral private key stays on the new device.

**Why there is no comparison code.** A short authentication string defends a channel where
the peer cannot be verified. The QR *is* verified — by the physical act of pointing a camera
at a screen — so matching codes would prove nothing the scan has not already established,
and forgery is closed cryptographically as above. Adding one would be friction bought with
no security.

The residual risk is social engineering: someone talks the user into scanning *their* QR. No
code comparison helps, because the codes would legitimately match. The explicit approval
screen on the trusted device is the defence, and the nsec does not move until it is tapped.

## Relay responsibilities, and their limits

The relay validates protocol shape, enforces resource limits, and stores and forwards the
event. It does not authenticate users, and pairing introduces no NIP-42 and no allowlist.

Everything that makes pairing *safe* is done by the clients: explicit approval, encryption,
response verification, pubkey checking, challenge checking and single-use behaviour. Relay
expiry validation is defence in depth, never the only check — the client enforces expiry
independently.

The security model must hold with all of this public. It does: the protection is strict
schema, small limits, short expiry, high-entropy identifiers and encryption, never obscurity
of the kind number, the namespace or the relay URL.

## Relay limits

| Rule | Value | Constant |
|---|---|---|
| Event kind | 20078 | `PAIR_KIND` |
| Namespace | `workstr:pair:` | `PAIR_D_PREFIX` |
| Pairing id | 32 lowercase hex (128 bits) | `PAIR_ID_PATTERN` |
| Maximum event size | 2 KB | `PAIR_MAX_BYTES` |
| Maximum lifetime | 300 s | `PAIR_MAX_LIFETIME_SECONDS` |
| Protocol version | 1 | `PAIR_PROTOCOL_VERSION` |
| Rate window | 1 hour | `PAIR_WINDOW_SECONDS` |
| Per-pubkey rate | 30 | `WORKSTR_PAIR_MAX_PER_AUTHOR` |
| Relay-wide rate | 600 | `WORKSTR_PAIR_MAX_TOTAL` |

Pairing is counted, never charged to the persistent quota — see `relay/README.md`.

## Deployment

The relay must accept the finalized pairing event before the client feature ships; a client
released first would fail every transfer. Deploy the policy, run the seven checks under
"Verify after deploying" in `relay/README.md`, then release the client.

Rolling back means removing the pairing branch from `decide()`. Encrypted sync does not
depend on any pairing code, so it keeps working untouched.
