import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../src/app/state';
import type { EmomSlot } from '../src/features/train/emom';
import {
  durationLabel,
  effectiveSessionStartedAt,
  emomTimerPhase,
  readEmomClock,
  restSecondsRemaining,
  sessionDurationSeconds,
  sessionSetCounts,
  writeEmomClock
} from '../src/features/train/session-logic';

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 1,
    sheetName: 'Test',
    startedAt: '2026-08-15T10:00:00.000Z',
    exercises: [{ exerciseSlug: 'squat', exerciseName: 'Squat', sets: 3, reps: '5', restSec: 90 }],
    sets: [],
    ...overrides
  };
}

function slot(durationSec: number, targetDurations: number[]): EmomSlot {
  return {
    index: 0,
    blockIndex: 0,
    roundIndex: 0,
    intervalIndex: 0,
    durationSec,
    startsAtSec: 0,
    endsAtSec: durationSec,
    steps: targetDurations.map((targetDurationSec, index) => ({
      exerciseSlug: `exercise-${index}`,
      exerciseName: `Exercise ${index}`,
      targetDurationSec
    }))
  };
}

describe('session runner pure logic', () => {
  it('reconciles rest time against a wall-clock deadline', () => {
    expect(restSecondsRemaining(10_500, 8_000)).toBe(3);
    expect(restSecondsRemaining(7_000, 8_000)).toBe(0);
  });

  it('keeps enough set rows for resumed logged work', () => {
    const resumed = session({ sets: [0, 1, 2, 3].map((index) => ({
      exerciseSlug: 'squat', setNumber: index + 1, reps: 5, weight: 100, done: true, completedAt: ''
    })) });
    expect(sessionSetCounts(resumed)).toEqual({ squat: 4 });
  });

  it('separates timed EMOM work from recovery', () => {
    const timed = slot(60, [20, 15]);
    expect(emomTimerPhase(timed, 5)).toMatchObject({ mode: 'work', secondsRemaining: 15, stepIndex: 0 });
    expect(emomTimerPhase(timed, 25)).toMatchObject({ mode: 'work', secondsRemaining: 10, stepIndex: 1 });
    expect(emomTimerPhase(timed, 40)).toMatchObject({ mode: 'recovery', secondsRemaining: 20, stepIndex: null });
  });

  it('uses the persisted EMOM clock and start time', () => {
    const emom = session({
      blocks: [{ type: 'emom', rounds: 1, intervals: [{ durationSec: 60, steps: [] }] }],
      emomStartedAt: '2026-08-15T10:05:00.000Z',
      emomPositionSec: 12,
      emomActiveSec: 9,
      emomRunningSince: '2026-08-15T10:06:00.000Z'
    });
    expect(effectiveSessionStartedAt(emom)).toBe(emom.emomStartedAt);
    expect(readEmomClock(emom)).toEqual({ positionSec: 12, activeSec: 9, runningSinceMs: Date.parse(emom.emomRunningSince!) });
    writeEmomClock(emom, { positionSec: 20, activeSec: 14, runningSinceMs: null });
    expect(emom).toMatchObject({ emomPositionSec: 20, emomActiveSec: 14, emomRunningSince: undefined });
  });

  it('formats normal wall-clock and EMOM active durations', () => {
    const normal = session({ finishedAt: '2026-08-15T10:02:05.000Z' });
    expect(durationLabel(sessionDurationSeconds(normal))).toBe('2m 5s');
    const emom = session({
      blocks: [{ type: 'emom', rounds: 1, intervals: [{ durationSec: 60, steps: [] }] }],
      emomStartedAt: '2026-08-15T10:05:00.000Z',
      emomActiveSec: 75,
      finishedAt: '2026-08-15T11:00:00.000Z'
    });
    expect(durationLabel(sessionDurationSeconds(emom))).toBe('1m 15s');
  });
});
