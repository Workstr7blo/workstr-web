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
browser. User data lives either in the browser (IndexedDB) in an initial phase, and additionally as
**NIP-44-encrypted Nostr events on an authenticated relay** on a second phase.

The operator hosts **no application backend**. The only server-side component is the
relay (strfry) with a write-policy plugin, in Phase 2a. Donations need no backend
in v1 because the canonical funding rail is Nostr zaps: LNURL-pay creates the invoice,
public zap receipts create the accounting trail (Section 11).

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
| Private data stays on server   | Private data stays in browser; optionally backed up **encrypted** to the Workstr relay |

Long-term vision: the client is a complete free product and stays free. The **service
around it** — encrypted sync/backup, retention guarantees, a curated exercise library,
media hosting, and eventually a platform where coaches publish programs — costs money to
run, and the plan is to fund that cost with **donations rather than subscriptions**:
recurring zaps, targeted fundraisers, and supporter recognition. A paid tier is the
documented fallback, not the goal. Section 11 states what it would cost, what donations
must cover, and the exact condition under which the fallback activates.

## 3. Purpose (why this exists)

1. **Sovereignty**: no accounts, no passwords, no email. Identity is a Nostr keypair the
   user already owns. The operator never sees a private key and never holds plaintext
   user data. Health data is sensitive; here it is either local or ciphertext.
2. **Zero-cost distribution**: static hosting is free; public Nostr relays are free.
   Phase 1 costs the operator nothing per user. Phase 2a adds a relay, which is the only
   thing in the product that has a running bill.
3. **Honest funding**: everything that can be free stays free. The client is open source
   and client-side gates are unenforceable, so the only things that could ever be gated
   are services the operator genuinely pays for. The intent is that users who find the
   product valuable fund development and infrastructure directly, and that gating never
   has to be turned on.
4. **Transparent by default**: running costs and donations received are published, in the
   app and in the repo. Asking for money without showing the bill is not an option.
5. **Marketing loop**: free users publish workout summaries and shared programs to
   *public* relays, which advertises the product inside the Nostr social graph.

## 4. Infrastructure philosophy

Rules that govern every technical decision:

1. **Static client, dumb hosting.** The app is files. Anything that can run in the
   browser runs in the browser. A server component may only exist if the feature is
   *physically impossible* client-side (cross-user shared state, work while the user's
   browser is closed, secrets, payment verification).
2. **The relay is the cost center, not the paywall.** Free = local + public relays. The
   operator's relay adds encrypted backup and retention — it is what donations pay for.
   Phase 2a has **no admission step at all**: any pubkey may back up, and turning the
   auto-backup toggle on is the whole of it. What the relay enforces is a *write policy*
   on content, not on identity — it accepts Workstr's own encrypted records and rejects
   everything else, so it never becomes a general-purpose relay carrying other clients'
   notes. Identity-based admission is a thing this design deliberately does not have; if
   the Section 11 fallback ever fires it has to be *introduced* (Phase 2b), and that is a
   real delta, not a config change.
3. **Keys never touch the app.** All signing and NIP-44 encryption/decryption is
   delegated to the user's signer through a signer abstraction. The app never asks for,
   stores, or transmits an `nsec`. Pasting an nsec is not offered, ever.
4. **Local-first.** IndexedDB is the source of truth for the UI. The relay is an
   encrypted replica. The app must be fully usable offline (PWA service worker).
5. **Data is never hostage.** Free users get JSON export/import. Relay data is standard
   Nostr events readable by any client with their key. If funding fails and the relay
   shuts down, the wind-down commitment in Section 11 applies.
6. **Modular by contract.** Small modules with explicit interfaces (Section 8), so each
   can be built, tested, and AI-generated independently with minimal context.
7. **Operator privacy.** Public infrastructure (domain, Pages, VPS or home relay) is
   registered/paid privately (Njalla, crypto). Home IP is never exposed: the relay is
   either on a VPS or at home behind a VPN forwarded port.

## 5. Technical requirements

### 5.1 Functional (feature parity with self-hosted Workstr)

- **Exercise library**: search, filter by category/muscle/equipment/difficulty,
  favourites, images, and removal from the library. **Catalog-only**: exercises are
  imported from the Workstr catalog, not authored locally — there is no create or edit
  form, by the same reasoning that keeps publishing closed (below). Users compose at the
  program level, not the movement level.
- **Owned equipment**: the user records the equipment they actually have; it drives a
  "My equipment" filter in the library and keeps generated workouts from proposing
  exercises the user cannot perform. Bodyweight movements stay visible under every kit.
- **Workout sheets (programs)**: ordered exercises with set/rep/rest/weight targets;
  temporary sheets; stable slug per sheet.
- **Train**: start a session from a sheet, log sets (reps, weight in kg canonical),
  rest timer, wake-lock (no-sleep video fallback), finish & review.
- **Progress**: weekly volume, muscle distribution, estimated-1RM records, training
  streak, body-weight log.
- **Recovery generator**: suggests exercises based on muscle recovery state computed
  from session history + the canonical muscle map (`muscles.js`, reused verbatim).
- **Quick Workout**: one-tap generated session from recovery state and owned equipment,
  for when the user has no program in mind.
- **Nostr layer**:
  - Discover: browse and import the Workstr catalog — operator-signed exercises and
    programs read from public relays, every signature verified (Section 6.1).
  - Share a session summary as a `kind:1` note, text plus the program's muscle map when
    one exists.
  - Support the project: zap the operator npub, with the app and landing page aligned
    around public zap receipts as the funding/accounting trail (Section 11).
- **Workstr relay (Phase 2a)**: encrypted multi-device sync of all private data; retention
  guarantee. Available to anyone who turns on auto-backup.

**Deliberately not in the product** (each was specified, evaluated, and dropped — do not
reintroduce without revisiting the reasoning):

- **Users publishing exercises.** Permanent. Open exercise publishing fills a catalog with
  off-standard entries and duplicates of the same movement; the Workstr catalog stays
  operator-signed so it stays coherent. See Section 6.1.
- **Weekly plan / mesocycle planner.** Cut. The `plan` object store survives in the schema
  unused (Section 7.2) — no feature reads or writes it.
- **NIP-98 media upload.** Removed after implementation: unreliable in practice, and it put
  a second signer prompt in the middle of a publish for no user-visible gain. Summaries
  carry the program's existing muscle-map URL or go text-only.
- **RPE logging.** `session_sets.rpe` is typed and never written. Open question, not a
  commitment — see Section 13.12 before building it.

**Planned for a later phase:** users publishing their own *programs* (`kind:33402`) —
Section 10, Phase 3. Programs are authored work, so the duplicate-and-garbage problem that
rules out open exercise publishing does not apply the same way.

### 5.2 Non-functional

- **Browsers**: evergreen Chrome/Firefox/Safari, iOS Safari PWA installability.
- **Secure context**: HTTPS everywhere (required for service worker, `crypto.subtle`,
  NIP-07). Dev must also be a secure context (see Section 12).
