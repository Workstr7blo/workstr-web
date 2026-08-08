// Regenerates src/data/seed-events.json from the live Workstr catalog.
//
//   node scripts/generate-seed.mjs
//
// The seed ships the operator's own signed events, not a hand-written copy of
// them. Parsing them through the same codecs the catalog uses means a seeded
// row is byte-identical to the same row imported from Discover — so Discover
// reports "In library" instead of offering a duplicate, and a republished
// catalog entry still surfaces as an update.
//
// Programs are pinned by d tag on purpose: the starter set is a curated
// choice, not "whatever is tagged beginner today".

import { writeFileSync } from 'node:fs';
import { SimplePool, verifyEvent } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const OPERATOR_PUBKEY = 'ef24246321e47dd16cec960d4d374703af78505d0e59c532b054b5060e372bd6';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
const OUT = new URL('../src/data/seed-events.json', import.meta.url);

const SEED_PROGRAM_D_TAGS = [
  'workstr:program:program-3',    // Foundation Full Body
  'workstr:program:full-body-2',  // Core Stability Starter
  'workstr:program:lower-body'    // Legs & Glutes
];

const tagValue = (tags, key) => (tags.find((tag) => tag[0] === key) || [])[1] || '';

// Newest event per address, operator-signed and signature-checked — the same
// selection rule as nostr/canon.ts.
function selectNewest(events) {
  const byAddress = new Map();
  for (const event of events) {
    if (event.pubkey !== OPERATOR_PUBKEY) continue;
    if (!verifyEvent(event)) continue;
    const dTag = tagValue(event.tags, 'd');
    if (!dTag) continue;
    const key = `${event.kind}:${event.pubkey}:${dTag}`;
    const previous = byAddress.get(key);
    if (!previous || event.created_at > previous.created_at) byAddress.set(key, event);
  }
  return byAddress;
}

const pool = new SimplePool();

try {
  const [rawPrograms, rawExercises] = await Promise.all([
    pool.querySync(RELAYS, { kinds: [33402], authors: [OPERATOR_PUBKEY], limit: 200 }),
    pool.querySync(RELAYS, { kinds: [33401], authors: [OPERATOR_PUBKEY], limit: 500 })
  ]);

  const programsByAddress = selectNewest(rawPrograms);
  const exercisesByAddress = selectNewest(rawExercises);

  const programs = [];
  for (const dTag of SEED_PROGRAM_D_TAGS) {
    const event = programsByAddress.get(`33402:${OPERATOR_PUBKEY}:${dTag}`);
    if (!event) throw new Error(`seed program not found in catalog: ${dTag}`);
    programs.push(event);
  }

  // Every exercise the seed programs reference, and nothing else.
  const wanted = new Set();
  for (const event of programs) {
    const meta = JSON.parse(tagValue(event.tags, 'workstr_meta') || '{}');
    for (const member of meta.exercises || []) {
      if (member.address) wanted.add(member.address);
    }
    for (const row of event.tags.filter((tag) => tag[0] === 'exercise')) {
      if (row[1]) wanted.add(row[1]);
    }
  }

  const exercises = [];
  const missing = [];
  for (const address of [...wanted].sort()) {
    const event = exercisesByAddress.get(address);
    if (event) exercises.push(event);
    else missing.push(address);
  }
  if (missing.length) throw new Error(`seed programs reference exercises missing from the catalog:\n  ${missing.join('\n  ')}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    operator: OPERATOR_PUBKEY,
    programs,
    exercises
  };
  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);

  console.log(`wrote ${programs.length} programs and ${exercises.length} exercises`);
  for (const event of programs) console.log(`  program  ${tagValue(event.tags, 'title')}`);
  for (const event of exercises) console.log(`  exercise ${tagValue(event.tags, 'title')}`);
} finally {
  pool.close(RELAYS);
}

process.exit(0);
