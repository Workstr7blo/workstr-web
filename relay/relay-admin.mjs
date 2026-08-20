#!/usr/bin/env node
// Operator tooling for the Workstr relay: block a pubkey, inspect what is stored, and
// rebuild the usage ledger from the relay's own contents.
//
// It touches only the two state files. It never talks to strfry or docker, so it runs the
// same way wherever the state directory is mounted, and `rebuild` takes events on stdin
// rather than reaching for a binary that may not be on PATH.
//
//   WORKSTR_POLICY_STATE   state directory (required)
//
//   relay-admin status                     totals, ceiling, alert threshold, block count
//   relay-admin list [n]                   the n largest authors (default 20)
//   relay-admin usage <pubkey>             one author's footprint
//   relay-admin block <pubkey> [reason]    refuse this pubkey's writes
//   relay-admin unblock <pubkey>           allow them again
//   relay-admin rebuild                    recompute usage from `strfry export` on stdin

import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { DEFAULT_ALERT_RATIO, DEFAULT_CEILING_BYTES, DEFAULT_QUOTA_BYTES, eventBytes, humanBytes } from './write-policy.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

export function readState(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

export function writeState(path, data) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2));
  renameSync(temporary, path);
}

export function authorTotals(usage) {
  return Object.entries(usage.authors ?? {})
    .map(([pubkey, addresses]) => ({
      pubkey,
      bytes: Object.values(addresses).reduce((sum, bytes) => sum + bytes, 0),
      records: Object.keys(addresses).length
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

// Rebuilds the ledger from what the relay actually holds. The authority is the relay, not
// the file: drift after a restore, a manual delete, or a lost state file is fixed here
// rather than by trusting an accumulated number forever.
export function ledgerFromEvents(lines) {
  const authors = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    const address = (event.tags ?? []).find((tag) => tag[0] === 'd')?.[1];
    if (typeof event.pubkey !== 'string' || typeof address !== 'string') continue;
    authors[event.pubkey] ??= {};
    // Newest wins per address, mirroring how the relay stores an addressable event.
    authors[event.pubkey][address] = eventBytes(event);
  }
  return { version: 1, updatedAt: new Date().toISOString(), authors };
}

function requireHexPubkey(value) {
  if (!HEX64.test(value ?? '')) {
    process.stderr.write('expected a 64-character hex pubkey (not an npub)\n');
    process.exit(2);
  }
  return value;
}

async function readStdin() {
  const lines = [];
  const input = createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) lines.push(line);
  return lines;
}

async function main(argv) {
  const stateDir = process.env.WORKSTR_POLICY_STATE;
  if (!stateDir) {
    process.stderr.write('set WORKSTR_POLICY_STATE to the policy state directory\n');
    process.exit(2);
  }
  mkdirSync(stateDir, { recursive: true });
  const usagePath = join(stateDir, 'usage.json');
  const blocklistPath = join(stateDir, 'blocklist.json');
  const [command, ...rest] = argv;

  const quotaBytes = Number(process.env.WORKSTR_QUOTA_BYTES) || DEFAULT_QUOTA_BYTES;
  const ceilingBytes = Number(process.env.WORKSTR_CEILING_BYTES) || DEFAULT_CEILING_BYTES;
  const alertRatio = Number(process.env.WORKSTR_ALERT_RATIO) || DEFAULT_ALERT_RATIO;

  const usage = readState(usagePath, { version: 1, authors: {} });
  const blocklist = readState(blocklistPath, { version: 1, blocked: {} });
  const totals = authorTotals(usage);
  const totalBytes = totals.reduce((sum, author) => sum + author.bytes, 0);

  if (command === 'status') {
    const overQuota = totals.filter((author) => author.bytes > quotaBytes).length;
    process.stdout.write([
      `stored        ${humanBytes(totalBytes)} of ${humanBytes(ceilingBytes)} (${((totalBytes / ceilingBytes) * 100).toFixed(2)}%)`,
      `alert at      ${humanBytes(ceilingBytes * alertRatio)} (${(alertRatio * 100).toFixed(0)}%)`,
      `quota         ${humanBytes(quotaBytes)} per pubkey`,
      `authors       ${totals.length}${overQuota ? ` (${overQuota} over quota)` : ''}`,
      `records       ${totals.reduce((sum, author) => sum + author.records, 0)}`,
      `blocked       ${Object.keys(blocklist.blocked).length}`,
      `updated       ${usage.updatedAt ?? 'never'}`
    ].join('\n') + '\n');
    return;
  }

  if (command === 'list') {
    const limit = Number(rest[0]) || 20;
    if (!totals.length) { process.stdout.write('no authors recorded\n'); return; }
    for (const author of totals.slice(0, limit)) {
      const flag = blocklist.blocked[author.pubkey] ? ' BLOCKED' : author.bytes > quotaBytes ? ' OVER' : '';
      process.stdout.write(`${author.pubkey}  ${humanBytes(author.bytes).padStart(9)}  ${String(author.records).padStart(5)} records${flag}\n`);
    }
    return;
  }

  if (command === 'usage') {
    const pubkey = requireHexPubkey(rest[0]);
    const author = totals.find((candidate) => candidate.pubkey === pubkey);
    if (!author) { process.stdout.write('no records stored for this pubkey\n'); return; }
    process.stdout.write([
      `stored   ${humanBytes(author.bytes)} of ${humanBytes(quotaBytes)} (${((author.bytes / quotaBytes) * 100).toFixed(1)}%)`,
      `records  ${author.records}`,
      `blocked  ${blocklist.blocked[pubkey] ? `yes — ${blocklist.blocked[pubkey].reason || 'no reason recorded'}` : 'no'}`
    ].join('\n') + '\n');
    return;
  }

  if (command === 'block') {
    const pubkey = requireHexPubkey(rest[0]);
    blocklist.blocked[pubkey] = { at: new Date().toISOString(), reason: rest.slice(1).join(' ') || '' };
    writeState(blocklistPath, blocklist);
    // The plugin re-reads the file when it changes, so this takes effect without a restart.
    process.stdout.write(`blocked ${pubkey}\n`);
    return;
  }

  if (command === 'unblock') {
    const pubkey = requireHexPubkey(rest[0]);
    if (!blocklist.blocked[pubkey]) { process.stdout.write('that pubkey was not blocked\n'); return; }
    delete blocklist.blocked[pubkey];
    writeState(blocklistPath, blocklist);
    process.stdout.write(`unblocked ${pubkey}\n`);
    return;
  }

  if (command === 'rebuild') {
    const rebuilt = ledgerFromEvents(await readStdin());
    writeState(usagePath, rebuilt);
    const after = authorTotals(rebuilt);
    process.stdout.write(`rebuilt: ${after.length} author(s), ${humanBytes(after.reduce((sum, a) => sum + a.bytes, 0))}\n`);
    process.stdout.write('restart the relay so the plugin reloads the ledger\n');
    return;
  }

  process.stderr.write('commands: status | list [n] | usage <pubkey> | block <pubkey> [reason] | unblock <pubkey> | rebuild\n');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