- **Offline**: full app function without network except Nostr operations.
- **No build-time secrets**: the repo is public; config is public constants.
- **Performance**: first load < 500 KB gzipped (no heavy frameworks required; see 5.3);
  IndexedDB reads must render lists of 1,000+ sessions without jank.
- **Honest publish state**: nothing is reported as Published unless a relay actually
  acknowledged the EVENT. `nostr-tools` resolves some connection failures as a *string*
  rather than rejecting, so relay results are inspected, not merely awaited, and the
  event is re-queried to confirm before the UI claims success.
- **Modularity**: no file > ~400 lines; no module imports more than 3 sibling modules.
  (Lesson from the predecessor project: a monolithic `index.html` is unmaintainable
  and expensive to feed to AI tools.) The app shell and live runner now satisfy the
  size target through focused controllers; the rule continues to bind every new and
  modified module.

### 5.3 Stack

- **Language**: modern JavaScript (ES modules) or TypeScript (recommended: TypeScript
  for AI-assisted coding — types are compressed documentation).
- **Build**: Vite. Output = static `dist/` deployable to GitHub Pages.
- **UI**: vanilla TypeScript with template-string rendering — no framework was needed and
  none was added. The self-hosted Workstr CSS is vendored as `workstr-reference.css` and
  is the design reference.
- **Nostr**: `nostr-tools` (event creation, filters, relay pool, nip19, nip44 helpers)
  — but all *signing/encryption* calls go through the signer abstraction, never
  directly to a key.
- **Storage**: IndexedDB via the `idb` wrapper library.
- **Testing**: Vitest for pure modules (catalog parsing, recovery math, stats, equipment
  matching, import-state resolution, sync merge), `fake-indexeddb` for store tests, and
  Playwright headless Chromium for the browser surface (Section 12).

---

## 6. Nostr protocol usage (NIPs)

| NIP / kind | Role in Workstr Web |
|---|---|
| **NIP-01** | Base protocol: events, filters, REQ/EVENT/EOSE over WebSocket. Used for all relay I/O. |
| **NIP-07** | Browser-extension signer (`window.nostr`): `getPublicKey()`, `signEvent()`, `nip44.encrypt/decrypt`. Primary desktop login. |
| **NIP-46** | Remote signer ("bunker"/Amber): same operations over an encrypted relay channel. Primary mobile login. Connect via `bunker://` URI or `nostrconnect://` QR. |
| **NIP-44** | Versioned encryption used to encrypt **all private data events** to the user's *own* pubkey (self-encryption: conversation key of user↔user). |
| **NIP-78 (kind 30078)** | Arbitrary app data, addressable-replaceable. Carrier for every private encrypted record (sessions, sheets, body-weight, settings, library overrides). `d` tag = record address (Section 7.3). Because 30078 is a *shared* kind other apps also publish, the Workstr relay's write policy filters on the `workstr:v1:` `d` prefix as well as the kind. Phase 2a. |
| **NIP-101e (kind 33401)** | Exercise template. **Read-only for the client**: the app imports these, it never authors them. Written only by the operator key. Tag layout as the self-hosted app emits it: `d`, `title`, `format`, `format_units`, `equipment`, `t` topics, Workstr's granular `workstr_muscle` tags, a `workstr_meta` JSON tag, and `imeta` for media. |
| **NIP-101e (kind 33402)** | Workout template (program). References exercises via `a` tags: `33401:<pubkey>:<d>`. Read-only today; user-authored programs are a Phase 3 item. |
| **kind 1** | Public workout summary note (social sharing). The only event type the client currently signs on the user's behalf. |
| **NIP-42** | Relay AUTH. **Not used** — decision record. It was specified to enforce a pubkey allowlist, and to scope reads so a pubkey saw only its own records. Both jobs were dropped: backup is open to everyone, and open reads are acceptable because every payload is NIP-44 ciphertext. Event signatures already bind authorship, so the write policy can identify an author without AUTH. Reintroduce it only if reads must be scoped or admission returns (Phase 2b). |
| **NIP-98** | HTTP Auth events (kind 27235). **Rejected for media upload** — built and removed: unreliable against the media host, and it inserted a second signer prompt mid-publish for no user-visible gain. Kept in this table as a decision record; if media hosting returns it is via Blossom on the operator's own host (Phase 3), re-evaluated from scratch. Still the right tool for authenticating a request to the operator's *own* endpoint (relay-access requests, Phase 2a). |
| **NIP-19** | bech32 encoding (`npub`, `naddr`, `nevent`) for display and share links. |
| **LNURL-pay / lud16** | The operator's Lightning address in `kind:0`, used as the LNURL-pay target behind zaps. It is payment plumbing, not a separate primary donation rail: v1 support copy steers users to Nostr zaps because zaps produce public receipts. |
| **NIP-57** | Zaps and zap receipts (`kind:9735`). The canonical donation path for Workstr, because every counted donation must leave a verifiable public receipt. Donation prompts, supporter recognition, and the funding transparency panel are computed from these receipts client-side. Phase 1, core, not optional. |
| **NIP-47 (NWC)** | V2 support follow-up. Nostr Wallet Connect enables custom in-app zap amounts without leaving Workstr: build/sign the NIP-57 zap request, fetch the LNURL invoice, pay through the user's wallet, then verify the `kind:9735` receipt before claiming success. |

**Important distinction**: NIP-46 = remote *signing* (identity). NIP-47/NWC = remote
*wallet* (payments). They are separate connections with separate permissions.

**Terminology (used consistently from here on)**: a **supporter** is someone who has
donated. A **backup user** is someone who has turned auto-backup on. These are
deliberately *not* the same set — backup is open to everyone and supporting is voluntary;
neither one buys the other. Do not use "subscriber", "paying user", "premium",
"allowlist", or "access request" anywhere in the product or the code — under this design
there is nothing to be admitted to.

### 6.1 How the NIPs work together (flows)

**Boot (no identity — the default state)**
1. The app opens straight into training against the `local` namespace
   (`workstr-local`). No signer, no prompt, no npub. Everything except the Nostr layer
   works here, forever, for a user who never signs in.
2. Sign-in is optional and lives in Settings. It is not a gate, a splash screen, or a
   precondition for any local feature.

**Sign in and adopt (optional)**
1. User picks a signer in Settings: NIP-07 (if `window.nostr` exists) or NIP-46 (paste
   `bunker://` URI or scan QR).
2. App calls `signer.getPublicKey()` → `pubkey` names the target namespace
   (`workstr-<pubkey>`), so multiple identities on one device never mix.
3. **Adoption, decided once:**
   - Target namespace is empty → the `local` namespace is copied into it wholesale.
     Keys are preserved so autoincrement ids and cross-store references (`sheet_id`,
     `session_id`, `exercise_id`) stay valid.
   - Target namespace already holds data → ask the user, once, which side to keep.
   - **Namespaces are never merged.** Merging two histories without a sync protocol
     produces duplicates nobody can untangle; a copy-or-keep choice is comprehensible.
