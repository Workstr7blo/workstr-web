import { describe, expect, it } from 'vitest';
import { getRecovery } from '../src/features/recovery/recovery';
import { getQuickWorkout } from '../src/features/recovery/quickWorkout';
import type { Exercise } from '../src/core/types';

const libraryExercise = (slug: string, muscleGroup: string) =>
  ({ slug, name: slug, muscle_group: muscleGroup, muscles: [muscleGroup], tags: [] } as unknown as Exercise);

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

function makeSession(finishedAt: string, slug: string, muscleGroup: string, setCount = 3) {
  return {
    id: 1,
    sheetName: 'Test',
    startedAt: finishedAt,
    finishedAt,
    exercises: [{ exerciseSlug: slug, exerciseName: slug, muscleGroup, sets: setCount, reps: '10', restSec: 90 }],
    sets: Array.from({ length: setCount }, (_item, index) => ({
      exerciseSlug: slug, setNumber: index + 1, reps: 10, weight: 50, done: true, completedAt: finishedAt
    }))
  };
}

describe('getRecovery', () => {
  it('reports every group untrained with no sessions', () => {
    const data = getRecovery([], []);
    expect(data.muscleGroups).toHaveLength(10);
    expect(data.muscleGroups.every((group) => group.status === 'untrained' && group.percent === 100)).toBe(true);
    expect(data.overallReadiness).toBe(100);
    expect(data.readyCount).toBe(10);
  });

  it('matches the self-hosted percent math for a primary muscle', () => {
    // Chest base 72h, 3 sets -> multiplier 0.7 -> adjusted 50.4h; 36h elapsed -> 71% partial
    const data = getRecovery([makeSession(hoursAgo(36), 'bench-press', 'Chest')], []);
    const chest = data.muscleGroups.find((group) => group.name === 'Chest')!;
    expect(chest.percent).toBe(71);
    expect(chest.status).toBe('partial');
    expect(chest.hoursRemaining).toBe(14.4);
    expect(chest.totalSets).toBe(3);
  });

  it('counts secondary muscles at half a set via the library lookup', () => {
    const library = [{ slug: 'bench-press', name: 'Bench Press', muscle_group: 'Chest', muscles: ['Chest', 'Triceps'] } as unknown as Exercise];
    // Triceps: 3 sets x 0.5 = 1.5 -> multiplier 0.4 -> adjusted 14.4h; 36h elapsed -> ready
    const data = getRecovery([makeSession(hoursAgo(36), 'bench-press', 'Chest')], library);
    const triceps = data.muscleGroups.find((group) => group.name === 'Triceps')!;
    expect(triceps.status).toBe('ready');
    expect(triceps.totalSets).toBe(2); // rounded from 1.5
  });

  it('ignores sessions older than ten days', () => {
    const data = getRecovery([makeSession(hoursAgo(11 * 24), 'squat', 'Quadriceps')], []);
    const quads = data.muscleGroups.find((group) => group.name === 'Quadriceps')!;
    expect(quads.status).toBe('untrained');
  });
});

describe('getQuickWorkout', () => {
  const library = [
    libraryExercise('bench-press', 'Chest'),
    libraryExercise('squat', 'Quadriceps'),
    libraryExercise('deadlift', 'Hamstrings'),
    libraryExercise('lateral-raise', 'Lateral Deltoid')
  ];

  it('includes untrained muscle groups with no history at all', () => {
    const data = getQuickWorkout([], library, 45, 80);
    const groups = new Set(data.exercises.map((exercise) => exercise.muscleGroup));
    expect(groups).toContain('Chest');
    expect(groups).toContain('Quadriceps');
    expect(groups).toContain('Hamstrings');
  });

  it('folds granular muscle names into their canonical group', () => {
    const data = getQuickWorkout([], library, 60, 80);
    expect(data.exercises.find((exercise) => exercise.slug === 'lateral-raise')?.muscleGroup).toBe('Shoulders');
  });

  it('excludes a freshly trained group but keeps untrained ones', () => {
    // 12 sets of chest 1h ago -> recovering; untrained groups stay eligible
    const session = makeSession(hoursAgo(1), 'bench-press', 'Chest', 12);
    const data = getQuickWorkout([session], library, 60, 80);
    const groups = new Set(data.exercises.map((exercise) => exercise.muscleGroup));
    expect(groups).not.toContain('Chest');
    expect(groups).toContain('Quadriceps');
    expect(groups).toContain('Hamstrings');
    expect(groups).toContain('Shoulders');
  });
});
