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
// `workstr:v1:`. Reject everything else.
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

export const ACCEPTED_KIND = 30078;
export const REQUIRED_D_PREFIX = 'workstr:v1:';

const REJECT_KIND = `blocked: this relay only stores Workstr encrypted backup records (kind ${ACCEPTED_KIND})`;
const REJECT_ADDRESS = `blocked: kind ${ACCEPTED_KIND} events must carry a d tag starting with ${REQUIRED_D_PREFIX}`;
const REJECT_MALFORMED = 'blocked: malformed event';

// First `d` tag wins, matching how addressable events are resolved elsewhere.
function readDTag(event) {
  if (!Array.isArray(event.tags)) return null;
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === 'd') return typeof tag[1] === 'string' ? tag[1] : null;
  }
  return null;
}

export function decide(event) {
  if (!event || typeof event !== 'object') return { action: 'reject', msg: REJECT_MALFORMED };
  if (event.kind !== ACCEPTED_KIND) return { action: 'reject', msg: REJECT_KIND };

  const address = readDTag(event);
  if (address === null) return { action: 'reject', msg: REJECT_ADDRESS };
  // A bare prefix is not an address, so `workstr:v1:` on its own is rejected too.
  if (!address.startsWith(REQUIRED_D_PREFIX) || address.length === REQUIRED_D_PREFIX.length) {
    return { action: 'reject', msg: REJECT_ADDRESS };
  }

  return { action: 'accept' };
}

// Returns the response line for a request line, or null when the request needs no
// response. Anything unparseable is dropped rather than answered: without a trustworthy
// event id there is no response strfry could match to a request.
export function handleLine(line) {
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

  const { action, msg } = decide(request.event);
  return JSON.stringify(msg === undefined ? { id, action } : { id, action, msg });
}

function main() {
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', (line) => {
    const response = handleLine(line);
    if (response !== null) process.stdout.write(response + '\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
