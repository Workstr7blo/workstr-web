# Device vault architecture

How Workstr protects secrets stored on a device - today the local Nostr key, later a Monero
hot wallet - behind a nine-digit device code. This is the reference for the security model,
the storage format, and recovery. The code lives in `src/security/`; the screens are
`src/app/device-vault-controller.ts` and `src/app/device-vault-view.ts`.

## What it protects, and what it does not

`docs/security-model.md` is the wider threat model: the Tip Jar as a hot wallet, the browser
compromise boundary, the Content Security Policy and the backup password.

The device code protects secrets **at rest**. A local account's nsec is no longer readable
by anyone who can open the browser's storage: decrypting it needs the code, and the code is
never written anywhere.

It does not make Workstr a hardware wallet, and nothing here should be read that way:

- **Offline guessing.** A nine-digit code has a billion values. Anyone who copies the vault
  database can guess offline at whatever speed their hardware allows. Argon2id makes each
  guess cost memory and time, which turns a copied vault from an instant read into a large
  job - it does not make it impossible. The delays on the unlock screen only slow someone
  typing at that screen; they do nothing against a copied database.
- **Code running on this origin.** While the vault is unlocked, it decrypts for whatever can
  call it, just as a signed-in signer signs for whatever can call it. The code protects the
  device while Workstr is closed or locked, not a compromised page while it is open.
- **Memory.** Raw key material is overwritten after it is imported into WebCrypto, on a
  best-effort basis. JavaScript cannot guarantee that no other copy remains in memory.

Two things therefore stay the user's job, and the app says so:

- **Keep the Nostr recovery key.** The device code cannot be recovered. A forgotten code is
  a reset, and the account comes back from the recovery key or another trusted device.
- **Keep a future Monero wallet's seed.** Once a wallet lives in the vault, a reset deletes
  it, and funds are only recoverable from the seed.

## The device code

Exactly nine ASCII digits, `000000000` through `999999999`, leading zeroes allowed. Spaces,
letters, punctuation and non-ASCII digits are refused rather than cleaned up
(`src/security/device-pin.ts`).

It is entered in three boxes of three digits and handled everywhere else as nine
uninterrupted digits. The inputs are plain text with `inputmode="numeric"` and
`autocomplete="off"`, masked with `-webkit-text-security`, so phones show a numeric keypad
and password managers do not offer to save it. The code is read at submit time, handed to
the vault, and never kept: it is not logged, not placed in `localStorage`, `sessionStorage`
or IndexedDB, and not included in any error message. A failed attempt redraws empty boxes.

**Each device has its own code.** It is never synchronized, never published to Nostr, never
in a JSON export, and never part of device pairing.

## Keys

```
device code ── Argon2id(salt, parameters) ──> key-encryption key
                                                    │ AES-GCM, AAD "workstr-device-vault|root|v1"
                                                    v
                                   random 256-bit root key (stored only wrapped)
                                                    │
               ┌────────────────────────────────────┴───────────────────────────────┐
HKDF-SHA-256 "workstr-device-vault|nostr.local-key|v1"   HKDF "workstr-device-vault|monero.hot-wallet|v1"
               │                                                                    │
      AES-GCM key for the Nostr record                         AES-GCM key for a future wallet record
```

- The code never encrypts a secret directly. It unwraps the root key, so **changing the code
  rewraps 32 bytes** and leaves every secret record exactly as it was.
- Each scope gets its own key through HKDF, and each record is authenticated against
  `workstr-device-vault|<scope>|v<version>`. Ciphertext moved to another scope, or read as
  another version, fails authentication.
- Once unlocked, the root key is imported as a **non-extractable** WebCrypto HKDF key. The
  session can derive scope keys; nothing on the page can read the root key back.

### Argon2id parameters

`m = 19456 KiB, t = 2, p = 1`, a 32-byte output - the 19 MiB row of the OWASP Password
Storage Cheat Sheet. It takes about a second on a desktop core and a few seconds on a phone,
once per launch. The implementation is `@noble/hashes`, pure JavaScript, so it runs the same
on iOS, Android and desktop browsers without WASM.

Parameters are stored in every vault, so a later release can raise them for new vaults
without stranding old ones. `deriveKeyEncryptionKey` refuses parameters below every OWASP
row, whether they come from the defaults or from a stored vault; there is no fallback to a
faster hash.

## Storage

A dedicated IndexedDB database, `workstr-device-vault-v1`, separate from every workout
namespace and from the older `workstr-secure-local-key-v1`.

