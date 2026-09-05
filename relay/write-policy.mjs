#!/usr/bin/env node
// strfry write-policy plugin for the Workstr relay.
//
// The relay is open: any pubkey may back up, there is no allowlist and no NIP-42 AUTH.
// This plugin is therefore the only thing standing between the relay and every other
// client's notes. The relay URL ships inside public JavaScript and relay crawlers index
// it regardless of whether anyone advertises it, so "nobody knows the address" is not a
// control and was never treated as one.
//
// Two Workstr protocol families are accepted, each with its own validator, and nothing
// else:
//
//   sync    kind 30078, `d` starting `workstr:v2:` — persistent encrypted user records
//   pairing kind 20078, `d` starting `workstr:pair:` — ephemeral device-pairing responses
//
// They are kept apart deliberately. Sync records are addressable, persistent and charged
// against a per-author quota; pairing events are ephemeral, tiny, expire in minutes and
// are bounded by a rate window instead. Merging them into one predicate would let pairing
// inherit sync's storage budget and let sync inherit pairing's laxer shape.
//
// Filtering on the kind alone would not be enough. Kind 30078 is NIP-78 "arbitrary app
// data", a shared kind that unrelated clients also publish, so a kind-only filter would
// let their records accumulate on the disk.
//
// Only the pairing *response* exists on the wire. The pairing request travels in the QR
// code the new device displays, so there is no unauthenticated write path here: every
// pairing event is signed by the account key, and the block list applies to it unchanged.
//
// Protocol (strfry docs/plugins.md): one JSON request per line on stdin, one minified
// JSON response per line on stdout. `msg` is the NIP-20 message and is only used for
// rejections. strfry waits `relay.writePolicy.timeoutSeconds` for each response.

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SYNC_KIND = 30078;
export const SYNC_D_PREFIX = 'workstr:v2:';

// The original names, kept because the deployed relay, the admin tool and the existing
// tests all import them.
export const ACCEPTED_KIND = SYNC_KIND;
export const REQUIRED_D_PREFIX = SYNC_D_PREFIX;

// `workstr:v1:` was accepted alongside it while the app was being deployed, so that the
// relay and the client did not have to change in the same instant. That window is closed:
// nothing writes v1 any more, and a relay that keeps accepting a retired prefix is just a
// wider target. Kept as a list so the next changeover reopens the same door.
export const ACCEPTED_D_PREFIXES = [REQUIRED_D_PREFIX];

// With neither payment nor admission bounding anything, these limits plus the kind and
// prefix filter are the entire defence. Organic use is not the worry: 30078 is
// addressable, so an honest user's footprint is capped by their distinct `d` tags.
export const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;
export const DEFAULT_CEILING_BYTES = 20 * 1024 * 1024 * 1024;
export const DEFAULT_ALERT_RATIO = 0.8;

// Pairing. An ephemeral kind (20000-29999) rather than another addressable one: strfry
// stores these, serves them to a later REQ within `ephemeralEventsLifetimeSeconds`, then
// reaps them itself. That is what lets a backgrounded PWA reconnect and still collect its
// response, and it means retention needs no code here. 20078 is unassigned in the NIP
// registry; 22242, 23194/23195, 24133, 24242, 27235 and 28934-28936 are taken.
export const PAIR_KIND = 20078;
export const PAIR_D_PREFIX = 'workstr:pair:';
export const PAIR_PROTOCOL_VERSION = 1;

// 128 bits, lowercase hex. Long enough that pairing ids cannot be guessed or enumerated,
// fixed-width so a malformed one is rejected on shape rather than on entropy guesswork.
export const PAIR_ID_PATTERN = /^[0-9a-f]{32}$/;

// A NIP-44 v2 ciphertext of the pairing payload lands near 700 bytes after padding and
// base64. 2 KB leaves headroom without letting a pairing event approach the size of a
// backup record.
export const PAIR_MAX_BYTES = 2048;

// Matches the relay's `ephemeralEventsLifetimeSeconds`. The client enforces expiry too;
// this is defence in depth, not the only check.
export const PAIR_MAX_LIFETIME_SECONDS = 300;

// Pairing is not charged against the persistent quota — these events are deleted minutes
// later, so billing an author permanently for them would be wrong. A rolling count per
// window bounds the abuse instead. Held in memory only: rebuilding it on restart is both
// harmless and safer than trusting a file.
export const PAIR_WINDOW_SECONDS = 3600;
export const DEFAULT_PAIR_MAX_PER_AUTHOR = 30;
export const DEFAULT_PAIR_MAX_TOTAL = 600;

