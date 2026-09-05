import { describe, expect, it } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import {
  ACCEPTED_KIND, PAIR_D_PREFIX, PAIR_KIND, PAIR_MAX_BYTES, PAIR_MAX_LIFETIME_SECONDS, PAIR_WINDOW_SECONDS,
  REQUIRED_D_PREFIX, SYNC_KIND, createLedger, decide, eventBytes, handleLine, runPolicy
} from '../relay/write-policy.mjs';
import { ledgerFromEvents } from '../relay/relay-admin.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: ACCEPTED_KIND,
    tags: [['d', `${REQUIRED_D_PREFIX}session:1d1d`], ['client', 'workstr']],
    content: 'ciphertext',
    sig: 'c'.repeat(128),
    ...overrides
  };
}

function request(ev: unknown) {
  return JSON.stringify({ type: 'new', event: ev, receivedAt: 1_700_000_000, sourceType: 'IP4', sourceInfo: '203.0.113.7' });
}

describe('write policy decisions', () => {
  it('accepts a Workstr encrypted record from any pubkey', () => {
    expect(decide(event())).toEqual({ action: 'accept' });
    expect(decide(event({ pubkey: 'f'.repeat(64) }))).toEqual({ action: 'accept' });
  });

  it('accepts every address in the private record vocabulary', () => {
    for (const address of ['sheet:push-a', 'session:0f0f', 'bodyweight', 'settings', 'manifest']) {
      expect(decide(event({ tags: [['d', REQUIRED_D_PREFIX + address]] })).action).toBe('accept');
    }
  });

  it('rejects a kind:1 note', () => {
    const result = decide(event({ kind: 1, tags: [] }));
    expect(result.action).toBe('reject');
    expect(result.msg).toContain('blocked:');
  });

  it('rejects other kinds the client itself publishes elsewhere', () => {
    for (const kind of [0, 1, 3, 9735, 10002, 33401, 33402]) {
      expect(decide(event({ kind })).action).toBe('reject');
    }
  });

  it('rejects kind:30078 from another app', () => {
    // Kind 30078 is NIP-78 arbitrary app data; other clients publish it too.
    expect(decide(event({ tags: [['d', 'coracle:settings']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'notworkstr:v2:session:1']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'workstr:v1:session:1']] })).action).toBe('reject');
  });

  // The cutover window is closed: v1 was accepted only while the app was being deployed.
  it('accepts a v2 address and no longer accepts the retired prefix', () => {
    expect(decide(event({ tags: [['d', 'workstr:v2:log:7f3a:0001']] })).action).toBe('accept');
    expect(decide(event({ tags: [['d', 'workstr:v1:sessions:2026-08']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'workstr:v2:']] })).action).toBe('reject');
  });

  it('rejects a missing, empty, or non-string d tag', () => {
    expect(decide(event({ tags: [] })).action).toBe('reject');
    expect(decide(event({ tags: [['client', 'workstr']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 42]] })).action).toBe('reject');
    expect(decide(event({ tags: 'nope' })).action).toBe('reject');
  });

  it('rejects a bare prefix carrying no address', () => {
    expect(decide(event({ tags: [['d', REQUIRED_D_PREFIX]] })).action).toBe('reject');
  });

  it('resolves the first d tag, not a later one', () => {
    expect(decide(event({ tags: [['d', 'other:thing'], ['d', `${REQUIRED_D_PREFIX}settings`]] })).action).toBe('reject');
  });

  it('rejects a malformed event rather than failing open', () => {
    for (const bad of [null, undefined, 'string', 42]) {
      expect(decide(bad as never).action).toBe('reject');
    }
  });

  it('never returns a rejection without a readable message', () => {
    const rejections = [event({ kind: 1 }), event({ tags: [] }), null];
    for (const candidate of rejections) {
      const result = decide(candidate as never);
      expect(result.action).toBe('reject');
      expect(result.msg && result.msg.length).toBeGreaterThan(0);
    }
  });
});

