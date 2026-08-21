import { describe, expect, it } from 'vitest';
import { packChunks, replayChunks, supersededRatio, isLogEntry, type ChunkSource, type LogEntry } from '../src/sync/chunks';
import { bodyAddress, logAddress, newDeviceId, parseAddress } from '../src/sync/addresses';

const entry = (uid: string, updatedAt: string, payload: unknown = { reps: 5 }): LogEntry => ({ uid, updatedAt, payload });
const tombstone = (uid: string, updatedAt: string): LogEntry => ({ uid, updatedAt, deleted: true });

const chunk = (device: string, seq: number, entries: LogEntry[]): ChunkSource =>
  ({ address: logAddress(device, seq), device, seq, entries });

// Stands in for seal-and-measure: proportional to the JSON, which is all the packer needs.
const measure = async (entries: LogEntry[]): Promise<number> => JSON.stringify(entries).length;

describe('chunk addresses', () => {
  it('carries the device and sequence in the clear, and sorts by them', () => {
    expect(logAddress('7f3a1b2c', 4)).toBe('workstr:v2:log:7f3a1b2c:000004');
    expect(bodyAddress('7f3a1b2c', 0)).toBe('workstr:v2:body:7f3a1b2c:000000');
    expect(parseAddress(logAddress('7f3a1b2c', 4))).toEqual({
      kind: 'log', id: '7f3a1b2c:000004', device: '7f3a1b2c', seq: 4
    });
    // Zero padding is what makes the relay's own ordering usable without opening anything.
    expect([logAddress('aa', 10), logAddress('aa', 2)].sort()).toEqual([logAddress('aa', 2), logAddress('aa', 10)]);
  });

  it('refuses an address that is not a device and a sequence', () => {
    for (const address of ['workstr:v2:log:7f3a1b2c', 'workstr:v2:log:NOTHEX:000001', 'workstr:v2:log::1', 'workstr:v2:log:aa:x']) {
      expect(parseAddress(address)).toBeNull();
    }
  });

  it('mints a device id that is hex and addressable', () => {
    const device = newDeviceId();
    expect(device).toMatch(/^[0-9a-f]{8}$/);
    expect(parseAddress(logAddress(device, 1))?.device).toBe(device);
  });
});

describe('replaying the log', () => {
  it('takes the newest entry for each uid, whatever order the chunks arrive in', () => {
    const chunks = [
      chunk('bbbb', 0, [entry('s1', '2026-08-03T10:00:00.000Z', { reps: 8 })]),
      chunk('aaaa', 0, [entry('s1', '2026-08-01T10:00:00.000Z', { reps: 5 }), entry('s2', '2026-08-02T10:00:00.000Z')])
    ];
    const state = replayChunks(chunks);
    expect(state.get('s1')?.payload).toEqual({ reps: 8 });
    expect(state.get('s2')).toBeTruthy();
    // Reversed input, identical answer: nothing depends on arrival order.
    expect(replayChunks([...chunks].reverse()).get('s1')?.payload).toEqual({ reps: 8 });
  });

  it('lets a deletion win, so an edit inside a sealed chunk cannot resurrect it', () => {
    const state = replayChunks([
      chunk('aaaa', 0, [entry('s1', '2026-08-01T10:00:00.000Z')]),
      chunk('aaaa', 1, [tombstone('s1', '2026-08-05T10:00:00.000Z')])
    ]);
    expect(state.get('s1')?.deleted).toBe(true);
    // The uid is still present: a reader has to be able to tell removed from never seen.
    expect(state.has('s1')).toBe(true);
  });

  it('lets a later edit win over an earlier deletion', () => {
    const state = replayChunks([
      chunk('aaaa', 1, [tombstone('s1', '2026-08-05T10:00:00.000Z')]),
      chunk('bbbb', 0, [entry('s1', '2026-08-06T10:00:00.000Z', { reps: 12 })])
    ]);
    expect(state.get('s1')?.deleted).toBeFalsy();
    expect(state.get('s1')?.payload).toEqual({ reps: 12 });
  });

  it('breaks an exact tie the same way on every device', () => {
    const same = '2026-08-01T10:00:00.000Z';
    const a = chunk('aaaa', 0, [entry('s1', same, { from: 'a' })]);
    const b = chunk('bbbb', 0, [entry('s1', same, { from: 'b' })]);
    // Two devices that wrote in the same instant must not each keep their own answer.
    expect(replayChunks([a, b]).get('s1')?.payload).toEqual({ from: 'b' });
    expect(replayChunks([b, a]).get('s1')?.payload).toEqual({ from: 'b' });
  });

  it('ignores entries that are not entries, rather than throwing on relay data', () => {
    const state = replayChunks([chunk('aaaa', 0, [
      null as unknown as LogEntry, { uid: '', updatedAt: 'x' } as LogEntry,
      { uid: 's1' } as LogEntry, entry('s2', '2026-08-01T10:00:00.000Z')
    ])]);
    expect([...state.keys()]).toEqual(['s2']);
    expect(isLogEntry({ uid: 's1', updatedAt: '2026-08-01T10:00:00.000Z' })).toBe(true);
  });
});

describe('packing entries into chunks', () => {
  it('fills a chunk to the budget and starts a new one', async () => {
    const entries = Array.from({ length: 40 }, (_, index) => entry(`s${index}`, `2026-08-01T10:${String(index).padStart(2, '0')}:00.000Z`));
    const packed = await packChunks(entries, measure, 400);

    expect(packed.length).toBeGreaterThan(1);
    for (const part of packed) expect(part.bytes).toBeLessThanOrEqual(400);
    // Nothing is lost and nothing is duplicated in the split.
    expect(packed.flatMap((part) => part.entries.map((item) => item.uid)))
      .toEqual(entries.map((item) => item.uid));
  });

  it('keeps everything in one chunk when it fits', async () => {
    const entries = [entry('s1', '2026-08-01T10:00:00.000Z'), entry('s2', '2026-08-02T10:00:00.000Z')];
    const packed = await packChunks(entries, measure, 10000);
    expect(packed).toHaveLength(1);
    expect(packed[0].entries).toHaveLength(2);
  });

  it('gives an oversized entry its own chunk rather than dropping it', async () => {
    const huge = entry('big', '2026-08-01T10:00:00.000Z', { notes: 'x'.repeat(5000) });
    const packed = await packChunks([entry('s1', '2026-08-01T09:00:00.000Z'), huge], measure, 300);

    const uids = packed.flatMap((part) => part.entries.map((item) => item.uid));
    // Visible rejection at the relay beats silence: the entry must still be attempted.
    expect(uids).toContain('big');
    expect(packed.find((part) => part.entries.some((item) => item.uid === 'big'))!.entries).toHaveLength(1);
  });

  it('packs nothing into nothing', async () => {
    expect(await packChunks([], measure, 400)).toEqual([]);
  });
});

describe('deciding when a sealed chunk is worth rewriting', () => {
  it('measures how much of it later entries have superseded', () => {
    const old = chunk('aaaa', 0, [entry('s1', '2026-08-01T10:00:00.000Z'), entry('s2', '2026-08-02T10:00:00.000Z')]);
    const newer = chunk('aaaa', 1, [entry('s1', '2026-08-09T10:00:00.000Z')]);
    const winners = replayChunks([old, newer]);

    expect(supersededRatio(old, winners)).toBe(0.5);
    expect(supersededRatio(newer, winners)).toBe(0);
    expect(supersededRatio(chunk('aaaa', 2, []), winners)).toBe(0);
  });
});