const REJECT_KIND = `blocked: this relay stores Workstr encrypted sync records (kind ${SYNC_KIND}) and Workstr device-pairing events (kind ${PAIR_KIND}) only`;
const REJECT_ADDRESS = `blocked: kind ${SYNC_KIND} events must carry a d tag starting with ${SYNC_D_PREFIX}`;
const REJECT_MALFORMED = 'blocked: malformed event';
const REJECT_BLOCKED = 'blocked: this pubkey may not write to this relay';
const REJECT_CEILING = 'blocked: this relay has reached its storage ceiling; the operator has been alerted';

// Pairing rejections say which rule failed without describing the payload: these strings
// reach the client, and an attacker probing the schema should learn nothing about what a
// valid event carries beyond what the published protocol already says.
const REJECT_PAIR_SCHEMA = 'blocked: malformed Workstr pairing event';
const REJECT_PAIR_VERSION = 'blocked: unsupported Workstr pairing protocol version';
const REJECT_PAIR_EXPIRY = `blocked: Workstr pairing events must expire within ${PAIR_MAX_LIFETIME_SECONDS} seconds and must not be expired already`;
const REJECT_PAIR_SIZE = `blocked: Workstr pairing events must be ${PAIR_MAX_BYTES} bytes or smaller`;
const REJECT_PAIR_RATE = 'blocked: too many Workstr pairing events; wait and try again';

// Scales rather than always printing megabytes: a limit shown as "0.0 MB" tells the
// reader nothing, and these strings go straight to the user as the NIP-20 reason.
export function humanBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// First `d` tag wins, matching how addressable events are resolved elsewhere.
function readDTag(event) {
  if (!Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === 'd') return typeof tag[1] === 'string' ? tag[1] : null;
  }
  return null;
}

// Reads every tag with the given name. Pairing validates on the whole tag set rather than
// on "the first one wins", so a second `expiration` has to be visible here.
function readTags(event, name) {
  if (!Array.isArray(event.tags)) return null;
  const found = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string') return null;
    if (tag[0] === name) found.push(typeof tag[1] === 'string' ? tag[1] : null);
  }
  return found;
}

// Exactly one tag of this name, carrying a string.
function readOnlyTag(event, name) {
  const found = readTags(event, name);
  return found && found.length === 1 ? found[0] : null;
}

export function looksLikeSyncEvent(event) {
  return Boolean(event) && typeof event === 'object' && event.kind === SYNC_KIND;
}

export function looksLikePairingEvent(event) {
  return Boolean(event) && typeof event === 'object' && event.kind === PAIR_KIND;
}

// The original policy, unchanged in behaviour. Sync acceptance must not shift because
// pairing was added, so nothing in here consults a pairing rule.
export function decideSync(event, limits = null) {
  const address = readDTag(event);
  if (address === null) return { action: 'reject', msg: REJECT_ADDRESS };
  // A bare prefix is not an address, so `workstr:v2:` on its own is rejected too.
  if (!ACCEPTED_D_PREFIXES.some((prefix) => address.startsWith(prefix) && address.length > prefix.length)) {
    return { action: 'reject', msg: REJECT_ADDRESS };
  }

  if (!limits) return { action: 'accept' };
  if (limits.blocked) return { action: 'reject', msg: REJECT_BLOCKED };
  // Checked against what the author's footprint *becomes*, so the event that would cross
  // the line is the one refused rather than the one after it.
  if (limits.authorBytes > limits.quotaBytes) {
    return { action: 'reject', msg: `blocked: storage quota reached (${humanBytes(limits.quotaBytes)}). Existing records are kept; delete some to make room.` };
  }
  if (limits.totalBytes > limits.ceilingBytes) return { action: 'reject', msg: REJECT_CEILING };

  return { action: 'accept' };
}

