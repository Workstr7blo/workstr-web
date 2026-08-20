import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ACCEPTED_KIND, REQUIRED_D_PREFIX, createLedger, decide, handleLine } from '../relay/write-policy.mjs';
import { ledgerFromEvents } from '../relay/relay-admin.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// jsdom gives import.meta.url an http origin, so resolve from the vitest root instead.
const PLUGIN = resolve('relay/write-policy.mjs');

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
    expect(decide(event({ tags: [['d', 'workstr:v2:session:1']] })).action).toBe('reject');
    expect(decide(event({ tags: [['d', 'notworkstr:v1:session:1']] })).action).toBe('reject');
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
  // Drives the real executable the way strfry does, so a break in the stdin loop,
  // the shebang, or the import-guard is caught here rather than on the relay.
  function run(lines: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile('node', [PLUGIN], (error, stdout) => (error ? reject(error) : resolve(stdout)));
      child.stdin?.end(lines.join('\n') + '\n');
    });
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