describe('strfry line protocol', () => {
  it('answers a new-event request with the matching id', () => {
    const response = JSON.parse(handleLine(request(event())) as string);
    expect(response).toEqual({ id: 'a'.repeat(64), action: 'accept' });
  });

  it('carries the NIP-20 message on a rejection only', () => {
    const rejected = JSON.parse(handleLine(request(event({ kind: 1 }))) as string);
    expect(rejected.action).toBe('reject');
    expect(rejected.msg).toMatch(/^blocked: /);
    const accepted = JSON.parse(handleLine(request(event())) as string);
    expect(accepted).not.toHaveProperty('msg');
  });

  it('stays silent on input it cannot answer', () => {
    // Without a trustworthy event id there is no response strfry could match.
    expect(handleLine('')).toBeNull();
    expect(handleLine('   ')).toBeNull();
    expect(handleLine('{not json')).toBeNull();
    expect(handleLine(JSON.stringify({ type: 'lookback', event: event() }))).toBeNull();
    expect(handleLine(JSON.stringify({ type: 'new' }))).toBeNull();
    expect(handleLine(JSON.stringify({ type: 'new', event: { kind: 1 } }))).toBeNull();
  });

  it('emits one minified line per decision', () => {
    const line = handleLine(request(event())) as string;
    expect(line).not.toContain('\n');
    expect(line).toBe(JSON.stringify(JSON.parse(line)));
  });
});

describe('plugin process', () => {
  // Drives the exact stream loop used by the executable. Keeping this in-process makes
  // the protocol test reliable in sandboxes that suppress nested Node executables.
  async function run(lines: string[]): Promise<string> {
    const output = new PassThrough();
    let stdout = '';
    output.setEncoding('utf8');
    output.on('data', (chunk) => { stdout += chunk; });
    const input = runPolicy(Readable.from(lines.map((line) => line + '\n')), output, createLedger().load());
    await new Promise<void>((resolve) => input.once('close', resolve));
    return stdout;
  }

  it('streams a decision per request and survives junk between them', async () => {
    const stdout = await run([
      request(event()),
      '{not json',
      request(event({ id: 'd'.repeat(64), kind: 1 })),
      request(event({ id: 'e'.repeat(64), tags: [['d', 'coracle:settings']] }))
    ]);
    const responses = stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(responses).toHaveLength(3);
    expect(responses[0]).toEqual({ id: 'a'.repeat(64), action: 'accept' });
    expect(responses[1].id).toBe('d'.repeat(64));
    expect(responses[1].action).toBe('reject');
    expect(responses[2].action).toBe('reject');
  });
});

describe('per-pubkey quota', () => {
  const ledgerFor = (quotaBytes: number) => createLedger({ quotaBytes }).load();

  it('accepts an author under quota and rejects the one that would cross it', () => {
    const ledger = ledgerFor(1000);
    const under = ledger.check('a'.repeat(64), `${REQUIRED_D_PREFIX}session:1`, 400);
    expect(decide(event(), under)).toEqual({ action: 'accept' });

    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}session:1`, 400);
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}session:2`, 400);
    const over = ledger.check('a'.repeat(64), `${REQUIRED_D_PREFIX}session:3`, 400);
    const result = decide(event(), over);
    expect(result.action).toBe('reject');
    expect(result.msg).toContain('storage quota reached');
    // Readable, and it says what to do rather than only that something failed.
    expect(result.msg).toContain('delete some to make room');
    // Scaled, not always megabytes: a limit rendered "0.0 MB" tells the reader nothing.
    expect(result.msg).toContain('1000 B');
    expect(result.msg).not.toContain('0.0 MB');
  });

  it('charges an address once, not once per publish', () => {
    // The whole reason accounting is per address: 30078 is addressable, so re-uploading a
    // record replaces it. Charging every publish would bill a daily sync for storage that
    // never grew.
    const ledger = ledgerFor(1000);
    const address = `${REQUIRED_D_PREFIX}settings`;
    for (let i = 0; i < 50; i += 1) ledger.record('a'.repeat(64), address, 400);
    expect(ledger.snapshot().totalBytes).toBe(400);
    expect(decide(event(), ledger.check('a'.repeat(64), address, 400)).action).toBe('accept');
  });

  it('discounts the record being replaced when it grows', () => {
    const ledger = ledgerFor(1000);
    const address = `${REQUIRED_D_PREFIX}settings`;
    ledger.record('a'.repeat(64), address, 900);
    // 900 already stored, but this replaces it rather than adding to it.
    expect(ledger.check('a'.repeat(64), address, 950).authorBytes).toBe(950);
    expect(decide(event(), ledger.check('a'.repeat(64), address, 950)).action).toBe('accept');
  });

  it('keeps authors separate', () => {
    const ledger = ledgerFor(1000);
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 900);
    expect(decide(event(), ledger.check('b'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 900)).action).toBe('accept');
  });
});

