# Security model

What Workstr's local security protects, what it cannot, and the rules that keep the parts
around the cryptography from undoing it. `docs/device-vault-architecture.md` is the
reference for the vault itself. This document covers the Tip Jar, the page, and the code.

## The Tip Jar is a hot wallet

The Tip Jar is a convenient, self-custodial wallet for tipping creators and receiving small
amounts. It is **not** cold storage, and nothing in the app should suggest otherwise:

- its keys live on an internet-connected phone or computer, inside a web page;
- they are unlocked for as long as Workstr is unlocked, so that a tip needs one tap and no
  code;
- a device that is compromised while unlocked can spend them.

Keep tip-sized balances in it. Savings and long-term holdings belong in a dedicated wallet,
ideally a hardware wallet.

## What the device code does

A nine-digit code (about 30 bits) run through Argon2id (19 MiB, 2 passes) unwraps a random
256-bit root key; HKDF derives a separate AES-256-GCM key for each secret. This protects
secrets at rest: someone who picks up a locked phone, or reads the browser's storage, gets
ciphertext.

It raises the cost of guessing; it does not remove the possibility. A copy of the vault can
be attacked offline, where the wrong-code delays on the unlock screen do not apply, and a
billion codes is a large job, not an impossible one. The code is a local unlock for a hot
wallet, chosen to be typed between sets. It is not a password for cold storage. The Argon2id
parameters are not raised without measuring vault creation, unlock, backup and restore on
older and current iPhones, Android and desktop first.

## The browser compromise boundary

**If malicious JavaScript runs inside the unlocked Workstr origin, the vault cannot protect
secrets from it.** It can call the same code the app calls: sign Nostr events, read the
wallet, send a transaction. Encryption at rest is about a closed or locked app. While the
app is open, the defences are the ones that stop hostile code from running at all:

- **No injected markup.** Every string that came from outside - relays, profiles, program and
  exercise events, payment targets, wallet and node errors, imported files - is escaped with
  `html()` before it reaches a template. `tests/xss-regression.test.ts` renders the major
  surfaces with values built to break out of elements, attributes and inline script, and
  fails on any element, `on*` attribute or `javascript:` URL that gets through.
- **No inline script.** Templates carry no `onerror`/`onclick` handlers; a broken image's
  fallback is declared with `data-fallback` and handled by `src/app/image-fallback.ts`.
  `tests/content-security-policy.test.ts` fails on any inline handler in `src/`.
- **A Content Security Policy** (below).
- **Dependency and build integrity.** Every script is bundled from this repository and pinned
  by `package-lock.json`. There are no CDNs, analytics tags or remote wallet libraries at
  runtime. Updates to `monero-ts`, `@noble/hashes`, `nostr-tools`, `idb`, Vite or the service
  worker are reviewed - release notes, security changes, WASM behaviour, new network
  destinations - and never auto-merged. monero-ts's `GenUtils.isBrowser` compiles two
  functions from strings, which the policy blocks; `scripts/monero-ts-csp.mjs` rewrites that
  one method at build time (and in the dev pre-bundle) and fails the build if an upgrade
  changes it, rather than the app allowing `'unsafe-eval'`.
- **Deployment integrity.** Pages deploys only `main`, built by CI from the reviewed source.

## Content Security Policy

`index.html` declares:

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Anything not listed comes from this origin only. |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Bundled scripts only. WebAssembly compilation is needed by the Monero wallet and the QR reader; `'unsafe-eval'` and `'unsafe-inline'` are not allowed. |
| `style-src` | `'self' 'unsafe-inline'` | Templates set a few `style` attributes. Styles cannot run script. |
| `img-src` | `'self' https: data: blob:` | Profile pictures and exercise images come from any https host. QR codes are data URLs. |
| `connect-src` | `'self' wss: https://xmr.workstr.fit:43736 https://nostr.build https://*.nostr.build data: blob:` | Nostr relays (any, since relay sets vary), the Workstr Monero node, the profile-photo host, and the wallet runtime's embedded WASM. |
| `worker-src` | `'self' blob:` | The Monero wallet worker and the service worker. |
| `object-src`, `base-uri` | `'none'` | Unused, and useful to an attacker. |
| `form-action` | `'self'` | No form posts anywhere else. |

**Limits of a `<meta>` policy.** GitHub Pages cannot send response headers, so the policy is
a `<meta>` tag. That means `frame-ancestors` (clickjacking), `report-uri`/`report-to` and
`sandbox` are ignored, and the policy only applies from the point the tag is parsed (it is
the first thing in `<head>` for that reason). Workers get their policy from their own
response, which Pages also cannot set.

**If the Tip Jar grows into a significant financial feature,** hosting should move to
something that can send real headers: `Content-Security-Policy` (with `frame-ancestors
'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Permissions-Policy` restricting everything but the camera, and HSTS.

## Backups

- **Training JSON** holds workouts, programs and settings. It never holds a seed, a private
  spend or view key, vault material or any password, and it is not a wallet backup.
- **The Tip Jar backup** (`.wstrwallet`) is sealed with Argon2id (the vault's parameters,
  fresh 16-byte salt) and AES-GCM (fresh 12-byte nonce, authenticated type, version and
  network). It is portable - emailed, uploaded, copied to USB - so anyone holding it can guess
  its password offline for as long as they like. The password is therefore at least **12
  characters** (`TIP_JAR_BACKUP_MIN_PASSWORD`), with no character-class rules and a short list
  of obvious passwords refused. It cannot be recovered. Restoring an older file made under the
  previous eight-character floor still works.

## Secrets in memory and on screen

- The recovery phrase is shown only on an explicit Reveal. It leaves the page, not just the
  state, when Hide is pressed, Advanced recovery closes, Settings is left, or Workstr locks.
- It never enters app state beyond that reveal, `window`, the URL, `data-*` attributes,
  `localStorage`/`sessionStorage`, the training backup or any Nostr event.
- After a backup is decrypted, the plaintext bytes are overwritten. The decoded text is a
  JavaScript string and cannot be. JavaScript offers no secure erasure, so this is best-effort
  hygiene, not a guarantee.

## Logging

Never pass a wallet object, wallet bundle, backup payload, recovery phrase, key, nsec, device
code or password to `console.*`, not even inside an error object. Wallet and node errors are
reduced to a single short, user-safe line before they reach a toast, a modal or a log.
`tests/secret-logging.test.ts` fails on a console call in `src/` whose arguments mention
anything secret-shaped, and on any console call at all in the modules that hold keys and
seeds.

## Spending

Every send goes amount, review (fee and total), explicit confirm, broadcast. Nothing is sent
automatically on a pending tip, a finished sync or newly arrived funds. The device code is not
asked for per tip; if Workstr ever holds materially larger balances, re-authentication before
unusually large sends belongs in its own change. Wallet generation is left to `monero-ts`
entirely: no timestamps, touch timing, sensors or `Math.random()` are mixed in.
