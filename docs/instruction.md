# Workstr Web — Build Instructions

> A complete, self-contained specification for building the web version of Workstr.
> A developer (human or AI) with no prior knowledge of the project should be able to
> build the entire product from this document alone.

---

## 1. Objective

Build **Workstr Web**: a browser-based, installable PWA workout tracker on the Nostr
protocol. The app is 100% client-side. It is served as static files from GitHub Pages
on a custom domain. All application logic — exercise library, workout sheets (programs),
training sessions, planning, progress analytics, recovery suggestions — runs in the
browser. User data lives in the browser (IndexedDB) for free users, and additionally as
**NIP-44-encrypted Nostr events on a paid, authenticated relay** for subscribers.

The operator hosts **no application backend**. The only server-side components are the
paid relay (strfry) and a Lightning payment gate — and only in Phase 2.

## 2. Vision

Workstr Web is the hosted continuation of the self-hosted Workstr (`sette7blo/workstr`),
part of the `*str` Nostr stack. The self-hosted version stores everything in SQLite and
delegates signing to a companion app (Idenstr). The web version keeps the same product
(same features, same data model, same NIP-101e event formats) but replaces:

| Self-hosted Workstr            | Workstr Web                                      |
|--------------------------------|--------------------------------------------------|
| Node HTTP server + REST API    | No server; logic runs in the browser             |
| SQLite (`workstr.db`)          | IndexedDB (same logical schema)                  |
| Idenstr (server-side signer)   | User-owned signer: NIP-07 extension or NIP-46 remote signer |
| LAN / Tailscale boundary       | Public website, keyless by design                |
| Private data stays on server   | Private data stays in browser; optionally backed up **encrypted** to the paid relay |

Long-term vision: the client is a complete free product; the **service around it** is
the business — encrypted sync/backup, retention guarantees, a curated exercise library,
media hosting, and eventually a platform where coaches publish programs.

## 3. Purpose (why this exists)

1. **Sovereignty**: no accounts, no passwords, no email. Identity is a Nostr keypair the
   user already owns. The operator never sees a private key and never holds plaintext
   user data. Health data is sensitive; here it is either local or ciphertext.
2. **Zero-cost distribution**: static hosting is free; public Nostr relays are free;
   the free tier costs the operator nothing per user.
3. **Honest monetization**: everything paid is enforced **server-side by the relay**
   (pubkey whitelist), never by client-side flags — the client is open source and
   client-side gates are unenforceable.
4. **Marketing loop**: free users publish workout summaries and shared programs to
   *public* relays, which advertises the product inside the Nostr social graph.

## 4. Infrastructure philosophy

Rules that govern every technical decision:

1. **Static client, dumb hosting.** The app is files. Anything that can run in the
   browser runs in the browser. A server component may only exist if the feature is
   *physically impossible* client-side (cross-user shared state, work while the user's
   browser is closed, secrets, payment verification).
2. **The relay is the product.** Free = local + public relays. Paid = the operator's
   authenticated relay. All gating happens at the relay (NIP-42 + pubkey whitelist).
3. **Keys never touch the app.** All signing and NIP-44 encryption/decryption is
   delegated to the user's signer through a signer abstraction. The app never asks for,
   stores, or transmits an `nsec`. Pasting an nsec is not offered, ever.
4. **Local-first.** IndexedDB is the source of truth for the UI. The relay is an
   encrypted replica. The app must be fully usable offline (PWA service worker).
5. **Data is never hostage.** Free users get JSON export/import. Paid users' relay data
   is standard Nostr events readable by any client with their key.
6. **Modular by contract.** Small modules with explicit interfaces (Section 8), so each
   can be built, tested, and AI-generated independently with minimal context.
7. **Operator privacy.** Public infrastructure (domain, Pages, VPS or home relay) is
   registered/paid privately (Njalla, crypto). Home IP is never exposed: the relay is
   either on a VPS or at home behind a VPN forwarded port.

## 5. Technical requirements

### 5.1 Functional (feature parity with self-hosted Workstr)

