import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import type { ExerciseDraft } from '../src/db/store';
import { openWorkstrDB } from '../src/db/schema';

const bundleDraft = (slug: string): ExerciseDraft => ({
  slug,
  name: slug,
  muscles: ['Chest'],
  equipment: [],
  tags: [],
  instructions: [],
  source_type: 'bundle'
});

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

  it('removes untouched legacy starter rows but keeps favourites and user exercises', async () => {
    const store = await WorkstrStore.open('seed-cleanup-pubkey');
    await store.upsertExercise(bundleDraft('old-seed'));
    await store.upsertExercise({ ...bundleDraft('kept-seed'), favourite: true });
    await store.upsertExercise({ ...bundleDraft('mine'), source_type: 'imported' });
    await store.removeStarterExercises();
    await store.removeStarterExercises();
    const slugs = (await store.listExercises()).map((exercise) => exercise.slug).sort();
    expect(slugs).toEqual(['kept-seed', 'mine']);
  });

  it('soft-deletes exercises', async () => {
    const store = await WorkstrStore.open('soft-delete-pubkey');
    await store.upsertExercise({ ...bundleDraft('gone'), source_type: 'imported' });
    const [exercise] = await store.listExercises();
    await store.deleteExercise(exercise.id!);
    expect(await store.getExercise(exercise.id!)).toBeUndefined();
    expect(await store.listExercises()).toHaveLength(0);
  });

  it('persists settings in IndexedDB using self-hosted lbs naming', async () => {
    const store = await WorkstrStore.open('settings-test-pubkey');
    const defaults = await store.getSettings();
    expect(defaults.unit).toBe('kg');

    await store.saveSettings({ ...defaults, unit: 'lbs' });
    expect((await store.getSettings()).unit).toBe('lbs');
  });

  it('migrates retired relay and catalog source vocabulary on open', async () => {
    const raw = await openWorkstrDB('retired-vocabulary-test');
    const legacyRelayKey = ['paid', 'Relay'].join('');
    const legacyCatalogSource = ['pre', 'mium'].join('');
    await raw.put('settings', { unit: 'kg', publicRelays: [], [legacyRelayKey]: 'wss://backup.example' }, 'settings');
    await raw.put('exercises', {
      ...bundleDraft('legacy-catalog'), favourite: false, status: 'active', source_type: legacyCatalogSource
    } as never);
    raw.close();

    const store = await WorkstrStore.open('retired-vocabulary-test');
    const settings = await store.getSettings();
    expect(settings.workstrRelay).toBe('wss://backup.example');
    expect(settings).not.toHaveProperty(legacyRelayKey);
    expect((await store.listExercises())[0].source_type).toBe('imported');
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

  it('persists EMOM program blocks and resumable session timing', async () => {
    const store = await WorkstrStore.open('emom-session-test-pubkey');
    const blocks = [{ type: 'emom' as const, rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'squat', targetReps: '10', targetDurationSec: 20 }] }] }];
    const sheetId = await store.saveSheet({ name: 'EMOM', blocks, exercises: [] });
    expect((await store.listSheets()).find((sheet) => sheet.id === sheetId)?.blocks).toEqual(blocks);
    const sessionId = await store.createSession({ sheet_name: 'EMOM', started_at: '2026-01-01T00:00:00Z', blocks, exercises: [] });
    await store.startSessionEmom(sessionId, '2026-01-01T00:01:00Z');
    await store.updateSessionEmomClock(sessionId, 45, 40, undefined);
    expect((await store.listSessions()).find((session) => session.id === sessionId)).toMatchObject({
      blocks,
      started_at: '2026-01-01T00:01:00Z',
      emom_started_at: '2026-01-01T00:01:00Z',
      emom_position_sec: 45,
      emom_active_sec: 40
    });
  });
});
