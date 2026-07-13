import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import starterExercises from '../src/data/starter-exercises.json';
import type { ExerciseDraft } from '../src/db/store';

describe('WorkstrStore', () => {
  it('opens a pubkey-scoped database and stores exercises', async () => {
    const store = await WorkstrStore.open('test-pubkey');
    await store.upsertExercise({
      slug: 'push-up',
      name: 'Push Up',
      muscles: ['Chest'],
      equipment: ['bodyweight'],
      tags: [],
      instructions: [],
      favourite: false,
      source_type: 'manual',
      status: 'active',
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    });
    const exercises = await store.listExercises();
    expect(exercises).toHaveLength(1);
    expect(exercises[0].slug).toBe('push-up');
  });

  it('seeds bundled exercises once and soft-deletes exercises', async () => {
    const store = await WorkstrStore.open('seed-test-pubkey');
    const seeded = await store.seedExercises(starterExercises as ExerciseDraft[]);
    const seededAgain = await store.seedExercises(starterExercises as ExerciseDraft[]);
    expect(seeded).toBe(starterExercises.length);
    expect(seededAgain).toBe(0);

    const exercises = await store.listExercises();
    expect(exercises.length).toBe(starterExercises.length);
    await store.deleteExercise(exercises[0].id!);
    expect(await store.getExercise(exercises[0].id!)).toBeUndefined();
    expect(await store.listExercises()).toHaveLength(starterExercises.length - 1);
  });

  it('persists settings in IndexedDB using self-hosted lbs naming', async () => {
    const store = await WorkstrStore.open('settings-test-pubkey');
    const defaults = await store.getSettings();
    expect(defaults.unit).toBe('kg');

    await store.saveSettings({ ...defaults, unit: 'lbs' });
    expect((await store.getSettings()).unit).toBe('lbs');
  });

  it('registers completed workouts and their sets in IndexedDB', async () => {
    const store = await WorkstrStore.open('session-test-pubkey');
    const sessionId = await store.createSession({
      sheet_name: 'Full Body',
      started_at: '2026-07-13T14:00:00.000Z',
      exercises: [{ exerciseSlug: 'dumbbell-squat', exerciseName: 'Dumbbell Squat', sets: 1, reps: '8', restSec: 90, weight: 6.8 }]
    });
    await store.addSessionSet({
      session_id: sessionId,
      exercise_slug: 'dumbbell-squat',
      exercise_name: 'Dumbbell Squat',
      set_number: 1,
      reps: 8,
      weight_kg: 6.8,
      completed_at: '2026-07-13T14:01:00.000Z'
    });
    await store.finishSession(sessionId, '2026-07-13T14:02:00.000Z');

    const sessions = await store.listSessions();
    const saved = sessions.find((session) => session.id === sessionId);
    expect(saved?.sheet_name).toBe('Full Body');
    expect(saved?.finished_at).toBe('2026-07-13T14:02:00.000Z');
    expect(await store.listSessionSets(sessionId)).toMatchObject([{ exercise_slug: 'dumbbell-squat', reps: 8, weight_kg: 6.8 }]);
  });
});
