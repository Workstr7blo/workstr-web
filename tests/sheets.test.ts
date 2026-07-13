import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';

describe('WorkstrStore sheets', () => {
  it('creates, lists, edits and deletes a program with ordered exercises', async () => {
    const store = await WorkstrStore.open('sheet-test-pubkey');
    const id = await store.saveSheet({
      name: 'Push Day',
      notes: 'chest focus',
      exercises: [
        { exercise_slug: 'bench-press', exercise_name: 'Bench Press', muscle_group: 'Chest', sets: 4, reps: '6-8', rest: 120, weight: 80, position: 0 },
        { exercise_slug: 'lateral-raise', exercise_name: 'Lateral Raise', muscle_group: 'Shoulders', sets: 3, reps: '12-15', rest: 60, weight: null, position: 1 }
      ]
    });
    let sheets = await store.listSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ id, name: 'Push Day', notes: 'chest focus', slug: 'push-day' });
    expect(sheets[0].exercises.map((row) => row.exercise_slug)).toEqual(['bench-press', 'lateral-raise']);

    // Edit: rename, reorder — slug must stay stable, rows fully replaced
    await store.saveSheet({
      name: 'Push Day v2',
      notes: '',
      exercises: [
        { exercise_slug: 'lateral-raise', exercise_name: 'Lateral Raise', sets: 3, reps: '12-15', rest: 60, weight: null, position: 0 },
        { exercise_slug: 'bench-press', exercise_name: 'Bench Press', sets: 5, reps: '5', rest: 180, weight: 85, position: 1 }
      ]
    }, id);
    sheets = await store.listSheets();
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Push Day v2');
    expect(sheets[0].slug).toBe('push-day');
    expect(sheets[0].exercises.map((row) => row.exercise_slug)).toEqual(['lateral-raise', 'bench-press']);
    expect(sheets[0].exercises[1].weight).toBe(85);

    await store.deleteSheet(id);
    expect(await store.listSheets()).toHaveLength(0);
  });

  it('mints unique slugs for programs with the same name and hides temporary sheets', async () => {
    const store = await WorkstrStore.open('sheet-slug-test-pubkey');
    await store.saveSheet({ name: 'Leg Day', exercises: [] });
    await store.saveSheet({ name: 'Leg Day', exercises: [] });
    await store.saveSheet({ name: 'Quick Mix', is_temporary: true, exercises: [] });
    const sheets = await store.listSheets();
    expect(sheets).toHaveLength(2);
    expect(new Set(sheets.map((sheet) => sheet.slug))).toEqual(new Set(['leg-day', 'leg-day-2']));
  });
});