4. "Has user data" means: any session, set, sheet, sheet row, body-weight entry or
   blob, or any exercise the user favourited, deleted, or that did not come from
   the bundled seed. A namespace holding only untouched seed rows counts as empty, so
   signing in right after a clean install never triggers the prompt.
5. Sign-out returns to the `local` namespace and leaves both databases intact.

**Save (free, always)**
1. User edits a sheet / logs a set / finishes a session.
2. Store module writes to IndexedDB immediately. UI reads only from IndexedDB.
3. If auto-backup is on, the record is queued for encrypted sync (below).

**Encrypted sync (phase 2)**
1. Sync engine serializes the changed record to canonical JSON.
2. `signer.nip44Encrypt(ownPubkey, json)` → ciphertext. (Self-encryption: only the
   user's key can decrypt.)
3. Wrap in `kind:30078`, tags: `[["d", "<address>"], ["client", "workstr"]]`,
   `content = ciphertext`. `signer.signEvent(event)`.
4. Publish to the Workstr relay. No AUTH step: the relay accepts any correctly signed
   `kind:30078` whose `d` tag starts with `workstr:v1:`, and rejects everything else.
5. On another device: REQ `{kinds:[30078], authors:[pubkey], since:<lastSync>}` →
   decrypt each event via `signer.nip44Decrypt` → merge into IndexedDB
   (last-write-wins on `updated_at`, per record).
6. Decrypted results are cached in IndexedDB so decryption is a once-per-device cost
   (NIP-46 round-trips are slow; batch and lazy-decrypt oldest history on demand).

**Share a session summary (free)**
1. Render summary text (kg or lb per user setting; canonical storage is kg): program
   name, duration, set count, volume, muscles worked, top set per exercise.
2. If the session came from a catalog program that carries a rendered muscle map, attach
   that URL as an `imeta` tag and append it to the note. No upload happens — see the
   NIP-98 decision above. Otherwise the note is text-only.
3. Sign `kind:1`; publish to the write-relay set (Section 6.2); verify acknowledgement
   before reporting success (Section 5.2).

**Discover & import — the Workstr catalog (free)**

This is an author-filtered catalog, *not* open discovery of the Nostr commons. The
distinction is deliberate and load-bearing:

1. REQ each catalog relay in parallel: `{kinds:[33401], authors:[OPERATOR_PUBKEY], limit}`
   and the same for `33402`. Per-relay timeout; partial failure is tolerated; if *no*
   relay answered, throw, so the UI can tell "offline" from "the catalog is empty".
2. `verifyEvent` every event. Drop anything that fails. **The author filter plus the
   signature check is the entire spam and quality model** — no keyword blocklists, no
   heuristic validation, no `t`-tag denylist. Anyone may copy a `d` tag; nobody can forge
   the operator's signature.
3. Merge across relays and dedupe by full address `<kind>:<pubkey>:<d>`, keeping the
   newest `created_at`. A second dedupe pass collapses catalog entries that describe the
   same movement under a generated slug, preferring the clean title-derived slug.
4. Cache the raw signed events in `settings.canonCache` with a fetch timestamp, so
   Discover renders offline and a cold start does not block on the network.
5. Import = insert into IndexedDB with the origin address and `origin_created_at`.
   **Everything imports as a snapshot** — no auto-follow of catalog updates. Programs
   import through a dependency walk that pulls in every referenced exercise first.
6. Author `kind:0` profiles are fetched and cached for display.

**Why exercises are operator-signed, permanently**: an open exercise vocabulary degrades.
Real relay data fills with entries that ignore the tag standard and with a dozen
near-identical copies of the same movement, and no client-side filter reliably sorts the
good from the noise. A curated, signed catalog is the only version of this that stays
usable — and because it is published to *public* relays under a plain NIP-101e kind, any
other client can read it. Curation is a quality decision, not a lock (Section 11.3).

**Update detection (why an import is not a copy)**
1. A row's identity is its full `nostr_address`, never the slug alone.
2. A row still carrying its address is by definition unmodified, so a newer remote
   `created_at` on that address means an update is genuinely available — surfaced as
   Import / In library / Update per card.
3. **Fork-on-edit is the standing rule for any future edit path**: whatever first lets a
   user modify an imported row must clear that row's nostr fields, making it the user's
   own so no catalog update can clobber their work. Today exercises are catalog-only
   (no edit form exists), so the rule binds programs and anything added later — it is
   written down now because retrofitting it after edits ship means silently overwriting
   somebody's work.

**Support the project (free, Phase 1)**
1. The app support panel and the Workstr landing/support page must stay in sync: both
   present **Nostr zaps as the canonical donation route** because zaps create public
   `kind:9735` receipts. The support surface may show the operator npub, zap links, and
   explanatory Lightning/LNURL context, but it must not advertise plain Lightning or
   on-chain BTC as normal v1 donation paths that bypass receipt accounting.
2. Funding panel: REQ `{kinds:[9735], "#p":[operatorPubkey], since:<monthStart>}` from the
   broad read set, sum the bolt11 amounts, display month-to-date against
   `MONTHLY_COST_SATS`. Both sides are sats, so the percentage is exact and needs no price
   feed. Entirely client-side — zap receipts are public events, so transparency costs no
   backend.
3. **Only receipts signed by the wallet provider's key count** (`ZAP_RECEIPT_SIGNER_PUBKEY`,
   pinned in `core/funding.ts` from the LNURL-pay metadata). Anyone can publish a
   `kind:9735` tagged to any pubkey; without the signer check the published total would be
   a number strangers control, and the transparency claim in 3.4 would be worthless.
4. **A failed fetch reports "unknown", never zero.** "Nobody donated" and "we could not
   check" are different claims and only one is true. Note `querySync` *resolves empty* on
   an unreachable relay rather than rejecting — the same trap `share.ts` documents for
   publish — so the connection is established explicitly before the query.
5. **No custom in-app amount buttons in v1.** They require NWC/NIP-47 plus the full NIP-57
   zap flow. In v2, Workstr can add custom in-app zaps: sign zap request, fetch invoice,
   pay via NWC, then verify the receipt before claiming success.

**Turn on auto-backup (Phase 2a)**
1. User flips the **Auto-backup** toggle in Settings → Backup. That is the entire
   ceremony: no request, no approval, no waiting, no status screen.
2. The toggle needs a signer, because records are NIP-44 encrypted to the user's own
   pubkey and signed by it. Flipping it while signed out routes through sign-in first;
   this is the one unavoidable step and it already exists.
3. On first enable the client enqueues **everything already in IndexedDB** — every past
   session, sheet, body-weight entry and synced setting — not just subsequent changes.
   A toggle labelled backup that silently skips existing history is a lie.
4. From then on the sync engine runs automatically: on app open, and after local changes,
   with backoff on failure. A manual "sync now" exists as a fallback, not as the normal path.
5. Flipping it off stops syncing and leaves both sides intact. It does not delete what is
   already on the relay; a separate explicit action does that.
6. *Only if the Section 11 fallback has fired:* admission control is introduced for new
   pubkeys (Phase 2b). It does not exist before then.

### 6.2 Relay sets (there is more than one "public relays")

Three distinct sets, and conflating them causes real bugs:

| Set | Used for | Shape |
|---|---|---|
| **Catalog relays** | Reading the operator-signed Workstr catalog | Small (about 3). Queried in parallel, results merged and deduped. More relays here buys nothing — the same signed events live on each. |
| **Write relays** | Publishing the user's `kind:1` summaries | Broad (about a dozen). Reach is the goal: a summary is an advertisement, and relays reject or drop writes unpredictably. |
| **Workstr relay** | Encrypted `kind:30078` sync (Phase 2a) | Exactly one, write-policy filtered. Never mixed into either set above, and never published in the user's `kind:10002` relay list — it is a private destination this client writes to, not a relay the user announces. Advertising it would invite every other Nostr client to publish the user's notes there. |

Both public sets ship as defaults and are user-editable in settings.

### 6.3 The operator key is the trust root

One hardcoded public key defines the catalog. It is a public constant in the client, and
its **private** half is what signs every catalog event — held by the operator, never by
the app, and never on the relay host.

Consequences to design around:

- Losing it means the catalog can never be updated again under the same addresses.
  Clients would keep working from cache and from already-imported snapshots, but the
  catalog would be frozen. Back it up with the same seriousness as the LMDB snapshots.
- Rotating it invalidates every `nostr_address` in every user's library, since the pubkey
  is part of the address. Imported rows would go on working — they are snapshots — but
  update detection would break for every one of them. There is no cheap rotation.
  Treat the key as permanent; if it ever must change, the migration is a client release
  that maps old addresses to new ones, not a config change.
- Compromise means an attacker can publish catalog entries users will trust. Detection is
  manual. This is the price of the curation model and it is worth stating plainly.

---

## 7. Data: what is saved, and where

### 7.1 The three storage tiers

| Tier | Where | Contents | Who |
|---|---|---|---|
| **Local** | IndexedDB, per namespace, per device | Everything: exercises, sheets, sessions, sets, body-weight, settings, catalog cache, caches of decrypted sync data | Everyone |
| **Public relays** | Catalog relays for reads, write relays for shares (Section 6.2) | Inbound: the operator-signed `33401`/`33402` catalog. Outbound: only `kind:1` summaries the user explicitly shares. Plaintext by design. | Everyone |
| **Workstr relay** | Operator's strfry (write-policy filtered) | `kind:30078` NIP-44 ciphertext of all private records, and nothing else | Anyone with auto-backup on |

Note that the curated exercise library is **not** in that table: it is published to public
relays like any other catalog (Section 10, Phase 2a). Locking curation behind the relay
would contradict Section 3, and a public library is a better marketing asset than a gated
one.

Users without relay access keep their private data **only** in IndexedDB (plus manual JSON
export). That fragility is a real limitation, not a lever — the relay exists to fix it for
whoever wants it, and export/import exists so data is never hostage either way.

### 7.2 IndexedDB schema (mirror of the SQLite schema)

Database: `workstr-<namespace>`, version-managed migrations. The namespace is either
`local` (the anonymous account the app boots into) or a hex pubkey after sign-in. Same
schema either way; see the adoption rules in Section 6.1.

Object stores (key → value shape; keep field names identical to the self-hosted
SQLite columns to allow straight ports of store logic):

- `exercises` (key `id` auto): slug (unique index), status (index), name, description,
  category, muscle_group, muscles[], equipment[], difficulty, tags[], instructions[],
  image_url, favourite, default_sets, default_reps, default_rest, source_type,
  status, nostr_event_id, nostr_pubkey, nostr_address, nostr_published_at,
  **origin_created_at**, created_at, updated_at
- `sheets` (programs): id, slug, name, notes, difficulty, tags[], is_temporary,
  nostr_pubkey, nostr_address, nostr_event_id, nostr_published_at,
  **origin_created_at**, created_at, updated_at
- `sheet_exercises`: id, sheet_id (index), exercise_id, exercise_slug, exercise_name,
  muscle_group, image_url, position, sets, reps, rest, weight, notes
- `sessions`: id, sheet_id (index), sheet_name, started_at (index), finished_at, notes,
  summary_image_url, nostr_event_id (of the kind:1, if shared), exercises[] (denormalized
  snapshot of what was trained, so history survives library edits)
- `session_sets`: id, session_id (index), exercise_id (index), exercise_slug,
  exercise_name, set_number, reps, weight_kg, rpe *(typed, never written — see 5.1)*,
  completed_at
- `plan`: **removed at DB v2.** The store was created by v1 and never read or written.
  Opening a v1 database drops it; new databases never create it.
- `bodyweight`: id, date (unique index), weight_kg, notes
- `settings`: key/value — unit preference, public relay list, Workstr relay URL, signer
  type, sync cursor, height, target weight, owned equipment, `canonCache`, and
  `seedVersion` (highest starter-seed version applied to this namespace)
- `sync_queue`: pending outbound record addresses (Phase 2a)
- `blobs`: locally cached exercise images (Cache API is also acceptable)

**`origin_created_at`** is the provenance field the whole import model turns on: the
`created_at` of the catalog event a row came from. Together with `nostr_address` it
answers "is this row still an untouched copy, and is there a newer one upstream?" —
see the update-detection flow in Section 6.1.

**`canonCache`** holds raw signed catalog events plus a fetch timestamp. Storing the
*signed* events rather than parsed rows means the offline path re-verifies signatures
exactly like the online path; there is one parser, not two.

### 7.3 The two `d` tag conventions

There are two separate address vocabularies. They must not be confused, and the
difference in versioning is deliberate.

**Public catalog (shipped, operator-signed, plaintext):**

```
workstr:exercise:<slug>           → one catalog exercise  (kind 33401)
workstr:program:<slug>            → one catalog program   (kind 33402)
```

No `v1` segment, on purpose: these addresses are **permanent public identifiers**.
Every imported row in every user's library stores the full address
`33401:<operator>:<d>`, and update detection compares against it. Versioning the prefix
would orphan every existing import the day it changed — the schema evolves through tags
inside the event, never through the address.

**Private sync records (Phase 2a, self-encrypted):**

One `kind:30078` event per logical record, addressable and replaceable. The `d` tag
encodes the record type and identity; edits republish the same `d` (relay keeps only
the latest). Deletions publish a tombstone payload (`{"deleted":true}`).

```
workstr:v1:exercise:<slug>        → one exercise (only user-created/modified ones)
workstr:v1:sheet:<slug>           → one program, including its exercise rows
workstr:v1:session:<uuid>         → one session including all its sets
workstr:v1:bodyweight             → the whole body-weight log (append-heavy but tiny)
workstr:v1:settings               → user settings worth syncing
workstr:v1:manifest               → index of all record addresses + updated_at, for fast diff sync
```

Here `v1` *is* wanted: these addresses are private, single-author, and rewritable in
bulk by the client that owns them, so a format break is a migration the app can perform
against its own data.

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

Modules marked `[planned]` do not exist yet; everything else is shipped.

