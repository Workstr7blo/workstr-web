import { describe, expect, it } from 'vitest';
import type { EmomBlock } from '../src/core/types';
import { compileEmomSchedule, emomDurationSec, emomPosition } from '../src/features/train/emom';

const alternating: EmomBlock = {
  type: 'emom',
  rounds: 2,
  intervals: [
    { durationSec: 60, steps: [{ exerciseSlug: 'squat', targetReps: '10' }] },
    { durationSec: 60, steps: [{ exerciseSlug: 'pushup', targetReps: '8' }] }
  ]
};

describe('EMOM schedule', () => {
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