describe('storage ceiling', () => {
  it('refuses writes once the relay total would pass the ceiling', () => {
    const ledger = createLedger({ quotaBytes: 10_000, ceilingBytes: 1000, warn: () => {} }).load();
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 600);
    ledger.record('b'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 300);
    const result = decide(event(), ledger.check('c'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 200));
    expect(result.action).toBe('reject');
    expect(result.msg).toContain('storage ceiling');
  });

  it('alerts against a threshold rather than on a full disk, once per crossing', () => {
    const warnings: string[] = [];
    const ledger = createLedger({ ceilingBytes: 1000, alertRatio: 0.8, warn: (m: string) => warnings.push(m) }).load();
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}a`, 700);
    expect(warnings).toHaveLength(0);
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}b`, 150);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ALERT');
    // Still above the threshold: one alert, not one per event after it.
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}c`, 10);
    expect(warnings).toHaveLength(1);
  });

  it('does not name a path or a pubkey in what it logs', () => {
    const warnings: string[] = [];
    const ledger = createLedger({ ceilingBytes: 100, alertRatio: 0.5, warn: (m: string) => warnings.push(m) }).load();
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}a`, 80);
    expect(warnings[0]).not.toContain('a'.repeat(64));
    expect(warnings[0]).not.toContain('/');
  });
});

describe('block list', () => {
  it('rejects a blocked pubkey and restores it when unblocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'policy-'));
    const blocklist = join(directory, 'blocklist.json');
    const pubkey = 'b'.repeat(64);

    const ledger = createLedger({ stateDir: directory }).load();
    expect(decide(event(), ledger.check(pubkey, `${REQUIRED_D_PREFIX}settings`, 10)).action).toBe('accept');

    await writeFile(blocklist, JSON.stringify({ version: 1, blocked: { [pubkey]: { at: 'now', reason: 'abuse' } } }));
    const blockedResult = decide(event(), ledger.check(pubkey, `${REQUIRED_D_PREFIX}settings`, 10));
    expect(blockedResult.action).toBe('reject');
    expect(blockedResult.msg).toContain('may not write');
    // Picked up from disk without a restart, which is what makes blocking usable.
    expect(decide(event(), ledger.check('c'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 10)).action).toBe('accept');

    await writeFile(blocklist, JSON.stringify({ version: 1, blocked: {} }));
    expect(decide(event(), ledger.check(pubkey, `${REQUIRED_D_PREFIX}settings`, 10)).action).toBe('accept');

    await rm(directory, { recursive: true, force: true });
  });
});

describe('ledger persistence', () => {
  it('survives a restart and keeps enforcing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'policy-'));
    const first = createLedger({ stateDir: directory, quotaBytes: 1000 }).load();
    first.record('a'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 900);
    first.flush();

    const second = createLedger({ stateDir: directory, quotaBytes: 1000 }).load();
    expect(second.snapshot().totalBytes).toBe(900);
    expect(decide(event(), second.check('a'.repeat(64), `${REQUIRED_D_PREFIX}other`, 200)).action).toBe('reject');

    await rm(directory, { recursive: true, force: true });
  });

  it('keeps enforcing from memory when the state directory cannot be written', () => {
    const warnings: string[] = [];
    const ledger = createLedger({ stateDir: '/dev/null/nope', quotaBytes: 1000, warn: (m: string) => warnings.push(m) }).load();
    ledger.record('a'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 900);
    ledger.flush();
    // Failing open on quota would be bad; refusing every write because a disk is
    // read-only would be worse for a backup relay.
    expect(decide(event(), ledger.check('a'.repeat(64), `${REQUIRED_D_PREFIX}other`, 200)).action).toBe('reject');
    expect(warnings.some((message) => message.includes('memory only'))).toBe(true);
  });
});

