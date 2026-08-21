#!/usr/bin/env node
// strfry write-policy plugin for the Workstr relay.
//
// The relay is open: any pubkey may back up, there is no allowlist and no NIP-42 AUTH.
// This plugin is therefore the only thing standing between the relay and every other
// client's notes. The relay URL ships inside public JavaScript and relay crawlers index
// it regardless of whether anyone advertises it, so "nobody knows the address" is not a
// control and was never treated as one.
//
// Policy: accept an event only when it is kind 30078 AND its `d` tag starts with
// `workstr:v2:`. Reject everything else.
//
// Filtering on the kind alone would not be enough. Kind 30078 is NIP-78 "arbitrary app
// data", a shared kind that unrelated clients also publish, so a kind-only filter would
// let their records accumulate on the disk.
//
// Protocol (strfry docs/plugins.md): one JSON request per line on stdin, one minified
// JSON response per line on stdout. `msg` is the NIP-20 message and is only used for
// rejections. strfry waits `relay.writePolicy.timeoutSeconds` for each response.

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACCEPTED_KIND = 30078;
export const REQUIRED_D_PREFIX = 'workstr:v2:';

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

const REJECT_KIND = `blocked: this relay only stores Workstr encrypted backup records (kind ${ACCEPTED_KIND})`;
const REJECT_ADDRESS = `blocked: kind ${ACCEPTED_KIND} events must carry a d tag starting with ${REQUIRED_D_PREFIX}`;
const REJECT_MALFORMED = 'blocked: malformed event';
const REJECT_BLOCKED = 'blocked: this pubkey may not write to this relay';
const REJECT_CEILING = 'blocked: this relay has reached its storage ceiling; the operator has been alerted';

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

// `limits` is the stateful half, supplied by the ledger. Omitted, this is the original
// stateless shape check, which is what the format tests exercise.
export function decide(event, limits = null) {
  if (!event || typeof event !== 'object') return { action: 'reject', msg: REJECT_MALFORMED };
  if (event.kind !== ACCEPTED_KIND) return { action: 'reject', msg: REJECT_KIND };

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
  const stateDir = options.stateDir ?? null;
  const warn = options.warn ?? ((message) => process.stderr.write(`[write-policy] ${message}\n`));
  const usagePath = stateDir ? join(stateDir, 'usage.json') : null;
  const blocklistPath = stateDir ? join(stateDir, 'blocklist.json') : null;

  const authors = new Map();
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
  const address = readDTag(event);
  const bytes = ledger ? eventBytes(event) : 0;
  const limits = ledger && typeof event.pubkey === 'string' && address !== null
    ? ledger.check(event.pubkey, address, bytes)
    : null;

  const { action, msg } = decide(event, limits);
  // Counted only once strfry is going to store it, so a rejected event never eats quota.
  if (action === 'accept' && ledger && limits) ledger.record(event.pubkey, address, bytes);
  return JSON.stringify(msg === undefined ? { id, action } : { id, action, msg });
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function main() {
  const ledger = createLedger({
    stateDir: process.env.WORKSTR_POLICY_STATE || null,
    quotaBytes: numberFromEnv('WORKSTR_QUOTA_BYTES', DEFAULT_QUOTA_BYTES),
    ceilingBytes: numberFromEnv('WORKSTR_CEILING_BYTES', DEFAULT_CEILING_BYTES),
    alertRatio: numberFromEnv('WORKSTR_ALERT_RATIO', DEFAULT_ALERT_RATIO)
  }).load();
  // Nothing here prints a path or a pubkey: this goes to the container log.
  process.stderr.write(`[write-policy] ready, tracking ${ledger.snapshot().authors.length} author(s)\n`);

  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', (line) => {
    const response = handleLine(line, ledger);
    if (response !== null) process.stdout.write(response + '\n');
  });
  // The debounced write may still be pending when strfry stops the plugin.
  input.on('close', () => ledger.flush());
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { ledger.flush(); process.exit(0); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
