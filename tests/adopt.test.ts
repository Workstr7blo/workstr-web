import { describe, expect, it } from 'vitest';
import { copyNamespace, deleteNamespace, namespaceHasUserData } from '../src/db/adopt';
import { WorkstrStore, type ExerciseDraft } from '../src/db/store';
import { openWorkstrDB } from '../src/db/schema';

const draft = (slug: string): ExerciseDraft => ({
  slug,
  name: slug,
  muscles: ['chest'],
  equipment: [],
  tags: [],
  instructions: []
});

// Simulates a legacy install that still has bundled starter rows.
async function seededStore(namespace: string): Promise<WorkstrStore> {
  const store = await WorkstrStore.open(namespace);
  for (const slug of ['bench-press', 'squat']) {
    await store.upsertExercise({ ...draft(slug), source_type: 'bundle' });
  }
  return store;
}

describe('namespaceHasUserData', () => {
  it('is false for a fresh namespace', async () => {
    expect(await namespaceHasUserData('t-hud-fresh')).toBe(false);
  });

  it('is false for a namespace holding only the bundled seed', async () => {
    const store = await seededStore('t-hud-seeded');
    store.close();
    expect(await namespaceHasUserData('t-hud-seeded')).toBe(false);
  });

  it('counts a favourited seed exercise as user data', async () => {
    const store = await seededStore('t-hud-fav');
    const [exercise] = await store.listExercises();
    await store.upsertExercise({ ...exercise, favourite: true });
    store.close();
    expect(await namespaceHasUserData('t-hud-fav')).toBe(true);
  });

  it('counts a deleted seed exercise as user data', async () => {
    const store = await seededStore('t-hud-del');
    const [exercise] = await store.listExercises();
    await store.deleteExercise(exercise.id!);
    store.close();
    expect(await namespaceHasUserData('t-hud-del')).toBe(true);
  });

  it('counts a logged session as user data', async () => {
    const store = await seededStore('t-hud-session');
    await store.createSession({ started_at: new Date().toISOString(), sheet_name: 'Push day' });
    store.close();
    expect(await namespaceHasUserData('t-hud-session')).toBe(true);
  });
});

describe('copyNamespace', () => {
  it('replaces the target with a full copy, preserving keys', async () => {
    const src = await seededStore('t-copy-src');
    const [exercise] = await src.listExercises();
    await src.upsertExercise({ ...exercise, favourite: true });
    const sheetId = await src.saveSheet({ name: 'Push day', exercises: [{ exercise_slug: 'bench-press', position: 0, sets: 3 }] });
    const sessionId = await src.createSession({ started_at: '2026-07-15T10:00:00.000Z', sheet_id: sheetId, sheet_name: 'Push day' });
    await src.addSessionSet({ session_id: sessionId, set_number: 1, reps: 8, weight_kg: 60, completed_at: '2026-07-15T10:05:00.000Z' });
    await src.logBody({ date: '2026-07-15', weight_kg: 80 });
    await src.saveSettings({ ...(await src.getSettings()), unit: 'lbs' });
    const rawSrc = await openWorkstrDB('t-copy-src');
    await rawSrc.put('plan', { week: ['push'] }, 'current');
    rawSrc.close();
    src.close();

    // target already has diverging content that must be replaced, not merged
    const dst = await seededStore('t-copy-dst');
    await dst.createSession({ started_at: '2026-01-01T00:00:00.000Z', sheet_name: 'Old workout' });
    dst.close();

    await copyNamespace('t-copy-src', 't-copy-dst');

    const copied = await WorkstrStore.open('t-copy-dst');
    const sessions = await copied.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sheet_name).toBe('Push day');
    expect(sessions[0].id).toBe(sessionId);
    const sets = await copied.listSessionSets(sessionId);
    expect(sets).toHaveLength(1);
    expect(sets[0].weight_kg).toBe(60);
    const sheets = await copied.listSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0].id).toBe(sheetId);
    expect(sheets[0].exercises[0].exercise_slug).toBe('bench-press');
    expect((await copied.listExercises()).find((entry) => entry.slug === exercise.slug)?.favourite).toBe(true);
    expect((await copied.listBody())[0].weight_kg).toBe(80);
    expect((await copied.getSettings()).unit).toBe('lbs');
    copied.close();
    const rawDst = await openWorkstrDB('t-copy-dst');
    expect(await rawDst.get('plan', 'current')).toEqual({ week: ['push'] });
    rawDst.close();
  });
});

describe('deleteNamespace', () => {
  it('removes all data for the namespace', async () => {
    const store = await seededStore('t-del');
    await store.createSession({ started_at: new Date().toISOString() });
    store.close();
    await deleteNamespace('t-del');
    expect(await namespaceHasUserData('t-del')).toBe(false);
    const raw = await openWorkstrDB('t-del');
    expect(await raw.count('exercises')).toBe(0);
    raw.close();
  });
});
