import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../src/app/state';
import type { EmomSlot } from '../src/features/train/emom';
import {
  durationLabel,
  effectiveSessionStartedAt,
  emomCountdownTarget,
  emomTimerPhase,
  isMixedSession,
  preEmomElapsedSec,
  readEmomClock,
  restSecondsRemaining,
  sessionDurationSeconds,
  sessionSetCounts,
  standardSessionExercises,
  standardWorkComplete,
  supersetTransition,
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
  it('advances through a superset and rests only after each round', () => {
    const active = session({ blocks: [{ type: 'straight', rounds: 2, restAfterRoundSec: 60, steps: [
      { exerciseSlug: 'squat' }, { exerciseSlug: 'row' }
    ] }] });
    expect(supersetTransition(active, 'squat', 1)).toMatchObject({ roundIndex: 0, stepIndex: 0, nextExerciseSlug: 'row', roundComplete: false, restAfterRoundSec: 0 });
    expect(supersetTransition(active, 'row', 1)).toMatchObject({ roundIndex: 0, stepIndex: 1, nextExerciseSlug: 'squat', roundComplete: true, restAfterRoundSec: 60 });
    expect(supersetTransition(active, 'row', 2)).toMatchObject({ roundIndex: 1, stepIndex: 1, nextExerciseSlug: null, supersetComplete: true });
  });
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

  it('keeps mixed-program standard work separate from EMOM-only moves', () => {
    const mixed = session({
      exercises: [
        { exerciseSlug: 'push-up', exerciseName: 'Push Up', sets: 2, reps: '15', restSec: 30 },
        { exerciseSlug: 'superman', exerciseName: 'Superman', sets: 2, reps: '15', restSec: 30 },
        { exerciseSlug: 'sit-up', exerciseName: 'Sit Up', sets: 3, reps: '', restSec: 60 }
      ],
      blocks: [{ type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'sit-up', targetDurationSec: 40 }] }] }]
    });
    expect(standardSessionExercises(mixed).map((exercise) => exercise.exerciseSlug)).toEqual(['push-up', 'superman']);
    expect(sessionSetCounts(mixed)).toEqual({ 'push-up': 2, superman: 2 });
    expect(effectiveSessionStartedAt(mixed)).toBe(mixed.startedAt);
    expect(standardWorkComplete(mixed)).toBe(false);
    mixed.sets = ['push-up', 'push-up', 'superman', 'superman'].map((exerciseSlug, index) => ({
      exerciseSlug, setNumber: (index % 2) + 1, reps: 15, weight: null, done: true, completedAt: ''
    }));
    expect(standardWorkComplete(mixed)).toBe(true);
  });

  it('separates timed EMOM work from recovery', () => {
    const timed = slot(60, [20, 15]);
    expect(emomTimerPhase(timed, 5)).toMatchObject({ mode: 'work', secondsRemaining: 15, stepIndex: 0 });
    expect(emomTimerPhase(timed, 25)).toMatchObject({ mode: 'work', secondsRemaining: 10, stepIndex: 1 });
    expect(emomTimerPhase(timed, 40)).toMatchObject({ mode: 'recovery', secondsRemaining: 20, stepIndex: null });
  });

  it('counts down a timed step to the end of its own work, not the interval', () => {
    const timed = slot(60, [20, 15]);
    const at = (elapsed: number, remaining: number) => emomCountdownTarget(
      { phase: 'running', slot: timed, secondsRemaining: remaining, elapsedInSlotSec: elapsed, activeStepIndex: 0 },
      emomTimerPhase(timed, elapsed)
    );
    // Last 5s of the first step: its own clock, on a channel of its own.
    expect(at(17, 43)).toEqual({ channel: 'emom-work', period: `${timed.index}:0`, secondsRemaining: 3 });
    // Last 5s of the second step, which ends 25s before the interval does.
    expect(at(33, 27)).toEqual({ channel: 'emom-work', period: `${timed.index}:1`, secondsRemaining: 2 });
    // Recovery still follows the interval clock, so the round boundary is unchanged.
    expect(at(57, 3)).toEqual({ channel: 'emom', period: timed.index, secondsRemaining: 3 });
  });

  it('keeps one countdown source when a step fills its whole interval', () => {
    const full = slot(30, [30]);
    const target = emomCountdownTarget(
      { phase: 'running', slot: full, secondsRemaining: 4, elapsedInSlotSec: 26, activeStepIndex: 0 },
      emomTimerPhase(full, 26)
    );
    // Work and interval end together; the work channel wins so nothing beeps twice.
    expect(target).toEqual({ channel: 'emom-work', period: `${full.index}:0`, secondsRemaining: 4 });
  });

  it('falls back to the interval clock for rep-based intervals and idle phases', () => {
    const reps = slot(60, []);
    expect(emomCountdownTarget(
      { phase: 'running', slot: reps, secondsRemaining: 5, elapsedInSlotSec: 55, activeStepIndex: null },
      emomTimerPhase(reps, 55)
    )).toEqual({ channel: 'emom', period: reps.index, secondsRemaining: 5 });
    expect(emomCountdownTarget(
      { phase: 'complete', slot: null, secondsRemaining: 0, elapsedInSlotSec: 0, activeStepIndex: null }, null
    )).toBeNull();
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

  it('keeps the strength half of a mixed session in the clock', () => {
    const mixed = session({
      exercises: [
        { exerciseSlug: 'push-up', exerciseName: 'Push Up', sets: 2, reps: '15', restSec: 30 },
        { exerciseSlug: 'sit-up', exerciseName: 'Sit Up', sets: 3, reps: '', restSec: 60 }
      ],
      blocks: [{ type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'sit-up', targetDurationSec: 40 }] }] }],
      startedAt: '2026-08-15T10:00:00.000Z',
      emomStartedAt: '2026-08-15T10:05:00.000Z',
      emomActiveSec: 75,
      finishedAt: '2026-08-15T11:00:00.000Z'
    });
    expect(isMixedSession(mixed)).toBe(true);
    // The overlay clock stays on the real start, not the moment the EMOM took over.
    expect(effectiveSessionStartedAt(mixed)).toBe('2026-08-15T10:00:00.000Z');
    expect(preEmomElapsedSec(mixed)).toBe(300);
    // 5 min of strength + 75s of EMOM active time.
    expect(durationLabel(sessionDurationSeconds(mixed))).toBe('6m 15s');
  });

  it('treats an EMOM block with no steps as pure EMOM', () => {
    const emom = session({
      blocks: [{ type: 'emom', rounds: 1, intervals: [{ durationSec: 60, steps: [] }] }],
      emomStartedAt: '2026-08-15T10:05:00.000Z'
    });
    expect(isMixedSession(emom)).toBe(false);
    expect(preEmomElapsedSec(emom)).toBe(0);
  });
});