`metadata` holds one record:

```ts
{ id: 'active', version: 1, kdf: 'argon2id', salt, kdfParameters: { memoryCost, iterations, parallelism },
  wrappingNonce, wrappedRootKey, createdAt, updatedAt }
```

`secrets` holds one record per scope, keyed by scope:

```ts
{ scope: 'nostr.local-key', version: 1, nonce, ciphertext, savedAt }
```

Every record has its own random 12-byte AES-GCM nonce. Never stored: the code, anything
reversible to it, the root key, a plaintext nsec, or a raw Monero secret.

The Nostr secret is stored as 64-character hex, not as the `nsec1...` string a person would
recognise. Scope names are dotted and lower case; a bare word is refused, so no scope can
collide with the `root` label.

Unknown versions are refused (`unsupported-version`); malformed metadata or records are
reported as corrupt, never treated as absent - an unreadable key must not look like an
account that was never there.

## Session and locking

States, in `state.deviceVault`: `absent`, `setup-required`, `locked`, `unlocking`,
`unlocked`, `error`.

The unlocked session is memory only. It lasts for the application session and ends when:

- the PWA is closed or reloaded, or the browser discards the page;
- the user presses **Lock Workstr** in Settings → Access & Security → Device security;
- **Auto-lock** fires: no tap, key or scroll for the chosen time (15 minutes, 30 minutes -
  the default - 1 hour, or never, "when Workstr closes"). It is judged against the clock, so
  time spent in another app counts and a return after longer than the limit finds Workstr
  locked; a live workout counts as activity. It calls the same lock as the button
  (`src/app/auto-lock.ts`), and the choice is a per-device preference in `localStorage`;
- the user signs out.

Navigating between pages or briefly backgrounding the app does not lock it, and the code is
not asked for again before a signature, a sync or a Monero transaction - including each tip.
The unlocked session is the authorization boundary; the send sheet's review and confirm step
is what stands between an intent and a broadcast. Auto-lock is not the ten-minute
`VAULT_UPDATE_AWAY_MS` below, which only decides when an update may reload.

A waiting app update keeps to that. Installing one reloads the page, and a reload locks the
vault, so while the vault is unlocked an update is applied only after the app has been in the
background for at least ten minutes - checked by a timer while away, and again on return,
because phones freeze background timers (`src/app/update-controller.ts`). With no vault, or a
locked one, the update still applies the moment the app is left.

Locking drops the session and the cached local signer, stops encrypted sync, closes the Tip
Jar wallet, closes any open sheet, and removes a revealed recovery phrase from the page. It keeps
the encrypted records, the signed-in public key and all workout data. Locking is not signing
out.

## Launch

```
Is there a vault with at least one secret?
  ├── yes → lock screen → correct code → finish any interrupted migration → open the account
  └── no  → a local-key account with a pre-vault key?
              ├── yes → "Protect this device" → create code → migrate → open the account
              └── no  → open normally
```

The lock screen is its own layer above every other one, the modal and the rest-timer overlay
included. Being opaque is not enough on its own, so while it is up everything beside it is
marked `inert`: Tab and screen readers cannot reach the page underneath, which after Lock
Workstr is the whole app. At launch the account has not been opened: there is no workout store for this identity, no local signer, and so no
sync. Anonymous local training with no vault opens with no prompt. Workstr accounts use a
device-vault-protected local key and do not have external-signer no-vault sessions.

A vault holding no secrets is a setup that never finished. It is deleted at launch rather
than asking for a code that protects nothing - once it is more than 30 seconds old. A younger
one may be another tab's setup about to write its secret, and deleting its metadata then
would leave that secret under a root key nothing can unwrap.

## Accounts

The only way a local key reaches storage is `saveLocalAccount` (`src/signer/local-key.ts`),
which needs an unlocked vault, writes the record, reads it back, and checks that it opens to
the expected public key. A record that fails that check is deleted again.

- **Create account.** The key is generated in memory. The recovery key is shown and must be
  confirmed as saved; then a code is created and confirmed; then the key is stored and
  verified; then sign-in completes. Closing the flow at any point before that stores nothing.
- **Restore with recovery key.** The nsec is validated and its public identity derived and
  shown; a code is created (or, if a vault already exists, its existing code entered - there
  is never a second vault or a second code); the key is stored and verified; sign-in
  completes.
- **QR pairing, new device.** After the transfer is validated the key is held in memory; the
  new device creates its own code, stores and verifies the key, then adopts the account.
  Cancelling stores nothing. The pairing protocol is unchanged - see
  `docs/device-pairing-architecture.md`.