- **Exercise library**: search, filter by category/muscle/equipment/difficulty,
  favourites, create/edit/delete, images.
- **Workout sheets (programs)**: ordered exercises with set/rep/rest/weight targets;
  temporary sheets; stable slug per sheet.
- **Train**: start a session from a sheet, log sets (reps, weight in kg canonical,
  RPE optional), rest timer, wake-lock (no-sleep video fallback), finish & review.
- **Plan**: 7-day weekly grid + mesocycle blocks.
- **Progress**: weekly volume, muscle distribution, estimated-1RM records, training
  streak, body-weight log.
- **Recovery generator**: suggests exercises based on muscle recovery state computed
  from session history + the canonical muscle map (`muscles.js`, reused verbatim).
- **Nostr layer**:
  - Publish an exercise publicly (NIP-101e `kind:33401`).
  - Publish a program publicly (NIP-101e `kind:33402`, referencing exercises by a-tag).
  - Share a session summary as a `kind:1` note (with optional uploaded image).
  - Discover: browse/import exercises and programs from public relays with spam
    filtering and author profile display.
- **Paid tier (Phase 2)**: encrypted multi-device sync of all private data; curated
  premium exercise library; media hosting for images.

### 5.2 Non-functional

- **Browsers**: evergreen Chrome/Firefox/Safari, iOS Safari PWA installability.
- **Secure context**: HTTPS everywhere (required for service worker, `crypto.subtle`,
  NIP-07). Dev must also be a secure context (see Section 12).
- **Offline**: full app function without network except Nostr operations.
- **No build-time secrets**: the repo is public; config is public constants.
- **Performance**: first load < 500 KB gzipped (no heavy frameworks required; see 5.3);
  IndexedDB reads must render lists of 1,000+ sessions without jank.
- **Modularity**: no file > ~400 lines; no module imports more than 3 sibling modules.
  (Lesson from the predecessor project: a monolithic `index.html` is unmaintainable
  and expensive to feed to AI tools.)

### 5.3 Stack

- **Language**: modern JavaScript (ES modules) or TypeScript (recommended: TypeScript
  for AI-assisted coding — types are compressed documentation).
- **Build**: Vite. Output = static `dist/` deployable to GitHub Pages.
- **UI**: keep it lean. Either vanilla + lit-html, or Preact. Reuse the existing
  Workstr CSS (`public/styles.css`) and UI structure as the design reference.
- **Nostr**: `nostr-tools` (event creation, filters, relay pool, nip19, nip44 helpers)
  — but all *signing/encryption* calls go through the signer abstraction, never
  directly to a key.
- **Storage**: IndexedDB via the `idb` wrapper library.
- **Testing**: Vitest for pure modules (event codecs, recovery math, sync merge logic).

---

## 6. Nostr protocol usage (NIPs)

| NIP / kind | Role in Workstr Web |
|---|---|
| **NIP-01** | Base protocol: events, filters, REQ/EVENT/EOSE over WebSocket. Used for all relay I/O. |
| **NIP-07** | Browser-extension signer (`window.nostr`): `getPublicKey()`, `signEvent()`, `nip44.encrypt/decrypt`. Primary desktop login. |
| **NIP-46** | Remote signer ("bunker"/Amber): same operations over an encrypted relay channel. Primary mobile login. Connect via `bunker://` URI or `nostrconnect://` QR. |
| **NIP-44** | Versioned encryption used to encrypt **all private data events** to the user's *own* pubkey (self-encryption: conversation key of user↔user). |
| **NIP-78 (kind 30078)** | Arbitrary app data, addressable-replaceable. Carrier for every private encrypted record (sessions, sheets, plan, body-weight, settings, library overrides). `d` tag = record address (Section 7.3). |
| **NIP-101e (kind 33401)** | Public exercise template. Same tag layout the self-hosted app already emits: `d`, `title`, `format`, `format_units`, `equipment`, `t` topics, plus Workstr's granular `workstr_muscle` tags. |
| **NIP-101e (kind 33402)** | Public workout template (program). References exercises via `a` tags: `33401:<pubkey>:<d>`. |
| **kind 1** | Public workout summary note (social sharing). |
| **NIP-42** | Relay AUTH. The paid relay requires AUTH and only accepts read/write from whitelisted (paying) pubkeys. |
| **NIP-98** | HTTP Auth events (kind 27235) for authenticated uploads to media servers (nostr.build in Phase 1, own Blossom server in Phase 2). |
| **NIP-19** | bech32 encoding (`npub`, `naddr`, `nevent`) for display and share links. |
| **NIP-47 (NWC)** | *Optional, Phase 3.* Nostr Wallet Connect so subscribers can pay renewals / zap from inside the app. Not required for launch: Phase 2 payments are plain Lightning invoices (QR / copy). |
| **NIP-57** | *Optional, Phase 3.* Zap receipts for milestone-zap donation prompts. |