describe('accounting through the request loop', () => {
  it('does not charge quota for an event it rejected', () => {
    const ledger = createLedger({ quotaBytes: 1000 }).load();
    handleLine(request(event({ kind: 1, tags: [] })), ledger);
    handleLine(request(event({ tags: [['d', 'coracle:settings']] })), ledger);
    expect(ledger.snapshot().totalBytes).toBe(0);

    handleLine(request(event()), ledger);
    expect(ledger.snapshot().totalBytes).toBeGreaterThan(0);
  });
});

describe('rebuilding the ledger from the relay', () => {
  it('recomputes usage from exported events, newest per address', () => {
    const older = event({ id: 'a'.repeat(64), content: 'x'.repeat(100) });
    const newer = event({ id: 'b'.repeat(64), content: 'x'.repeat(500) });
    const rebuilt = ledgerFromEvents([JSON.stringify(older), JSON.stringify(newer), 'junk']);
    const addresses = rebuilt.authors['b'.repeat(64)];
    expect(Object.keys(addresses)).toHaveLength(1);
    // The later line wins, the same way the relay keeps one event per address.
    expect(Object.values(addresses)[0]).toBeGreaterThan(500);
  });
});

// A fixed clock everywhere below: expiry is the one rule here that depends on time, and a
// suite that reads the wall clock fails at whatever hour the boundary happens to land on.
const NOW = 1_800_000_000;

function pairEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: NOW,
    kind: PAIR_KIND,
    tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['expiration', String(NOW + 120)], ['v', '1']],
    content: 'ciphertext',
    sig: 'c'.repeat(128),
    ...overrides
  };
}

const pairTags = (over: Record<string, string> = {}) => [
  ['d', over.d ?? `${PAIR_D_PREFIX}${'0f'.repeat(16)}`],
  ['expiration', over.expiration ?? String(NOW + 120)],
  ['v', over.v ?? '1']
];

describe('pairing acceptance', () => {
  it('accepts a well-formed pairing response', () => {
    expect(decide(pairEvent(), null, NOW)).toEqual({ action: 'accept' });
  });

  it('accepts any high-entropy pairing id and ignores tag order', () => {
    expect(decide(pairEvent({ tags: [['v', '1'], ['expiration', String(NOW + 5)], ['d', `${PAIR_D_PREFIX}${'ab'.repeat(16)}`]] }), null, NOW).action).toBe('accept');
  });

  it('routes a pairing event to the pairing validator, not the sync one', () => {
    // The give-away: a sync rejection would name the workstr:v2: prefix.
    const result = decide(pairEvent({ tags: pairTags({ d: 'workstr:pair:nope' }) }), null, NOW);
    expect(result.action).toBe('reject');
    expect(result.msg).not.toContain(REQUIRED_D_PREFIX);
    expect(result.msg).toContain('pairing');
  });
});

