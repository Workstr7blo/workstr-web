import { describe, expect, it } from 'vitest';
import type { EmomBlock } from '../src/core/types';
import { emomBlockDurationSec } from '../src/core/emom-blocks';
import { compileEmomBlocks, compileEmomSchedule, emomDurationSec, emomPosition } from '../src/features/train/emom';

const alternating: EmomBlock = {
  type: 'emom',
  rounds: 2,
  intervals: [
    { durationSec: 60, steps: [{ exerciseSlug: 'squat', targetReps: '10' }] },
    { durationSec: 60, steps: [{ exerciseSlug: 'pushup', targetReps: '8' }] }
  ]
};

describe('EMOM schedule', () => {
  it('runs multiple blocks sequentially and retains their block indexes', () => {
    const schedule = compileEmomBlocks([{ ...alternating, rounds: 1 }, { ...alternating, rounds: 2 }]);
    expect(schedule).toHaveLength(6);
    expect(schedule.map((slot) => slot.blockIndex)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(emomDurationSec(schedule)).toBe(360);
  });
  it('rotates intervals for every round', () => {
    const schedule = compileEmomSchedule(alternating);
    expect(schedule.map((slot) => [slot.roundIndex, slot.intervalIndex, slot.steps[0].exerciseSlug])).toEqual([
      [0, 0, 'squat'], [0, 1, 'pushup'], [1, 0, 'squat'], [1, 1, 'pushup']
    ]);
    expect(emomDurationSec(schedule)).toBe(240);
  });

  it('derives the active slot and remaining time from wall-clock time', () => {
    const schedule = compileEmomSchedule(alternating);
    expect(emomPosition(schedule, 10_000, 75_000)).toMatchObject({
      phase: 'running', secondsRemaining: 55, slot: { index: 1, roundIndex: 0, intervalIndex: 1 }
    });
    expect(emomPosition(schedule, 10_000, 250_000).phase).toBe('complete');
  });

  it('selects timed steps within a shared interval and leaves spare time as rest', () => {
    const schedule = compileEmomSchedule({
      type: 'emom', rounds: 1, intervals: [{ durationSec: 60, steps: [
        { exerciseSlug: 'a', targetDurationSec: 20, targetReps: '12' },
        { exerciseSlug: 'b', targetDurationSec: 20 },
        { exerciseSlug: 'c', targetDurationSec: 15 }
      ] }]
    });
    expect(emomPosition(schedule, 0, 19_000).activeStepIndex).toBe(0);
    expect(emomPosition(schedule, 0, 20_000).activeStepIndex).toBe(1);
    expect(emomPosition(schedule, 0, 40_000).activeStepIndex).toBe(2);
    expect(emomPosition(schedule, 0, 56_000).activeStepIndex).toBeNull();
  });

  it('stays pending until explicitly started', () => {
    expect(emomPosition(compileEmomSchedule(alternating), null)).toMatchObject({ phase: 'pending', secondsRemaining: 60 });
  });
});

describe('EMOM sections with a total duration', () => {
  const move = (slug: string) => ({ durationSec: 60, steps: [{ exerciseSlug: slug }] });
  const section = (minutes: number, ...slugs: string[]): EmomBlock => ({ type: 'emom', rounds: 1, totalDurationSec: minutes * 60, intervals: slugs.map(move) });
  const order = (block: EmomBlock) => compileEmomSchedule(block).map((slot) => slot.steps[0].exerciseSlug).join(' ');

  it('plays one move for every minute of the section', () => {
    const schedule = compileEmomSchedule(section(10, 'a'));
    expect(schedule).toHaveLength(10);
    expect(emomDurationSec(schedule)).toBe(600);
    expect(order(section(10, 'a'))).toBe('a a a a a a a a a a');
  });

  it('alternates two moves over ten minutes, never twenty', () => {
    const schedule = compileEmomSchedule(section(10, 'a', 'b'));
    expect(schedule).toHaveLength(10);
    expect(emomDurationSec(schedule)).toBe(600);
    expect(order(section(10, 'a', 'b'))).toBe('a b a b a b a b a b');
  });

  it('ends at the selected duration when the moves do not divide it', () => {
    expect(order(section(10, 'a', 'b', 'c'))).toBe('a b c a b c a b c a');
    expect(emomDurationSec(compileEmomSchedule(section(10, 'a', 'b', 'c')))).toBe(600);
  });

  it('keeps the duration when a move is removed or the order changes', () => {
    expect(order(section(10, 'a', 'c'))).toBe('a c a c a c a c a c');
    expect(emomDurationSec(compileEmomSchedule(section(10, 'a', 'c')))).toBe(600);
    expect(order(section(6, 'c', 'a', 'b'))).toBe('c a b c a b');
    expect(emomDurationSec(compileEmomSchedule(section(6, 'c', 'a', 'b')))).toBe(360);
  });

  it('adds sections together and restarts the minute count in each', () => {
    const schedule = compileEmomBlocks([section(10, 'a', 'b'), section(5, 'c')]);
    expect(emomDurationSec(schedule)).toBe(900);
    expect(schedule.slice(9, 11).map((slot) => slot.minuteIndex + 1)).toEqual([10, 1]);
    expect(schedule[10]).toMatchObject({ blockIndex: 1, minuteCount: 5, startsAtSec: 600 });
  });

  it('gives every minute its own logging coordinates', () => {
    const keys = compileEmomSchedule(section(10, 'a', 'b', 'c')).map((slot) => `${slot.roundIndex}:${slot.intervalIndex}`);
    expect(new Set(keys).size).toBe(10);
  });

  it('keeps a legacy section at rounds times intervals', () => {
    const legacy: EmomBlock = { type: 'emom', rounds: 10, intervals: [move('a'), move('b')] };
    const schedule = compileEmomSchedule(legacy);
    expect(emomDurationSec(schedule)).toBe(1200);
    expect(schedule[1]).toMatchObject({ minuteIndex: 1, minuteCount: 20, roundIndex: 0, intervalIndex: 1 });
    expect(emomBlockDurationSec(legacy)).toBe(1200);
    expect(emomBlockDurationSec(section(10, 'a', 'b'))).toBe(600);
  });
});