```
src/
  core/
    types.ts           # All shared types: Exercise, Sheet, Session, Set, settings (no logic)
    ids.ts             # slugify, uuid, address builders
    units.ts           # kg↔lb, e1RM formulas (pure functions)
    muscles.ts         # canonical muscle map — copied verbatim from public/muscles.js
    equipment.ts       # equipment key normalization, owned-equipment matching,
                       #   bodyweight-always-available rule
    funding.ts         # lud16, pinned zap-receipt signer key, published monthly cost
  signer/
    types.ts           # interface Signer { getPublicKey; signEvent; nip44Encrypt; nip44Decrypt }
    nip07.ts           # window.nostr adapter
    nip46.ts           # bunker adapter (connect URI/QR, request queue, batching)
    idenstr.ts         # [planned] OPTIONAL third backend: HTTP adapter to a self-hosted
                       #   Idenstr, so this codebase can also replace the self-hosted UI
  db/
    schema.ts          # IndexedDB stores + versioned migrations, namespace naming
    store.ts           # CRUD API — port of self-hosted src/app/store.js semantics
    adopt.ts           # anonymous `local` namespace, has-user-data detection,
                       #   whole-namespace copy, namespace delete (Section 6.1)
    export.ts          # JSON export/import of the entire local DB
  nostr/
    pool.ts            # relay sets (catalog / write) and shared profile types
    zaps.ts            # zap-receipt validation, sats totals, month boundary, fetch
    canon.ts           # the Workstr catalog: operator-filtered queries, signature
                       #   verification, 33401/33402 → local row mapping, dedupe,
                       #   offline cache
    programImport.ts   # program import + dependency walk, import-state resolution
    share.ts           # kind:1 summary composition, publish, acknowledgement check
    codecs30078.ts     # [planned, Phase 2a] 30078 encrypt/decrypt wrappers (uses signer)
  sync/
    engine.ts          # [stub] LWW comparison only. Phase 2a fills in queue, manifest
                       #   diff, push/pull, lazy decrypt.
  features/
    library/           # exercise library UI
    sheets/            # program builder UI
    train/             # live session UI (timers, wake lock)
    progress/          # charts, records, streaks, body-weight (stats.ts is pure)
    recovery/          # recovery-state computation + suggestions + Quick Workout
                       #   (recovery.ts and quickWorkout.ts are pure)
    discover/          # catalog browse/import UI
    support/           # zap-first support UI, funding panel (reads kind:9735 receipts),
                       #   and later NWC custom-zap flow. Paid relay invoicing lands here
                       #   only if the Section 11 fallback fires.
    backup/            # [planned, Phase 2a] the auto-backup toggle and its status line,
                       #   composed into the existing Settings → Backup panel next to
                       #   JSON export/import. Backup is a data-durability control, not
                       #   a funding one — it does not live in support/.
  app/
    shell.ts           # root state, namespace boot, navigation, controller composition
    catalog-controller.ts      # catalog cache/profile and library actions
    identity-controller.ts     # signer connection, adoption, sign-out
    preferences-controller.ts  # settings, history/body, backup, recovery handlers
    program-builder.ts         # normal/superset/EMOM program-builder lifecycle
    session-persistence.ts     # stored session → active/history adaptation
    session-runner.ts          # live-session coordinator
    state.ts           # AppState shape, view/subview union, active-session types
    layout.ts          # page chrome
    format.ts          # shared HTML helpers, filters, author pills
    bodymap.ts         # muscle-map rendering
    pwa.ts             # service worker registration
public/
  manifest.webmanifest, icons, sw.js, favicon, workstr-reference.css
```

Navigation is four views — exercises, workouts, statistics, settings — with subviews
(library, discover, programs, history, recovery, training, body). There is no router
module and no URL routing; view state lives in `app/state.ts`. If deep links are ever
wanted, hash routing is the option Section 9.1 reserves.

Coding rules for AI efficiency:
1. Generate `core/types.ts` and `signer/types.ts` first; every other module is written
   against them.
2. Pure-logic modules (`units`, `recovery`, `quickWorkout`, `stats`, `equipment`, canon
   parsing, import-state resolution, sync merge) get Vitest tests in the same PR — they
   are the cheapest to verify and the costliest to get silently wrong.
3. Never let a `features/*` module import another feature; they communicate through
   `db/store` and `app/state`.
4. Port, don't reinvent: the self-hosted repo's `store.js` and the tag mappings in
   `idenstr.js` are the reference semantics. Translating a known spec is cheaper and
   safer than re-deriving one.
5. Keep `app/shell.ts` and `app/session-runner.ts` as focused coordinators. New feature
   workflows go into the controller or feature module that owns the behavior.

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
4. Phase 2a adds: `relay` → address of the relay host (see 9.3), managed by a small
   DDNS updater against Njalla's API if the relay is home-hosted behind a VPN.

### 9.3 Where the relay lives (Phase 2a choice)

Two valid options, identical architecture, trivially migratable (strfry's LMDB
directory is portable; cutover is a DNS change):

- **Option A — home server (validate for free):** strfry + write-policy plugin in Docker,
  network-namespaced behind a gluetun/WireGuard VPN container with a forwarded port.
  DNS `relay.workstr.example` → VPN exit IP. Note: consumer VPN providers commonly
  disallow forwarding low ports, so the relay listens on a high port —
  `wss://relay.workstr.example:PORT` is fully valid for WebSockets; only plain
  websites need 443. TLS via **DNS-01** ACME challenge (no port 80 required); ACME
  clients support Njalla's DNS API. Caveats: residential uptime, VPN IP reputation,
  some networks block VPN ranges.
- **Option B — small VPS (when donations sustainably cover it):** 2 vCPU / 4 GB / 40 GB from a
  privacy-friendly provider (Njalla sells crypto-payable VPSes; cheaper mainstream
  providers exist). Caddy terminates TLS on 443; home IP never involved. Lightning
  payments still route to the operator's home LND node over a private mesh
  (e.g. Tailscale) — the node never moves.

**Recommendation: launch Phase 1 with no relay at all; do Phase 2a as Option A; move to
Option B once recurring donations exceed the VPS cost with margin.** Option A is chosen
precisely because it survives at zero revenue — do not design the relay around donation
income arriving.

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
3. `signer/types.ts` + `signer/nip07.ts`; optional sign-in from Settings showing the
   connected npub.
4. `db/schema.ts` + `db/store.ts` + `db/adopt.ts` (+tests, using fake-indexeddb) — the
   `local` namespace exists from the first commit; identity is added on top of it, never
   underneath it.
5. Dev environment (see Section 12) proven from a phone.

**Exit criteria:** visit the real domain, install as PWA, use the app with no identity at
all, optionally sign in with a NIP-07 extension and see your npub, offline reload works.

### Phase 1 — The free product (no workstr relay, no server at all)

**Goal:** full Workstr feature parity, local-first, public sharing. Operator hosts
nothing.

1. **Library block:** library UI on `db/store` — browse, search, filter, favourite,
   remove — plus equipment normalization and the owned-equipment filter. No authoring
   form; the library is filled from the catalog and the bundled seed.