// A pairing event carries exactly three tags and nothing else. The strictness is the
// point: this kind exists for one message in one protocol, so anything that is not
// precisely that message is not a pairing event.
//
// Note what is deliberately absent — the recipient's ephemeral public key is never a tag.
// Reads are open, so an attacker can list every pairing event on the relay; seeing a
// ciphertext and a random pairing id tells them nothing, but the ephemeral pubkey would
// let them encrypt a forged response the new device would accept. It stays in the QR.
export function decidePairing(event, limits = null, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(event.tags) || event.tags.length !== 3) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || typeof tag[0] !== 'string' || typeof tag[1] !== 'string') {
      return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
    }
    if (!['d', 'expiration', 'v'].includes(tag[0])) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
  }

  const address = readOnlyTag(event, 'd');
  if (address === null || !address.startsWith(PAIR_D_PREFIX)) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
  if (!PAIR_ID_PATTERN.test(address.slice(PAIR_D_PREFIX.length))) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };

  if (typeof event.content !== 'string' || event.content.length === 0) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };

  // Version before expiry: a client speaking a protocol this relay does not know should
  // hear that, not a complaint about a field whose meaning may have changed.
  const version = readOnlyTag(event, 'v');
  if (version === null) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
  if (version !== String(PAIR_PROTOCOL_VERSION)) return { action: 'reject', msg: REJECT_PAIR_VERSION };

  const expiration = readOnlyTag(event, 'expiration');
  if (expiration === null || !/^\d+$/.test(expiration)) return { action: 'reject', msg: REJECT_PAIR_SCHEMA };
  const expiresAt = Number(expiration);
  // Expiry at exactly now is already useless, so it is refused with the past.
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return { action: 'reject', msg: REJECT_PAIR_EXPIRY };
  if (expiresAt > nowSeconds + PAIR_MAX_LIFETIME_SECONDS) return { action: 'reject', msg: REJECT_PAIR_EXPIRY };

  if (eventBytes(event) > PAIR_MAX_BYTES) return { action: 'reject', msg: REJECT_PAIR_SIZE };

  if (!limits) return { action: 'accept' };
  // Blocking a pubkey blocks its pairing too. Pairing responses are account-signed, so
  // this needs no special case — which is one reason the request never reaches the relay.
  if (limits.blocked) return { action: 'reject', msg: REJECT_BLOCKED };
  if (limits.authorEvents >= limits.maxPerAuthor || limits.totalEvents >= limits.maxTotal) {
    return { action: 'reject', msg: REJECT_PAIR_RATE };
  }
  // Pairing does not add to the persistent total, but a relay already over its ceiling
  // should not be taking new writes of any kind.
  if (limits.totalBytes > limits.ceilingBytes) return { action: 'reject', msg: REJECT_CEILING };

  return { action: 'accept' };
}

// `limits` is the stateful half, supplied by the ledger. Omitted, this is the stateless
// shape check, which is what the format tests exercise.
export function decide(event, limits = null, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!event || typeof event !== 'object') return { action: 'reject', msg: REJECT_MALFORMED };
  if (looksLikeSyncEvent(event)) return decideSync(event, limits);
  if (looksLikePairingEvent(event)) return decidePairing(event, limits, nowSeconds);
  return { action: 'reject', msg: REJECT_KIND };
}

export function eventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

