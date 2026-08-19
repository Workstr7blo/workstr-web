import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ACCEPTED_KIND, REQUIRED_D_PREFIX, decide, handleLine } from '../relay/write-policy.mjs';

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