describe('pairing rejection', () => {
  const rejects = (name: string, overrides: Record<string, unknown>) => {
    it(name, () => {
      const result = decide(pairEvent(overrides), null, NOW);
      expect(result.action).toBe('reject');
      expect(result.msg).toMatch(/^blocked: /);
    });
  };

  rejects('wrong namespace', { tags: pairTags({ d: 'workstr:v2:settings' }) });
  rejects('bare pairing prefix with no id', { tags: pairTags({ d: PAIR_D_PREFIX }) });
  rejects('pairing id too short', { tags: pairTags({ d: `${PAIR_D_PREFIX}0f0f` }) });
  rejects('pairing id too long', { tags: pairTags({ d: `${PAIR_D_PREFIX}${'0f'.repeat(20)}` }) });
  rejects('pairing id that is not hex', { tags: pairTags({ d: `${PAIR_D_PREFIX}${'zz'.repeat(16)}` }) });
  rejects('pairing id in uppercase hex', { tags: pairTags({ d: `${PAIR_D_PREFIX}${'0F'.repeat(16)}` }) });
  rejects('missing d tag', { tags: [['expiration', String(NOW + 120)], ['v', '1']] });
  rejects('missing expiration', { tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['v', '1']] });
  rejects('missing version', { tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['expiration', String(NOW + 120)]] });
  rejects('unsupported version', { tags: pairTags({ v: '2' }) });
  rejects('non-numeric version', { tags: pairTags({ v: 'one' }) });
  rejects('non-numeric expiration', { tags: pairTags({ expiration: 'soon' }) });
  rejects('negative expiration', { tags: pairTags({ expiration: '-1' }) });
  rejects('empty content', { content: '' });
  rejects('non-string content', { content: 42 });
  rejects('a fourth tag', { tags: [...pairTags(), ['client', 'workstr']] });
  rejects('a duplicated tag', { tags: [...pairTags(), ['v', '1']] });
  rejects('only two tags', { tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['v', '1']] });
  rejects('tags that are not arrays', { tags: ['d', 'expiration', 'v'] });
  rejects('a tag with no value', { tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['expiration'], ['v', '1']] });

  it('rejects a p tag carrying the ephemeral pubkey', () => {
    // Security-critical, not tidiness: the ephemeral pubkey is the one value that would
    // let an observer forge a response the new device accepts. It belongs in the QR only.
    const result = decide(pairEvent({ tags: [['d', `${PAIR_D_PREFIX}${'0f'.repeat(16)}`], ['expiration', String(NOW + 120)], ['p', 'e'.repeat(64)]] }), null, NOW);
    expect(result.action).toBe('reject');
  });
});

describe('pairing expiry boundaries', () => {
  const at = (expiration: number) => decide(pairEvent({ tags: pairTags({ expiration: String(expiration) }) }), null, NOW).action;

  it('refuses an expiry in the past or exactly now', () => {
    expect(at(NOW - 1)).toBe('reject');
    expect(at(NOW)).toBe('reject');
  });

  it('accepts one second ahead and the maximum lifetime exactly', () => {
    expect(at(NOW + 1)).toBe('accept');
    expect(at(NOW + PAIR_MAX_LIFETIME_SECONDS)).toBe('accept');
  });

  it('refuses one second beyond the maximum lifetime', () => {
    expect(at(NOW + PAIR_MAX_LIFETIME_SECONDS + 1)).toBe('reject');
    expect(at(NOW + 86_400)).toBe('reject');
  });
});

describe('pairing payload size', () => {
  // Sized by padding the content until the serialised event lands on the boundary, so the
  // test measures what the policy measures rather than a guess at the overhead.
  function eventOfBytes(target: number) {
    let padding = 0;
    for (let i = 0; i < 4096; i += 1) {
      if (eventBytes(pairEvent({ content: 'x'.repeat(padding) })) >= target) break;
      padding += 1;
    }
    return pairEvent({ content: 'x'.repeat(padding) });
  }

  it('accepts up to the limit and refuses past it', () => {
    const atLimit = eventOfBytes(PAIR_MAX_BYTES);
    expect(eventBytes(atLimit)).toBe(PAIR_MAX_BYTES);
    expect(decide(atLimit, null, NOW).action).toBe('accept');

    const under = pairEvent({ content: (atLimit.content as string).slice(1) });
    expect(eventBytes(under)).toBe(PAIR_MAX_BYTES - 1);
    expect(decide(under, null, NOW).action).toBe('accept');

    const over = pairEvent({ content: `${atLimit.content}x` });
    expect(eventBytes(over)).toBe(PAIR_MAX_BYTES + 1);
    const result = decide(over, null, NOW);
    expect(result.action).toBe('reject');
    expect(result.msg).toContain('bytes or smaller');
  });
});