**Important distinction**: NIP-46 = remote *signing* (identity). NIP-47/NWC = remote
*wallet* (payments). They are separate connections with separate permissions.

### 6.1 How the NIPs work together (flows)

**Login**
1. User picks a signer: NIP-07 (if `window.nostr` exists) or NIP-46 (paste
   `bunker://` URI or scan QR).
2. App calls `signer.getPublicKey()` → `pubkey` becomes the user ID.
3. App opens/creates the IndexedDB database namespaced by pubkey
   (`workstr-<pubkey>`), so multiple identities on one device never mix.

**Save (free, always)**
1. User edits a sheet / logs a set / finishes a session.
2. Store module writes to IndexedDB immediately. UI reads only from IndexedDB.
3. If the user is a subscriber, the record is queued for encrypted sync (below).

**Encrypted sync (paid)**
1. Sync engine serializes the changed record to canonical JSON.
2. `signer.nip44Encrypt(ownPubkey, json)` → ciphertext. (Self-encryption: only the
   user's key can decrypt.)
3. Wrap in `kind:30078`, tags: `[["d", "<address>"], ["client", "workstr"]]`,
   `content = ciphertext`. `signer.signEvent(event)`.
4. Publish to the paid relay. Relay demands NIP-42 AUTH; the app answers the AUTH
   challenge with a signer-signed `kind:22242` event; relay checks the pubkey against
   the paying whitelist.
5. On another device: REQ `{kinds:[30078], authors:[pubkey], since:<lastSync>}` →
   decrypt each event via `signer.nip44Decrypt` → merge into IndexedDB
   (last-write-wins on `updated_at`, per record).
6. Decrypted results are cached in IndexedDB so decryption is a once-per-device cost
   (NIP-46 round-trips are slow; batch and lazy-decrypt oldest history on demand).

**Publish an exercise (free)**
1. Build the `kind:33401` from the local exercise row (same mapping as the
   self-hosted `idenstr.js` publish path).
2. `signer.signEvent` → publish to the user's public relays + (if subscriber) the
   paid relay.
3. Store `nostr_address` (`33401:<pubkey>:<d>`) back on the local row.

**Publish a program (free)**
1. Dependency walk: every referenced exercise that has no `nostr_address` is
   published first (a template pointing at unpublished exercises is broken).
2. Build `kind:33402` with `a` tags for each exercise; sign; publish; store address.

**Share a session summary (free)**
1. Render summary text (kg or lb per user setting; canonical storage is kg).
2. Optional image: upload via NIP-98-signed request to the media server; put the URL
   in the note.
3. Sign `kind:1`; publish to public relays.

**Discover & import (free)**
1. REQ to public relays: `{kinds:[33401]}` / `{kinds:[33402]}` with limits.
2. Validate (port of the self-hosted `discover.js` rules): require `title`, `d`,
   `equipment`, `format`, `format_units`; drop known spam `t` tags
   (`bikel`, `bikel-challenge`, `catallax`); recognize movement-topic tags.
3. Fetch author `kind:0` profiles (cached 30 min) for display.
4. Import = insert into IndexedDB with `source_type: 'imported'` and the origin
   address. **Programs import as snapshots** (no auto-follow of author updates).

**Subscribe (paid, Phase 2)**
1. App requests an invoice from the payment API (`POST /api/subscribe {pubkey, plan}`).
2. LNbits (connected to the operator's LND node) issues a Lightning invoice; app
   shows QR + copy string.
3. On settlement, a webhook/poller adds the pubkey (+ expiry) to the whitelist file;
   strfry's NIP-42 plugin reloads it.
4. Client retries relay AUTH → now accepted → sync engine activates. Client stores
   subscription expiry (also queryable via `GET /api/status/<pubkey>`).

---

## 7. Data: what is saved, and where

### 7.1 The three storage tiers

| Tier | Where | Contents | Who |
|---|---|---|---|
| **Local** | IndexedDB (per pubkey, per device) | Everything: exercises, sheets, sessions, sets, plan, body-weight, settings, caches of decrypted sync data | Everyone |
| **Public relays** | e.g. relay.damus.io, nos.lol, user's own relay list | Only what the user explicitly shares: `33401` exercises, `33402` programs, `kind:1` summaries. Plaintext by design. | Everyone |
| **Paid relay** | Operator's strfry (NIP-42 gated) | `kind:30078` NIP-44 ciphertext of all private records; also receives copies of the user's public events for retention; curated premium `33401`/`33402` catalog published by the operator key | Subscribers only |

Free users' private data exists **only** in IndexedDB (plus manual JSON export).
This fragility is deliberate — sync/backup is the paid product — but export/import
must exist so data is never hostage.

### 7.2 IndexedDB schema (mirror of the SQLite schema)

Database: `workstr-<pubkey>`, version-managed migrations.

Object stores (key → value shape; keep field names identical to the self-hosted
SQLite columns to allow straight ports of store logic):

- `exercises` (key `id` auto): slug (unique index), name, description, category,
  muscle_group, muscles[], equipment[], difficulty, tags[], instructions[],
  image_url, favourite, default_sets, default_reps, default_rest, source_type,
  status, nostr_event_id, nostr_pubkey, nostr_address, nostr_published_at,
  created_at, updated_at
- `sheets` (programs): id, slug, name, notes, is_temporary, nostr_pubkey,
  nostr_address, nostr_event_id, nostr_published_at, created_at, updated_at
- `sheet_exercises`: id, sheet_id (index), exercise_id, position, sets, reps, rest,
  weight
- `sessions`: id, sheet_id, started_at, finished_at, notes, summary_image_url,
  nostr_event_id (of the kind:1, if shared)
- `session_sets`: id, session_id (index), exercise_id, set_number, reps, weight_kg,
  rpe, completed_at
- `plan`: weekly grid entries + mesocycle blocks
- `bodyweight`: id, date, weight_kg
- `settings`: key/value (unit preference, relay list, signer type, sync cursor)
- `sync_queue`: pending outbound record addresses (Phase 2)
- `blobs`: locally cached exercise images (Cache API is also acceptable)

### 7.3 Encrypted record addressing (the `d` tag scheme)

One `kind:30078` event per logical record, addressable and replaceable. The `d` tag
encodes the record type and identity; edits republish the same `d` (relay keeps only
the latest). Deletions publish a tombstone payload (`{"deleted":true}`).

```
workstr:v1:exercise:<slug>        → one exercise (only user-created/modified ones)
workstr:v1:sheet:<slug>           → one program, including its exercise rows
workstr:v1:session:<uuid>         → one session including all its sets
workstr:v1:plan                   → the whole plan (small, replaceable)
workstr:v1:bodyweight             → the whole body-weight log (append-heavy but tiny)
workstr:v1:settings               → user settings worth syncing
workstr:v1:manifest               → index of all record addresses + updated_at, for fast diff sync
```

Granularity rationale: per-set events would be chatty (NIP-46 signing round-trips);
one blob for everything would exceed relay event-size limits (typically 64–256 KB)
and force full rewrites. **Per-session / per-sheet is the sweet spot** (~5 KB
ciphertext per session). The `manifest` lets a fresh device fetch one event to learn
what exists before pulling history lazily (most recent first).

### 7.4 Sizing (for the operator)

~200 sessions/user/year × ~5 KB ≈ **1 MB per active user per year** on the relay.
Curated library images ≈ 100 MB total. A 2 vCPU / 2–4 GB RAM / 40 GB disk machine
(VPS or home VM) carries this product for years; strfry idles in a few hundred MB.

---

## 8. Module map (build like building blocks)

Each module is one file (or small folder), has a stated contract, imports at most a
few siblings, and can be generated/tested in isolation. **This layout is the
AI-credit-efficiency plan**: to work on a module, an AI needs only this section, the
module's own file, and its direct interfaces — never the whole codebase.

```
src/
  core/
    types.ts           # All shared types: Exercise, Sheet, Session, Set, ... (no logic)
    ids.ts             # slugify, uuid, address builders (workstr:v1:...)
    units.ts           # kg↔lb, e1RM formulas (pure functions)
    muscles.ts         # canonical muscle map — copied verbatim from existing public/muscles.js
  signer/
    types.ts           # interface Signer { getPublicKey; signEvent; nip44Encrypt; nip44Decrypt }
    nip07.ts           # window.nostr adapter
    nip46.ts           # bunker adapter (connect URI/QR, request queue, batching)
    idenstr.ts         # OPTIONAL third backend: HTTP adapter to a self-hosted Idenstr,
                       # so this codebase can also replace the self-hosted UI later
  db/
    schema.ts          # IndexedDB stores + versioned migrations
    store.ts           # CRUD API — port of self-hosted src/app/store.js semantics
    export.ts          # JSON export/import of the entire local DB
  nostr/
    pool.ts            # relay pool: connect, REQ, publish, AUTH callback hook
    codecs.ts          # local record ⇄ event mapping: 33401, 33402, kind:1 builders
                       #   and parsers; 30078 encrypt/decrypt wrappers (uses signer)
    discover.ts        # port of self-hosted discover.js: filters, validation,
                       #   spam rules, profile cache, import
    publish.ts         # publish flows incl. program dependency walk
    auth.ts            # NIP-42 AUTH handling for the paid relay
  sync/
    engine.ts          # queue, manifest diff, push/pull, LWW merge, lazy decrypt
  media/
    upload.ts          # NIP-98 signed upload (nostr.build now, Blossom later)
  features/
    library/           # exercise library UI
    sheets/            # program builder UI
    train/             # live session UI (timers, wake lock)
    plan/              # weekly grid + mesocycles UI
    progress/          # charts, records, streaks, body-weight
    recovery/          # recovery-state computation + suggestions (pure logic + UI)
    share/             # summary composer, publish dialogs
    discover/          # discover/browse/import UI
    subscribe/         # Phase 2: paywall UI, invoice QR, status
  app/
    router.ts, shell.ts, settings.ts, pwa.ts (service worker registration)
public/
  manifest.webmanifest, icons/, nosleep.mp4/webm, styles.css (reuse existing)
```

Coding rules for AI efficiency:
1. Generate `core/types.ts` and `signer/types.ts` first; every other module is written
   against them.
2. Pure-logic modules (`units`, `recovery`, `codecs`, sync merge) get Vitest tests in
   the same PR — they are the cheapest to verify and the costliest to get silently wrong.
3. Never let a `features/*` module import another feature; they communicate through
   `db/store` and events.
4. Port, don't reinvent: the self-hosted repo's `store.js`, `discover.js`, and the
   publish mappings in `idenstr.js` are the reference semantics. Translating a known
   spec is cheaper and safer than re-deriving one.

---

## 9. Hosting & deployment

### 9.1 GitHub (the app)

1. Create a **GitHub organization** for the product (separate from the personal
   account; personal account joins as owner). Repo: `workstr-web` (public, MIT — or
   the chosen license; see note below).
2. GitHub Actions workflow (`.github/workflows/pages.yml`): on push to `main`,
   `npm ci && npm run build`, upload `dist/` with `actions/deploy-pages`. The repo
   already-established pattern from the self-hosted project applies.
3. Repo Settings → Pages → Source: GitHub Actions. Add custom domain
   (e.g. `app.workstr.example`) and **enforce HTTPS**.
4. Add a `CNAME` file to the deploy output containing the custom domain (Vite:
   place it in `public/`).
5. SPA routing: use hash-based routing (`#/train`) to avoid 404 handling on Pages,
   or ship a `404.html` redirect shim.

Licensing note: the existing self-hosted Workstr is MIT and stays MIT. The web repo
may be MIT (recommended for trust/marketing; enforcement lives in the relay anyway)
or source-available — decide before first release, not after.

### 9.2 Njalla (the domain)

1. Domain is registered at Njalla (privacy registrar; Njalla is the legal registrant
   fronting for you; payable in crypto).
2. In Njalla DNS, create a **CNAME**: `app` (or `www`) → `<org>.github.io`.
   For an apex domain instead, create A records to GitHub Pages' four anycast IPs
   (185.199.108.153 / .109. / .110. / .111.) and AAAA equivalents — but a subdomain
   CNAME is simpler and recommended.
3. In the GitHub Pages settings, set the custom domain; GitHub provisions a
   Let's Encrypt certificate automatically once DNS propagates. Verify the domain
   under the org's settings (TXT record) to prevent takeover.
4. Phase 2 adds: `relay` → address of the relay host (see 10.2), managed by a small
   DDNS updater against Njalla's API if the relay is home-hosted behind a VPN.

### 9.3 Where the relay lives (Phase 2 choice)

Two valid options, identical architecture, trivially migratable (strfry's LMDB
directory is portable; cutover is a DNS change):

- **Option A — home server (validate for free):** strfry + payment glue in Docker,
  network-namespaced behind a gluetun/WireGuard VPN container with a forwarded port.
  DNS `relay.workstr.example` → VPN exit IP. Note: consumer VPN providers commonly
  disallow forwarding low ports, so the relay listens on a high port —
  `wss://relay.workstr.example:PORT` is fully valid for WebSockets; only plain
  websites need 443. TLS via **DNS-01** ACME challenge (no port 80 required); ACME
  clients support Njalla's DNS API. Caveats: residential uptime, VPN IP reputation,
  some networks block VPN ranges.
- **Option B — small VPS (when there's revenue):** 2 vCPU / 4 GB / 40 GB from a
  privacy-friendly provider (Njalla sells crypto-payable VPSes; cheaper mainstream
  providers exist). Caddy terminates TLS on 443; home IP never involved. Lightning
  payments still route to the operator's home LND node over a private mesh
  (e.g. Tailscale) — the node never moves.

**Recommendation: launch Phase 1 with no relay at all; do Phase 2 as Option A; move
to Option B when subscriber revenue exceeds the VPS cost.**

---

## 10. Build phases

Each phase ships something usable. Within a phase, blocks are ordered so every block
compiles and is testable against the blocks before it.

### Phase 0 — Foundations (no product yet)

**Goal:** repo, toolchain, dev environment, contracts.

1. Create GitHub org + `workstr-web` repo; Vite + TypeScript + Vitest scaffold;
   Pages workflow deploying a hello-world PWA (manifest + service worker) to the
   Njalla CNAME domain. *Deploy pipeline works before any feature exists.*
2. `core/types.ts`, `core/ids.ts`, `core/units.ts` (+tests), copy `muscles.ts`.
3. `signer/types.ts` + `signer/nip07.ts`; login screen that shows the connected npub.
4. `db/schema.ts` + `db/store.ts` (+tests, using fake-indexeddb).
5. Dev environment (see Section 12) proven from a phone.

**Exit criteria:** visit the real domain, install as PWA, log in with a NIP-07
extension, see your npub, offline reload works.

### Phase 1 — The free product (no paid relay, no server at all)

**Goal:** full Workstr feature parity, local-first, public sharing. Operator hosts
nothing.

1. **Library block:** exercise CRUD UI on `db/store`; seed pack of starter exercises
   bundled as JSON.
2. **Sheets block:** program builder (ordered exercises, targets, slugs).
3. **Train block:** session runner — start from sheet, log sets, rest timer,
   wake lock, finish & review. This is the daily-use core; polish it first.
4. **Progress block:** volume/muscle charts, e1RM records, streak, body-weight log.
5. **Recovery block:** recovery-state computation from session history + muscle map;
   suggestion UI. Pure functions + tests.
6. **Signer block 2:** `signer/nip46.ts` (bunker URI + QR connect, request batching)
   → mobile login without an extension.
7. **Nostr block:** `nostr/pool.ts`, `nostr/codecs.ts`, `nostr/publish.ts` —
   publish exercise (33401), publish program (33402, with dependency walk),
   share summary (kind:1) with NIP-98 image upload to nostr.build.
8. **Discover block:** port validation/spam rules; browse, profile display, import
   as snapshot.
9. **Safety valve:** JSON export/import of the whole local DB.
10. **Release:** announce on Nostr; the app itself is the ad (every shared summary
    links back).

**Exit criteria:** a stranger with a Nostr identity can train for a month, share
summaries, publish and import programs — with the operator hosting zero
infrastructure.

### Phase 2 — The paid relay (monetization)

**Goal:** subscriptions unlock encrypted sync/backup + premium library. All gating
server-side.

Server side (Docker Compose on home server behind VPN, or VPS):
1. **strfry** with NIP-42 AUTH required; write/read policy plugin checks pubkey
   against a whitelist file (pubkey + expiry). Reject non-whitelisted AUTH.
2. **Payment glue** (the one custom service, ~small): LNbits (or direct LND REST)
   connected to the operator's existing LND node over the private mesh;
   `POST /api/subscribe {pubkey, plan}` → invoice; on settle → append pubkey+expiry
   to whitelist, hot-reload strfry policy; `GET /api/status/<pubkey>` → expiry.
   Nightly job prunes expired pubkeys (grace period, e.g. 14 days, before their
   events stop being served).
3. **TLS + DNS:** Caddy (VPS, port 443) or DNS-01 certs + high port (home/VPN);
   `relay.workstr.example` DNS record; DDNS updater if home-hosted.
4. **Backups:** nightly snapshot of strfry's LMDB directory off-machine
   (paying customers' encrypted backups are the one thing that must never be lost).

Client side:
5. **Auth block:** `nostr/auth.ts` — NIP-42 challenge signing against the paid relay.
6. **Sync block:** `sync/engine.ts` — 30078 encrypt/publish on change, manifest diff
   pull on login, LWW merge, lazy decryption (recent first), decrypted cache.
7. **Subscribe block:** paywall UI — invoice QR/copy, payment detection, status
   display, renewal reminder.
8. **Premium library:** operator key publishes the curated 33401/33402 catalog
   **only to the paid relay**; client shows a locked preview to free users
   (metadata teaser), full fetch for subscribers. Curation pipeline: operator-authored
   seed + graduation of the best community-shared exercises (with attribution).
9. Retention perk: subscribers' public events are also mirrored to the paid relay.

**Exit criteria:** pay a Lightning invoice on phone → whitelist updates without
operator action → open laptop, log in, entire history appears after decryption.

### Phase 3 — Growth (optional, in rough order of value)

1. **Blossom media server** on the relay host: premium image hosting (own the media
   path instead of nostr.build).
2. **NIP-47 (NWC)** wallet connect: in-app renewal payments and one-tap zaps.
3. **NIP-57 milestone zaps:** donation prompts at PRs/streaks (free-tier revenue).
4. **Push notifications** for planned workouts (requires a small always-on push
   service — subscribers only, honest server-side gate).
5. **Supporter badge** on shared kind:1 summaries + supporters page (honor system,
   converts well in zap culture).
6. **Coach platform:** third-party trainers publish paid programs on the relay
   (program-follow with updates as a premium feature; imports elsewhere remain
   snapshots). This replaces solo curation as the long-term content engine.
7. **Idenstr signer backend** (`signer/idenstr.ts`): the web codebase becomes usable
   as the UI for self-hosted installs too — one codebase, three signer backends.

---

## 11. Monetization summary

- **Free:** full app, local data, public sharing/discover, JSON export. Costs the
  operator nothing; markets the product.
- **Paid (sats, via the operator's own LND — no processor, no fees):**
  encrypted multi-device sync + backup with retention guarantee, curated premium
  exercise library, premium media hosting, (later) push notifications and
  coach-program follows.
- **Gating rule (non-negotiable):** every paid feature is enforced by the relay or a
  server the operator runs. Client-side-only locks are forbidden — the client is
  public JavaScript either way.
- **Donations:** milestone zap prompts, supporter recognition.
- Pricing suggestion: one simple plan, priced in sats, monthly/yearly; keep it under
  the "don't think about it" threshold and raise later if needed.

---

## 12. Development environment

The app is static files, so dev = serving a folder — but **secure-context rules
apply even in dev** (service workers, `crypto.subtle`, NIP-07 need HTTPS or
localhost; plain `http://<LAN-IP>` will silently break them, especially on phones).

Recommended setup on a home server / VM:

1. Dev VM or container with Node 22+, clone repo, `npm run dev` (Vite, port 5173).
2. Expose it inside a private mesh with automatic HTTPS — e.g. Tailscale:
   `tailscale serve 5173` → `https://<host>.<tailnet>.ts.net`, a real trusted cert,
   reachable from any personal device including iPhone, invisible to the internet.
3. **Dev relay stack** (compose file in the repo, `dev/compose.yaml`): strfry with
   the same NIP-42 policy plugin + LNbits pointed at a regtest/testnet Lightning
   backend + a fake-settle endpoint, so the full subscribe→whitelist→sync loop is
   testable without real sats.
4. Test matrix that matters: iOS Safari PWA (wake lock, installability, NIP-46 via
   Amber/relay round-trip latency), Chrome+extension (NIP-07), offline mode,
   fresh-device restore (manifest → lazy decrypt).

---

## 13. Risks & explicit trade-offs (state these in the product, not just here)

1. **Key loss = data loss.** NIP-44 self-encryption is unrecoverable without the
   user's key. Say it loudly at onboarding; offer JSON export as mitigation.
2. **NIP-46 latency.** Every sign/encrypt is a relay round-trip; batch, lazy-decrypt,
   cache. Design flows so a normal workout needs zero signer prompts.
3. **Curated library is copyable.** Signed by the operator key, provenance is
   obvious, but subscribers can republish it. The gate is social+bundled, not
   cryptographic; price accordingly.
4. **Public relays owe nothing.** Free users' shared events can be purged — that's
   the retention pitch, but also a support-question generator.
5. **Home-hosted relay fragility** (if Option A): residential uptime, VPN IP
   reputation, some networks block VPN ranges. Acceptable at launch; revisit at
   first paying cohort.
6. **Addressable-event size limits.** Keep every 30078 under ~64 KB; per-session
   granularity guarantees this.
7. **Legal/boring:** ToS + privacy page (short, honest: "we store ciphertext"),
   and local tax registration once revenue crosses the relevant small-supplier
   threshold.

---

## 14. Definition of done, per phase

- **Phase 0:** PWA installs from the real domain over HTTPS; login shows npub;
  CI deploys on push.
- **Phase 1:** 30 days of real training logged by real users with zero operator
  infrastructure; export/import verified; shared events visible in mainstream
  Nostr clients.
- **Phase 2:** invoice → auto-whitelist → cross-device restore, hands-off;
  LMDB backups restorable; premium library fetchable only with a paying pubkey.
- **Phase 3:** each item ships independently; nothing in it blocks 1–2.