// Per-author accounting, because a stateless check cannot answer "how much does this
// pubkey already store". Usage is tracked per address rather than accumulated per event:
// kind 30078 is addressable, so republishing an address replaces the stored event, and
// adding every publish would charge a user who syncs daily for storage they never used.
//
// Two files, two owners, so neither can clobber the other: the plugin writes usage.json,
// the admin tool writes blocklist.json, and the plugin re-reads the block list whenever
// it changes on disk so a block takes effect without a relay restart.
export function createLedger(options = {}) {
  const quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
  const ceilingBytes = options.ceilingBytes ?? DEFAULT_CEILING_BYTES;
  const alertRatio = options.alertRatio ?? DEFAULT_ALERT_RATIO;
  const pairMaxPerAuthor = options.pairMaxPerAuthor ?? DEFAULT_PAIR_MAX_PER_AUTHOR;
  const pairMaxTotal = options.pairMaxTotal ?? DEFAULT_PAIR_MAX_TOTAL;
  const stateDir = options.stateDir ?? null;
  const warn = options.warn ?? ((message) => process.stderr.write(`[write-policy] ${message}\n`));
  const usagePath = stateDir ? join(stateDir, 'usage.json') : null;
  const blocklistPath = stateDir ? join(stateDir, 'blocklist.json') : null;

  const authors = new Map();
  // One entry per accepted pairing event, dropped once it leaves the window. Never
  // persisted: the events themselves are gone within minutes, so carrying counts across a
  // restart would only ever refuse writes that are no longer stored anywhere.
  let pairings = [];
  let blocked = new Map();
  let blocklistStamp = null;
  let total = 0;
  let alerted = false;
  let persistWarned = false;
  let persistTimer = null;

  const readJson = (path) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      // A missing file is the normal first run. Anything else is worth saying out loud.
      if (error && error.code !== 'ENOENT') warn(`could not read state file: ${error.code || 'parse error'}`);
      return null;
    }
  };

  function refreshBlocklist() {
    if (!blocklistPath) return;
    let stamp = null;
    try {
      const stats = statSync(blocklistPath);
      stamp = `${stats.mtimeMs}:${stats.size}`;
    } catch {
      // Removed or never created: nobody is blocked.
      if (blocklistStamp !== null) { blocked = new Map(); blocklistStamp = null; }
      return;
    }
    if (stamp === blocklistStamp) return;
    const data = readJson(blocklistPath);
    blocked = new Map(Object.entries(data?.blocked ?? {}));
    blocklistStamp = stamp;
  }

  function persist() {
    if (!usagePath) return;
    const payload = { version: 1, updatedAt: new Date().toISOString(), authors: {} };
    for (const [pubkey, addresses] of authors) payload.authors[pubkey] = Object.fromEntries(addresses);
    try {
      // Written beside the target and renamed, so a crash mid-write cannot leave a
      // half-parsed ledger that reads as "this pubkey stores nothing".
      const temporary = `${usagePath}.tmp`;
      writeFileSync(temporary, JSON.stringify(payload));
      renameSync(temporary, usagePath);
    } catch (error) {
      // Enforcement continues from memory. Failing open on quota would be bad; refusing
      // every write because a disk is read-only would be worse for a backup relay.
      if (!persistWarned) { warn(`state is not persistable (${error.code || 'write error'}); quotas hold in memory only`); persistWarned = true; }
    }
  }

  function schedulePersist() {
    if (!usagePath || persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 5000);
    // Never a reason to keep the process alive.
    if (typeof persistTimer.unref === 'function') persistTimer.unref();
  }

  return {
    load() {
      if (stateDir) {
        try { mkdirSync(stateDir, { recursive: true }); } catch { /* checked again on write */ }
      }
      const data = usagePath ? readJson(usagePath) : null;
      for (const [pubkey, addresses] of Object.entries(data?.authors ?? {})) {
        const entries = new Map(Object.entries(addresses).filter(([, bytes]) => Number.isFinite(bytes)));
        authors.set(pubkey, entries);
        for (const bytes of entries.values()) total += bytes;
      }
      refreshBlocklist();
      return this;
    },

    // What the author's footprint and the relay total *would become* if this event were
    // stored, with the address it replaces discounted.
    check(pubkey, address, bytes) {
      refreshBlocklist();
      const addresses = authors.get(pubkey);
      const replaced = addresses?.get(address) ?? 0;
      return {
        blocked: blocked.has(pubkey),
        authorBytes: (sumOf(addresses) - replaced) + bytes,
        totalBytes: (total - replaced) + bytes,
        quotaBytes,
        ceilingBytes
      };
    },

    // Pairing's counterpart to `check`. It answers "how many pairing events has this
    // pubkey published lately", which is the only resource question pairing raises: the
    // events expire on their own, so bytes stored is not the thing to bound.
    checkPairing(pubkey, nowSeconds = Math.floor(Date.now() / 1000)) {
      refreshBlocklist();
      const cutoff = nowSeconds - PAIR_WINDOW_SECONDS;
      pairings = pairings.filter((entry) => entry.at > cutoff);
      return {
        blocked: blocked.has(pubkey),
        authorEvents: pairings.reduce((count, entry) => count + (entry.pubkey === pubkey ? 1 : 0), 0),
        totalEvents: pairings.length,
        maxPerAuthor: pairMaxPerAuthor,
        maxTotal: pairMaxTotal,
        totalBytes: total,
        ceilingBytes
      };
    },

    recordPairing(pubkey, nowSeconds = Math.floor(Date.now() / 1000)) {
      pairings.push({ pubkey, at: nowSeconds });
    },

    record(pubkey, address, bytes) {
      let addresses = authors.get(pubkey);
      if (!addresses) { addresses = new Map(); authors.set(pubkey, addresses); }
      total += bytes - (addresses.get(address) ?? 0);
      addresses.set(address, bytes);
      schedulePersist();
      // Fires against a threshold rather than on a full disk, and once per crossing
      // rather than once per event, so the signal is not buried in its own noise.
      if (!alerted && total >= ceilingBytes * alertRatio) {
        alerted = true;
        warn(`ALERT: storage is at ${humanBytes(total)} of a ${humanBytes(ceilingBytes)} ceiling`);
      }
      if (alerted && total < ceilingBytes * alertRatio * 0.9) alerted = false;
    },

    snapshot() {
      refreshBlocklist();
      const perAuthor = [...authors].map(([pubkey, addresses]) => ({ pubkey, bytes: sumOf(addresses), records: addresses.size }));
      return { totalBytes: total, quotaBytes, ceilingBytes, alertRatio, authors: perAuthor, blocked: [...blocked.keys()] };
    },

    flush: persist
  };
}