2. **Sheets block:** program builder (ordered exercises, targets, slugs).
3. **Train block:** session runner — start from sheet, log sets, rest timer,
   wake lock, finish & review. This is the daily-use core; polish it first.
4. **Progress block:** volume/muscle charts, e1RM records, streak, body-weight log.
5. **Recovery block:** recovery-state computation from session history + muscle map;
   suggestion UI and Quick Workout. Pure functions + tests.
6. **Signer block 2:** `signer/nip46.ts` (bunker URI + QR connect, request batching)
   → mobile sign-in without an extension.
7. **Nostr block:** `nostr/pool.ts`, `nostr/share.ts` — compose and publish the `kind:1`
   summary to the write-relay set, with acknowledgement checking. No media upload; no
   user-authored 33401/33402.
8. **Discover block:** `nostr/canon.ts` + `nostr/programImport.ts` — operator-filtered
   catalog queries, signature verification, dedupe, offline cache, snapshot import with
   dependency walk, fork-on-edit provenance.
9. **Safety valve:** JSON export/import of the whole local DB.
10. **Starter seed:** bundle **three beginner programs and every exercise they
    reference** as JSON, shipped with the app. A first-run library that is empty until
    the user finds Discover is a bad first impression, and the seed makes the app
    genuinely useful with no network and no identity. Rules:
    - Seeded rows carry `source_type: 'bundle'`, which the adoption check already treats
      as "not user data" — so seeding does not make a clean install look occupied
      (Section 6.1).
    - **The seed only ever backfills.** It must never overwrite, re-create, or resurrect
      a row the user has edited, favourited, or deleted. Seeding is idempotent and runs
      against empty slots only.
    - Seed content mirrors catalog entries where they exist, so importing the catalog
      later recognizes them by address instead of duplicating them.
11. **Support block:** a zap-first support screen aligned with the landing/support page:
    operator npub/zap target, clear receipt-based funding copy, and a live funding panel
    that REQs `kind:9735` zap receipts for the operator pubkey from public relays and
    shows month-to-date against the published monthly infrastructure cost. No on-chain BTC
    or plain-Lightning donation route in v1; every advertised donation path should produce
    a public receipt. Zero backend; zap receipts are public events. Ships in Phase 1
    because it is *cheaper to build than the paywall*, and because a funding model that
    starts asking in Phase 3 has no data by Phase 2a.
12. **Release pass:** run `docs/RELEASE-QA.md` against the deployed site and clear its
    blocking sections before tagging 1.0.

**Exit criteria:** a stranger installs the app, trains for a month, and shares summaries
**without ever creating an identity**; a Nostr user additionally signs in, adopts their
local history, imports catalog programs, and supports the project with a zap — with the
operator hosting zero infrastructure.

### Phase 2a — The Workstr relay (donation-funded)

**Goal:** encrypted backup and retention for anyone who turns it on, funded by donations.
No payment service and no admission service are built in this phase.

Server side:
1. **strfry** with a **write-policy plugin** and no AUTH. The policy accepts an event only
   when its kind is `30078` *and* its `d` tag starts with `workstr:v1:`; everything else is
   rejected, `kind:1` included. This is what stops the relay becoming a general-purpose
   relay carrying other clients' notes, and it is the only thing that stops it — the relay
   URL ships in public JavaScript and relay crawlers index it whether or not anyone
   advertises it. Reads are open: payloads are NIP-44 ciphertext, and the `d` tags being
   visible in the clear is an accepted trade (Section 13).
2. **No access service.** There is no `POST /api/access`, no `GET /api/status`, no NIP-98
   request, and no allowlist file. Deleted from this phase on purpose; see 4.2.
3. **Abuse controls**, since neither payment nor admission is limiting anything: a
   per-pubkey storage quota, a total storage ceiling with an alert, and a block list for
   the individual bad actor. Explicit from day one (Section 13).
4. **TLS + DNS:** Caddy (VPS, port 443) or DNS-01 certs + high port (home/VPN);
   `relay.workstr.example` DNS record; DDNS updater if home-hosted.