- **QR pairing, trusted device.** The app is already unlocked, so the key is exported for
  the approved transfer without asking for the code again. A locked vault cannot export;
  pairing does not start until Workstr is unlocked.
- **Sign out.** Removes the `nostr.local-key` record only. Other scopes are left alone. A
  vault left with no secrets is deleted.

## Migration from pre-vault storage

Before the vault, a local key lived in `workstr-secure-local-key-v1`, encrypted under a
non-extractable key stored beside it - readable by any code on the origin without the user.
An account found there, with no vault, gets **Protect this device** at launch:

1. The old record is left untouched.
2. The user creates and confirms a code.
3. The old record is decrypted with the old storage code.
4. The vault is created.
5. The key is stored under `nostr.local-key`.
6. The record is read back and its public key derived.
7. It must match the signed-in account's public key.
8. Only then are the old secret and its wrapping key deleted.

Any failure keeps the old record, removes the vault that attempt created, and says
protection could not be enabled. Closing the app mid-way is safe: a vault with no secrets is
removed at the next launch and the process starts again; a vault that already holds the
matching key finishes by deleting the old record after its code is entered. If that finish
fails - most often because the old key belongs to a different account - the app says so once
it opens, names the old key's identity, and offers to remove it behind a confirmation; left
alone, the move is tried again at the next launch. The old key is never left behind silently.
No default code
is ever invented, and once the screen is shown the old automatically unlocked storage is not
used to sign.

The older migration of a plaintext key out of `localStorage` into that store still runs on
every launch, so a very old installation passes through both.

## Changing the code

Settings → Device security → Change device code asks for the current code, a new one, and
the new one again. The root key is unwrapped with the current code and rewrapped under the
new one, the rewrap is verified before it is written, and the committed record is read back
and verified again. Any failure restores the previous metadata, so the current code keeps
working. Secret records are not touched.

## Forgotten code

There is no recovery. **Forgot your device code?** explains that and offers **Reset device
vault**, which lists by name every secret it will delete and asks for confirmation. A reset
deletes the vault and its secrets, keeps the signed-in public key and the workout database,
and opens the recovery-key restore screen. Restoring the same nsec with a new code reopens
the same account and its training data.

The confirmation is scope-aware on purpose: once a Monero wallet is stored, a reset destroys
access to funds whose seed was not backed up, and the list says so before anything is
deleted.

## Wrong codes

Every wrong code gets the same message, "That device code is incorrect." - nothing about
which records exist or which failed. After three wrong codes each further attempt waits
1, 2, 4... seconds, up to a minute. The vault is never deleted because of failed attempts.

The count and the time of the next allowed attempt are kept in `localStorage`
(`workstr.deviceVault.unlockBackoff`, never the code; `src/app/device-vault-backoff.ts`), so a
reload - which is what opens the lock screen - does not end a wait. Clearing site data does,
which is one more reason these waits are a speed bump for someone at the screen and not a
defence for a copied database.

## Encrypted sync

The code is not part of the sync protocol. Nothing derived from it is used for sync, and no
code, vault record or vault key enters a sync record, a backup-key event, or a JSON export.
Unlocking makes the local signer available; that signer unwraps the account's backup key.
A phone and laptop sync together when they use the same Workstr account npub.

## Future scopes

A later module stores its secret under its own scope - `monero.hot-wallet` for the planned
wallet - through the same `putSecret` / `getSecret` API. The same code and the same unlocked
session open it, with a key of its own. It must stay out of workout sync, Nostr backup
records, the Nostr-only pairing payload and standard exports. No placeholder record exists
today.

## Verification owners

| Concern | Tests |
|---|---|
| Code format, create, unlock, lock, scopes, rekey, corruption | `tests/device-vault.test.ts` |
| Argon2id parameters at their real cost | `tests/device-vault-kdf.test.ts` |
| Local key storage and signing through the vault | `tests/local-key-signer.test.ts` |
| Migration from pre-vault storage | `tests/local-key-migration.test.ts` |
| Screens: unlock, delays, protect, reset, change code, lock | `tests/device-vault-controller.test.ts` |
| Launch blocked while locked; no prompt without a vault | `tests/shell.test.ts` |
| Pairing: no code in the QR, locked trusted device, cancelled setup | `tests/device-pairing-controller.test.ts` |
| Real devices | `docs/RELEASE-QA.md` section 6e |