describe('pairing rate window', () => {
  it('bounds how many pairing events one pubkey may publish', () => {
    const ledger = createLedger({ pairMaxPerAuthor: 3 }).load();
    const pubkey = 'b'.repeat(64);
    for (let i = 0; i < 3; i += 1) {
      expect(decide(pairEvent(), ledger.checkPairing(pubkey, NOW), NOW).action).toBe('accept');
      ledger.recordPairing(pubkey, NOW);
    }
    const result = decide(pairEvent(), ledger.checkPairing(pubkey, NOW), NOW);
    expect(result.action).toBe('reject');
    expect(result.msg).toContain('too many');
  });

  it('keeps authors separate and forgets entries once the window passes', () => {
    const ledger = createLedger({ pairMaxPerAuthor: 1 }).load();
    ledger.recordPairing('b'.repeat(64), NOW);
    expect(decide(pairEvent(), ledger.checkPairing('c'.repeat(64), NOW), NOW).action).toBe('accept');
    expect(decide(pairEvent(), ledger.checkPairing('b'.repeat(64), NOW), NOW).action).toBe('reject');
    const later = NOW + PAIR_WINDOW_SECONDS + 1;
    expect(decide(pairEvent({ tags: pairTags({ expiration: String(later + 60) }) }), ledger.checkPairing('b'.repeat(64), later), later).action).toBe('accept');
  });

  it('bounds the relay as a whole, not only each author', () => {
    const ledger = createLedger({ pairMaxTotal: 2 }).load();
    ledger.recordPairing('b'.repeat(64), NOW);
    ledger.recordPairing('c'.repeat(64), NOW);
    expect(decide(pairEvent(), ledger.checkPairing('d'.repeat(64), NOW), NOW).action).toBe('reject');
  });

  it('rejects a blocked pubkey and respects the storage ceiling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'policy-'));
    const pubkey = 'b'.repeat(64);
    const ledger = createLedger({ stateDir: directory }).load();
    expect(decide(pairEvent(), ledger.checkPairing(pubkey, NOW), NOW).action).toBe('accept');

    await writeFile(join(directory, 'blocklist.json'), JSON.stringify({ version: 1, blocked: { [pubkey]: { at: 'now' } } }));
    const blockedResult = decide(pairEvent(), ledger.checkPairing(pubkey, NOW), NOW);
    expect(blockedResult.action).toBe('reject');
    expect(blockedResult.msg).toContain('may not write');

    const full = createLedger({ ceilingBytes: 100, warn: () => {} }).load();
    full.record('c'.repeat(64), `${REQUIRED_D_PREFIX}settings`, 200);
    const ceilingResult = decide(pairEvent(), full.checkPairing('c'.repeat(64), NOW), NOW);
    expect(ceilingResult.action).toBe('reject');
    expect(ceilingResult.msg).toContain('storage ceiling');

    await rm(directory, { recursive: true, force: true });
  });

  it('never charges pairing against the persistent quota', () => {
    // The reason pairing has its own accounting at all: these events are reaped within
    // minutes, so a permanent per-author charge would bill storage nobody holds.
    const ledger = createLedger({ quotaBytes: 1000 }).load();
    handleLine(request(pairEvent()), ledger);
    expect(ledger.snapshot().totalBytes).toBe(0);
    expect(ledger.snapshot().authors).toHaveLength(0);
  });
});

describe('sync is unaffected by pairing support', () => {
  it('still rejects every non-Workstr shape it rejected before', () => {
    // The regression that matters: adding a second accepted family must not turn the
    // relay into general-purpose NIP-78 storage.
    expect(decide(event({ kind: 1, tags: [] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'coracle:settings']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'workstr:v1:settings']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', REQUIRED_D_PREFIX]] })).action).toBe('reject');
    expect(decide(event({ kind: 30078, tags: [['d', 'workstr:pair:0f0f']] })).action).toBe('reject');
    expect(decide(event()).action).toBe('accept');
  });

  it('rejects a pairing-shaped event on the sync kind, and a sync-shaped one on the pairing kind', () => {
    expect(decide(event({ kind: SYNC_KIND, tags: pairTags() }), null, NOW).action).toBe('reject');
    expect(decide(pairEvent({ tags: [['d', `${REQUIRED_D_PREFIX}settings`]] }), null, NOW).action).toBe('reject');
  });

  it('answers the pairing kind over the strfry line protocol', () => {
    const accepted = JSON.parse(handleLine(request(pairEvent({ tags: pairTags({ expiration: String(Math.floor(Date.now() / 1000) + 120) }) }))) as string);
    expect(accepted).toEqual({ id: 'a'.repeat(64), action: 'accept' });
    const rejected = JSON.parse(handleLine(request(pairEvent({ tags: pairTags({ v: '2' }) }))) as string);
    expect(rejected.action).toBe('reject');
    expect(rejected.msg).toMatch(/^blocked: /);
  });
});