5. **Backups:** nightly snapshot of strfry's LMDB directory off-machine
   (users' encrypted backups are the one thing that must never be lost).
6. **Cost publication:** the monthly running cost goes in the repo and into the Phase 1
   funding panel. Rule 3.4 is not optional.

Client side:
7. **Toggle block:** `features/backup/` — the Auto-backup toggle and its status line,
   composed into the existing Settings → Backup panel beside JSON export/import. Turning
   it on backfills everything already in IndexedDB, then syncs automatically.
8. **Sync block:** `sync/engine.ts` — 30078 encrypt/publish on change, manifest diff
   pull on login, LWW merge, lazy decryption (recent first), decrypted cache.
9. *(No auth block and no access block — neither exists under this design.)*
10. **Catalog growth:** the operator key keeps publishing the curated 33401/33402 catalog
    to **public relays**, readable by everyone including other Nostr clients. Authored
    and published from the self-hosted Workstr install. Target: from the launch set
    toward 50–100 exercises and 5–10 programs. Curation is the operator's job by design
    — see Section 6.1 on why exercise authoring is not opened up.
11. *(The retention perk is dropped.* Mirroring users' public events to the Workstr relay
    is incompatible with the write policy in item 1, which rejects every kind but `30078`.
    Retention now means the encrypted records only. Restoring the perk would mean widening
    the policy, which is exactly what keeps other clients' notes off the relay.)

**Exit criteria:** flip Auto-backup on from a phone → no operator action of any kind →
open laptop, sign in, entire history appears after decryption. A `kind:1` publish attempt
against the Workstr relay is rejected by the write policy. Funding panel shows real
donations against a published real cost.

### Phase 2b — Paid access (fallback only, build nothing until triggered)

Built **only** if the funding trigger in Section 11 fires. Scoped here so the fallback is
a known, small delta rather than a redesign:

0. **Admission control itself**, which 2a deliberately does not build: an allowlist the
   policy plugin consults, and NIP-42 AUTH so the plugin knows who is connected rather
   than only who signed each event. This is the honest cost of an open 2a — the fallback
   is a larger delta than it would have been under an allowlisted design, and pretending
   otherwise would make the trigger in 11.4 look cheaper to pull than it is.
1. **Payment glue:** LNbits (or direct LND REST) connected to the operator's existing LND
   node over the private mesh; `POST /api/subscribe {pubkey, plan}` → invoice; on settle
   → append pubkey + expiry to the new allowlist file, hot-reload the policy plugin;
   `GET /api/status/<pubkey>` reports access and expiry.
2. Nightly job prunes expired pubkeys (grace period, e.g. 14 days, before their events
   stop being served).
3. **Client:** invoice QR/copy, payment detection, renewal reminder — added to
   `features/support/`, plus the access-status display that 2a never needed.
4. Every pubkey holding backup data before the trigger date is grandfathered and never
   sees any of this. Nothing on the "never gated" list in Section 11 moves.

Note what is *not* in this list: the relay, the write-policy plugin, the sync engine, and
the backup toggle are all already built in 2a and unchanged. That
is the point of rule 4.2.

### Phase 3 — Growth (optional, in rough order of value)

1. **Milestone zap prompts:** contextual donation moments at PRs, streaks, and after a
   restore-from-relay actually saves someone's history. Builds on the Phase 1 support
   block; this is the highest-value growth item under donation funding, not the third.
2. **Supporter badge** on shared kind:1 summaries + supporters page, resolved from public
   zap receipts. Honor system, no enforcement — it converts well in zap culture and costs
   nothing to run.
3. **User-published programs (`kind:33402`).** The one authoring capability that does open
   up. A program is composed work — a named, ordered, deliberate arrangement — so it does
   not produce the duplicate-and-garbage failure that rules out open exercise authoring
   (Section 6.1). Requirements when it ships:
   - Programs may only reference exercises that already have an address — in practice,
     catalog exercises. That constraint is what keeps the exercise vocabulary clean while
     letting anyone compose on top of it, and it removes the need for a publish-time
     dependency walk entirely.
   - User programs are a **separate discovery surface** from the operator catalog. Never
     merge them into one list: the catalog's whole value is that everything in it is
     signed by one curator.
   - Import stays a snapshot, with the same fork-on-edit provenance as catalog imports.
4. **Blossom media server (optional)** on the relay host: image hosting. Note it needs its
   own answer to "who may upload", since Phase 2a's write policy gates content rather than
   identity and a media endpoint cannot be gated the same way. Re-open the media-upload question here, from scratch — NIP-98 against a third
   party failed (Section 6), a self-hosted Blossom endpoint is a different problem.
5. **NIP-47 (NWC)** wallet connect: one-tap in-app zaps.
6. **Push notifications** for scheduled workouts (requires a small always-on push
   service, which has a genuine per-user cost and so needs its own gating answer).
7. **Coach platform:** third-party trainers publish programs on the relay, keeping their
   own zap/payment relationship with their followers (program-follow with updates;
   imports elsewhere remain snapshots). Builds directly on item 3. The operator's cut, if
   any, is a later decision — this is a content engine first.
8. **Idenstr signer backend (optional)** (`signer/idenstr.ts`): the web codebase becomes usable
   as the UI for self-hosted installs too — one codebase, three signer backends.

---

## 11. Funding

The product is funded by donations. A paid tier is a documented fallback with a stated
trigger, not a roadmap item.

### 11.1 What costs money

**Published monthly target: 85,000 sats.** That single figure is what the app shows, and it
is the denominator for everything below. It lives in `src/core/funding.ts` as
`MONTHLY_COST_SATS`; changing the real cost means changing that constant and shipping.
The target mirrors the public support page: about 55k sats for AI credits and development,
22k for growth tests, 2k for Nostr.build media hosting, 5k for the domain, and 1k buffer.

| Line item | When | Monthly equivalent |
|---|---|---|
| AI credits + development | ongoing | ~55k sats |
| Growth experiments / ads | ongoing | ~22k sats |
| Nostr.build media hosting | paid annually | ~2k sats |
| Domain infrastructure | paid annually | ~5k sats |
| Buffer / rounding | ongoing | ~1k sats |
| GitHub Pages hosting | Phase 0 | 0 |
| Relay host / encrypted backup | later | separate targeted asks when incurred |

**Denominated in sats on purpose.** Donations arrive in sats, so a sats budget compares
directly and the funding panel never needs a price feed to tell the truth. A fiat budget
would drift against the same donations every time the exchange rate moved, and the app
would have to fetch a rate from a third party to say anything at all.

Rule 3.4: asking for money without showing the bill is not an option. Phase 1 is close to
zero in real spend; the figure is published from the start anyway, because the support
screen ships in Phase 1 and a screen that asks without showing is exactly what 3.4
forbids.

### 11.2 Funding ladder, in priority order

1. **Recurring and one-off zaps** from users — app support screen, landing support page,
   and later milestone prompts at PRs and streaks. Zaps are the canonical funding rail
   because they create public receipts.
2. **Targeted zap fundraisers** for specific line items: a year of VPS, the curated library
   photo shoot, a specific feature. Concrete asks outperform open-ended ones, but the
   accounting still resolves from NIP-57 receipts.
3. **Supporter recognition** — badge on shared summaries, supporters page. Honor system,
   resolved from public zap receipts, no enforcement anywhere.
4. *Fallback only:* **paid relay access** (Phase 2b), under the trigger in 11.4.

Plain Lightning payments and on-chain BTC are deliberately not normal donation routes in
v1 because they do not reliably produce the public Nostr receipts the funding meter uses.
If an exceptional out-of-band donation ever happens, do not silently add it to the live
zap total; publish a separate signed accounting note or leave it out of the automated
meter.

### 11.3 Never gated, under any funding outcome

- The client itself — open source, installable, complete.
- Local data and all local features: library, sheets, train, progress, recovery, plan.
- JSON export and import.
- Publishing to and discovering from public relays.
- The curated exercise library.

This list does not move. If it ever needs to move, the honest action is to shut down, not
to re-gate (11.5).

### 11.4 Fallback trigger

If donations cover less than **`[X]`%** of the trailing 12-month infrastructure cost for
**two consecutive quarters**, relay admission switches to paid for *new* pubkeys only:

- Every pubkey already holding backup data on the relay is grandfathered, permanently.
  With no allowlist there is no admission record, so the relay's own data is the roll.
- Announced at least 30 days ahead, on Nostr and in the app.
- Nothing in 11.3 moves; only Workstr-relay admission changes.
- Pricing, if it happens: one plan, priced in sats through the operator's own LND (no
  processor, no fees), under the "don't think about it" threshold.

Writing the condition down *before* it is needed is what makes an optional paywall
credible instead of a rug-pull.

`[X]` is deliberately unset. It cannot be chosen honestly yet: Phase 1 has no
infrastructure bill, so the denominator does not exist. **Fill it in once Phase 2a has
run**, alongside the real cost figures in 11.1 — at that point the monthly bill is known,
the funding panel has a season of zap data behind it, and the number is an observation
rather than a guess. Until then the trigger reads as "there is a threshold, and it will be
published with the costs it refers to", which is the commitment that matters.

It is scheduled as v2.2 (issue #59), not as a 2a launch gate: 2a is what generates the
denominator, so blocking 2a on it was circular. The guard that still bites is on the other
end — **2b must never fire while the placeholder stands.** Switching admission to paid
against an unpublished threshold is the rug-pull this section exists to prevent.

### 11.5 Wind-down commitment

If funding fails outright and the relay shuts down: 30 days' notice, export tooling
verified working before the announcement, and a final window to pull everything down. The
client keeps working — it is local-first and needs no server. Rule 4.5 is the whole point.

### 11.6 Gating rule (non-negotiable, unchanged)

If anything is ever gated, it is enforced by the relay or a server the operator runs.
Client-side-only locks are forbidden — the client is public JavaScript either way, so a
client-side lock is theatre that costs trust and buys nothing.

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
3. **Dev relay stack** (compose file in the repo, `dev/compose.yaml`): strfry with the
   same write-policy plugin as production, so the full toggle→backfill→sync→restore loop
   is testable locally, and so the policy's rejections are testable too — a `kind:1` and a
   wrong-prefix `30078` must both bounce. If Phase 2b is ever built, add the allowlist glue
   and LNbits against a regtest/testnet backend plus a fake-settle endpoint here.
4. **Browser-surface verification.** Unit tests cover pure logic; they cannot catch a
   broken render, a dead button, or an IndexedDB migration that fails on a real origin.
   Drive the **production build** — not the dev server — in headless Chromium via
   Playwright (a devDependency): `npm run build`, serve `dist/` with `vite preview`,
   then script the app. Driver scripts must run where `node_modules` resolves. Any
   change to a view, the shell, or the session runner gets verified this way before it
   is called done.
5. **Release QA pass.** The checks no automation reaches — real iPhone, real signer apps,
   real relays, real network failure — live in `docs/RELEASE-QA.md` as a checklist with
   an expected result per line and a stated blocking rule. It runs against the deployed
   site before every tag. Phase 2a adds fresh-device restore (manifest → lazy decrypt) to
   it; keep the checklist the single copy of that matrix rather than restating it here.

---

## 13. Risks & explicit trade-offs (state these in the product, not just here)

1. **Key loss = data loss.** NIP-44 self-encryption is unrecoverable without the
   user's key. Say it loudly at onboarding; offer JSON export as mitigation. Note this
   only ever applies to a user who *chose* to sign in — the anonymous default has no key
   to lose, only a browser database to clear.
2. **NIP-46 latency.** Every sign/encrypt is a relay round-trip; batch, lazy-decrypt,
   cache. Design flows so a normal workout needs zero signer prompts.
3. **Curated library is copyable.** Signed by the operator key, provenance is obvious,
   and anyone can republish it. This is now a non-issue by design: the library is
   published publicly (Section 7.1), so copying is distribution, not leakage.
4. **Public relays owe nothing.** Shared events can be purged — that's the retention
   argument for the Workstr relay, but also a support-question generator.
5. **Home-hosted relay fragility** (if Option A): residential uptime, VPN IP
   reputation, some networks block VPN ranges. Acceptable at launch; revisit when the
   relay approaches its total storage ceiling.
6. **Addressable-event size limits.** Keep every 30078 under ~64 KB; per-session
   granularity guarantees this.
7. **Legal/boring:** ToS + privacy page (short, honest: "we store ciphertext"), and local
   tax registration once income crosses the relevant small-supplier threshold. Donations
   are not automatically tax-free income — check the local rule before the first
   fundraiser, not after.
8. **Donations very likely undershoot.** The modal outcome for a niche, self-hosted-adjacent
   tool is that donations cover hosting and nothing close to development time. Plan for it:
   Option A (home-hosted) is chosen so the relay survives at zero revenue, and no roadmap
   item may depend on donation income arriving. Treat any month that covers the bill as
   the success case, not the baseline.
9. **Open relay access invites abuse.** Payment is an accidental rate limiter and so is an
   allowlist; this design has neither, so the write policy is the only limiter. Three
   controls are required from day one of Phase 2a, not added after the first abusive
   pubkey: the kind + `d`-prefix write filter, a per-pubkey storage quota, and a total
   storage ceiling with an alert. A block list handles the individual bad actor. Note what
   open signup costs: total storage is no longer bounded by a user cap, so the ceiling and
   its alert are what stand between an abusive pubkey and the disk filling up. Organic
   growth is not the worry — 30078 is addressable, so an honest user's footprint is capped
   by their distinct `d` tags (Section 7.4) — deliberate abuse is.
10. **Introducing a paywall later costs credibility.** Mitigated by publishing the trigger
    and the grandfather clause up front (11.4) — but a community that funded the project
    on "it stays free" will read any gate as a betrayal unless the condition was visible
    beforehand. Never soften 11.3 to make the fallback easier.
11. **Anonymity conflicts with fundraising.** Rule 4.7 keeps the operator private
    (Njalla, crypto, no exposed identity), while donations flow toward a visible person or
    a project people feel they know. In Nostr culture a consistent pseudonymous npub with
    a build-in-public presence is usually enough to resolve this — but decide it
    deliberately now, because a support screen asking for money from a faceless entity
    converts badly.
12. **RPE is an open question, not a backlog item.** The field is typed and unwritten
    because the design question was never settled, and shipping a number nobody
    interprets the same way is worse than shipping nothing. If it is revisited, the
    decisions are: RPE or RIR (RIR is easier for beginners to answer honestly); prompted
    per set or per exercise (per set is more data and more friction, and friction during
    a working set is expensive); and what consumes it — a value logged and never read is
    dead weight, so the consumer should exist before the input does. Until those three
    have answers, the field stays unwritten.
13. **Anonymous data is one browser clear away.** The default account lives entirely in
    one browser profile's IndexedDB, with no key, no sync, and no recovery. Clearing site
    data, losing the device, or an aggressive storage eviction takes everything. Export is
    the only mitigation; surface it honestly rather than burying it in Settings.
14. **A single unmerged namespace decision is irreversible in practice.** Adoption asks
    once and copies wholesale. A user who picks the wrong side keeps both databases on
    disk, but the app offers no path back — make the prompt unambiguous about which side
    is which and what is about to happen.
15. **Operator key loss or compromise** — see Section 6.3. Losing it freezes the catalog;
    rotating it breaks update detection for every imported row in every library. Back it
    up with the same seriousness as the relay's LMDB snapshots, and treat it as permanent.

---

## 14. Definition of done, per phase

- **Phase 0:** PWA installs from the real domain over HTTPS; the app is usable with no
  identity; optional sign-in shows npub; CI deploys on push.
Phase 1 has two separate bars. Conflating them means never shipping, because the second
kind cannot be satisfied before a release exists.

- **Phase 1 — ready to tag v1.0** (gates the tag; every line is checkable in an
  afternoon): the release QA pass in `docs/RELEASE-QA.md` is green — no failure in its
  blocking sections; the seeded beginner programs are trainable on a fresh install with
  no network; export/import verified on real hardware; a real summary is visible in a
  mainstream Nostr client; catalog import and update detection verified against a real
  republish and edit-fork; support screen live with a real zap appearing in the funding
  panel against a published cost.
- **Phase 1 — proven** (field evidence gathered *after* the tag; gates nothing, informs
  what comes next): 30 days of real training logged by real users with zero operator
  infrastructure, including at least one who never signed in.
- **Phase 2a:** toggle auto-backup on → cross-device restore, hands-off; the write policy
  rejects everything that is not a Workstr encrypted record; LMDB backups restorable;
  curated library fetchable by anyone from public relays; storage quotas enforced. The real
  monthly cost and the 11.4 threshold follow in v2.2 (issue #59) rather than gating this
  phase: 2a is what produces the bill they describe.
- **Phase 2b:** not done — not started. Done means the trigger in 11.4 fired, was
  announced 30 days ahead, and existing pubkeys were grandfathered without action.
- **Phase 3:** each item ships independently; nothing in it blocks 1–2.
