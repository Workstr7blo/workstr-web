import { describe, expect, it } from 'vitest';
import { canRepeat, repeatBlockedReason, repeatSeed } from '../src/features/train/repeat-workout';
import { repeatWorkoutButton } from '../src/features/train/views';
import type { ActiveSession, SessionExercise, SessionSetLog } from '../src/app/state';
import type { TrainingBlock } from '../src/core/types';

function completed(overrides: Partial<ActiveSession> = {}): ActiveSession {
  const exercises: SessionExercise[] = [
    { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', muscleGroup: 'Chest', imageUrl: 'data:image/png;base64,x', sets: 3, reps: '8', restSec: 90, weight: 60, notes: 'brace', instructions: ['lie down', 'press'] },
    { exerciseSlug: 'barbell-row', exerciseName: 'Barbell Row', muscleGroup: 'Back', sets: 3, reps: '10', restSec: 90, weight: 40 }
  ];
  const sets: SessionSetLog[] = [
    { exerciseSlug: 'bench-press', setNumber: 1, reps: 8, weight: 60, done: true, completedAt: '2026-08-18T10:01:00Z' },
    { exerciseSlug: 'bench-press', setNumber: 2, reps: 8, weight: 62.5, done: true, completedAt: '2026-08-18T10:05:00Z' },
    { exerciseSlug: 'bench-press', setNumber: 3, reps: 6, weight: 65, done: true, completedAt: '2026-08-18T10:09:00Z' },
    { exerciseSlug: 'barbell-row', setNumber: 1, reps: 10, weight: 45, done: true, completedAt: '2026-08-18T10:15:00Z' }
  ];
  return {
    id: 7, sheetName: 'Push Pull', startedAt: '2026-08-18T10:00:00Z', finishedAt: '2026-08-18T10:40:00Z',
    nostrEventId: 'abc123', summaryImageUrl: 'map.svg', exercises, sets, ...overrides
  };
}

const supersetBlocks: TrainingBlock[] = [{
  type: 'straight', rounds: 3, restAfterRoundSec: 90, steps: [
    { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', targetReps: '8' },
    { exerciseSlug: 'barbell-row', exerciseName: 'Barbell Row', targetReps: '10' }
  ]
}];

const emomBlocks: TrainingBlock[] = [{
  type: 'emom', rounds: 4, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', targetDurationSec: 30 }] }]
}];

describe('repeatability', () => {
  it('accepts a normal completed session', () => {
    expect(repeatBlockedReason(completed())).toBeNull();
    expect(canRepeat(completed())).toBe(true);
  });

  it('accepts superset and EMOM snapshots', () => {
    expect(canRepeat(completed({ blocks: supersetBlocks }))).toBe(true);
    expect(canRepeat(completed({ blocks: emomBlocks }))).toBe(true);
  });

  it('refuses a legacy session that recorded no exercises', () => {
    const legacy = completed({ exercises: [] });
    expect(canRepeat(legacy)).toBe(false);
    expect(repeatBlockedReason(legacy)).toContain('nothing to rebuild it from');
  });

  it('refuses a block referencing an exercise the snapshot never recorded', () => {
    const orphaned = completed({
      blocks: [{ type: 'straight', rounds: 3, steps: [{ exerciseSlug: 'ghost-move' }, { exerciseSlug: 'bench-press' }] }]
    });
    expect(canRepeat(orphaned)).toBe(false);
    expect(repeatBlockedReason(orphaned)).toContain('cannot be rebuilt safely');
  });

  it('accepts an unmatched step that still carries its own name', () => {
    // The session can name the movement, so the card renders and the workout is runnable.
    expect(canRepeat(completed({
      blocks: [{ type: 'straight', rounds: 3, steps: [{ exerciseSlug: 'ghost-move', exerciseName: 'Ghost Move' }] }]
    }))).toBe(true);
  });

  it('ignores an empty block rather than calling the session broken', () => {
    expect(canRepeat(completed({ blocks: [{ type: 'straight', rounds: 1, steps: [] }] }))).toBe(true);
  });
});

describe('repeatSeed', () => {
  it('carries name, order, exercise metadata and structure', () => {
    const seed = repeatSeed(completed({ blocks: supersetBlocks }));
    expect(seed.name).toBe('Push Pull');
    expect(seed.summaryImageUrl).toBe('map.svg');
    expect(seed.exercises.map((exercise) => exercise.exerciseSlug)).toEqual(['bench-press', 'barbell-row']);
    expect(seed.exercises[0]).toMatchObject({
      exerciseName: 'Bench Press', muscleGroup: 'Chest', sets: 3, reps: '8', restSec: 90, notes: 'brace'
    });
    expect(seed.exercises[0].instructions).toEqual(['lie down', 'press']);
    expect(seed.blocks).toEqual(supersetBlocks);
  });

  it('offers the last weight lifted as the starting value, not as logged work', () => {
    const seed = repeatSeed(completed());
    // Bench finished at 65; row's only set was 45.
    expect(seed.exercises[0].weight).toBe(65);
    expect(seed.exercises[1].weight).toBe(45);
  });

  it('falls back to the prescribed weight when nothing was logged for an exercise', () => {
    const seed = repeatSeed(completed({ sets: [] }));
    expect(seed.exercises[0].weight).toBe(60);
    expect(seed.exercises[1].weight).toBe(40);
  });

  it('ignores incomplete sets when choosing the reference weight', () => {
    const seed = repeatSeed(completed({
      sets: [
        { exerciseSlug: 'bench-press', setNumber: 1, reps: 8, weight: 60, done: true, completedAt: 'x' },
        { exerciseSlug: 'bench-press', setNumber: 2, reps: null, weight: 200, done: false, completedAt: 'x' }
      ]
    }));
    expect(seed.exercises[0].weight).toBe(60);
  });

  it('carries no logged work, publish id, finish time or clock state', () => {
    const seed = repeatSeed(completed({ blocks: emomBlocks, emomStartedAt: '2026-08-18T10:20:00Z', emomActiveSec: 240, emomPositionSec: 240, emomRunningSince: '2026-08-18T10:20:00Z' }));
    const keys = Object.keys(seed);
    expect(keys.sort()).toEqual(['blocks', 'exercises', 'name', 'summaryImageUrl']);
    // The EMOM structure is the workout and must survive; the EMOM clock is state from the
    // session that already happened and must not.
    expect(seed.blocks?.[0].type).toBe('emom');
    const serialised = JSON.stringify(seed);
    expect(serialised).not.toContain('abc123');       // publish id
    expect(serialised).not.toContain('finishedAt');
    expect(serialised).not.toContain('emomStartedAt');
    expect(serialised).not.toContain('emomActiveSec');
    expect(serialised).not.toContain('emomPositionSec');
    expect(serialised).not.toContain('emomRunningSince');
    expect(serialised).not.toContain('"done"');
  });

  it('never shares identity with the historical session', () => {
    const source = completed({ blocks: emomBlocks });
    const seed = repeatSeed(source);
    expect(seed.exercises[0]).not.toBe(source.exercises[0]);
    expect(seed.blocks).not.toBe(source.blocks);

    // Mutating the new session must leave the stored history untouched.
    seed.exercises[0].sets = 99;
    seed.exercises[0].instructions?.push('mutated');
    const seedBlock = seed.blocks?.[0];
    if (seedBlock?.type === 'emom') seedBlock.intervals[0].steps[0].targetDurationSec = 5;

    expect(source.exercises[0].sets).toBe(3);
    expect(source.exercises[0].instructions).toEqual(['lie down', 'press']);
    const sourceBlock = source.blocks?.[0];
    expect(sourceBlock?.type === 'emom' && sourceBlock.intervals[0].steps[0].targetDurationSec).toBe(30);
  });

  it('leaves a session with no blocks without any', () => {
    expect(repeatSeed(completed()).blocks).toBeUndefined();
    expect(repeatSeed(completed({ blocks: [] })).blocks).toBeUndefined();
  });

  it('names an unnamed workout Freestyle', () => {
    expect(repeatSeed(completed({ sheetName: '' })).name).toBe('Freestyle');
  });
});

describe('repeat button', () => {
  const parse = (markup: string): Element =>
    new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html').body.firstElementChild!;

  it('offers the action on a repeatable session', () => {
    const button = parse(repeatWorkoutButton(completed()));
    expect(button.getAttribute('data-repeat-session')).toBe('7');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.className).toContain('primary');
  });

  it('disables the action and explains why when a snapshot cannot be rebuilt', () => {
    const button = parse(repeatWorkoutButton(completed({ exercises: [] })));
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.hasAttribute('data-repeat-session')).toBe(false);
    expect(button.getAttribute('title')).toContain('nothing to rebuild it from');
  });
});