function sumOf(addresses) {
  let sum = 0;
  if (addresses) for (const bytes of addresses.values()) sum += bytes;
  return sum;
}

// Returns the response line for a request line, or null when the request needs no
// response. Anything unparseable is dropped rather than answered: without a trustworthy
// event id there is no response strfry could match to a request.
export function handleLine(line, ledger = null) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // The docs list `new` as the only current type. Unknown types are left alone rather
  // than guessed at, so a future strfry that adds an informational message does not get
  // a spurious decision back.
  if (!request || request.type !== 'new') return null;

  const id = request.event?.id;
  if (typeof id !== 'string') return null;

  const event = request.event;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const hasAuthor = ledger && typeof event.pubkey === 'string';

  // The two families are metered by different questions, so they ask the ledger different
  // ones. Pairing carries no address to charge and must not reach the quota path at all.
  if (looksLikePairingEvent(event)) {
    const limits = hasAuthor ? ledger.checkPairing(event.pubkey, nowSeconds) : null;
    const { action, msg } = decide(event, limits, nowSeconds);
    if (action === 'accept' && limits) ledger.recordPairing(event.pubkey, nowSeconds);
    return JSON.stringify(msg === undefined ? { id, action } : { id, action, msg });
  }

  const address = readDTag(event);
  const bytes = ledger ? eventBytes(event) : 0;
  const limits = hasAuthor && address !== null ? ledger.check(event.pubkey, address, bytes) : null;

  const { action, msg } = decide(event, limits, nowSeconds);
  // Counted only once strfry is going to store it, so a rejected event never eats quota.
  if (action === 'accept' && ledger && limits) ledger.record(event.pubkey, address, bytes);
  return JSON.stringify(msg === undefined ? { id, action } : { id, action, msg });
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function runPolicy(inputStream, outputStream, ledger) {
  const input = createInterface({ input: inputStream, terminal: false });
  input.on('line', (line) => {
    const response = handleLine(line, ledger);
    if (response !== null) outputStream.write(response + '\n');
  });
  // The debounced write may still be pending when strfry stops the plugin.
  input.on('close', () => ledger.flush());
  return input;
}

function main() {
  const ledger = createLedger({
    stateDir: process.env.WORKSTR_POLICY_STATE || null,
    quotaBytes: numberFromEnv('WORKSTR_QUOTA_BYTES', DEFAULT_QUOTA_BYTES),
    ceilingBytes: numberFromEnv('WORKSTR_CEILING_BYTES', DEFAULT_CEILING_BYTES),
    alertRatio: numberFromEnv('WORKSTR_ALERT_RATIO', DEFAULT_ALERT_RATIO),
    pairMaxPerAuthor: numberFromEnv('WORKSTR_PAIR_MAX_PER_AUTHOR', DEFAULT_PAIR_MAX_PER_AUTHOR),
    pairMaxTotal: numberFromEnv('WORKSTR_PAIR_MAX_TOTAL', DEFAULT_PAIR_MAX_TOTAL)
  }).load();
  // Nothing here prints a path or a pubkey: this goes to the container log.
  process.stderr.write(`[write-policy] ready, tracking ${ledger.snapshot().authors.length} author(s)\n`);

  runPolicy(process.stdin, process.stdout, ledger);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { ledger.flush(); process.exit(0); });
}

// Compare normalized filesystem paths rather than URL strings. Node may preserve a
// relative or otherwise differently encoded argv path when the plugin is launched as a
// child process, even though both values name the same executable file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
