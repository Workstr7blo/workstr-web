import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';

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
});
