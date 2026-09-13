import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/core/types';
import { WorkstrStore } from '../src/db/store';
import { planLibraryCatalogUpdates } from '../src/nostr/library-updates';

const address = (slug: string) => `33401:op:workstr:exercise:${slug}`;
const exercise = (slug: string, extra: Partial<Exercise> = {}): Exercise => ({
  slug, name: slug.replace(/-/g, ' '), muscles: [], equipment: [], tags: [], instructions: [], favourite: false,
  source_type: 'imported', status: 'active', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...extra
});

describe('planLibraryCatalogUpdates', () => {
  it('replaces an older library copy with the newer catalog version, keeping what is yours', () => {
    const local = exercise('mountain-climbers', { id: 4, nostr_address: address('mountain-climbers'), origin_created_at: 100, image_url: 'old.png', favourite: true, source_type: 'bundle', created_at: '2026-02-02T00:00:00.000Z' });
    const remote = exercise('mountain-climbers', { nostr_address: address('mountain-climbers'), origin_created_at: 200, image_url: 'new.png', description: 'Drive the knees.' });
    expect(planLibraryCatalogUpdates([local], [remote])).toEqual([{
      ...remote, id: 4, favourite: true, status: 'active', source_type: 'bundle', created_at: '2026-02-02T00:00:00.000Z'
    }]);
  });

  it('leaves a copy that is already current or newer', () => {
    const remote = exercise('plank', { nostr_address: address('plank'), origin_created_at: 200, image_url: 'new.png' });
    expect(planLibraryCatalogUpdates([exercise('plank', { nostr_address: address('plank'), origin_created_at: 200 })], [remote])).toEqual([]);
    expect(planLibraryCatalogUpdates([exercise('plank', { nostr_address: address('plank'), origin_created_at: 300 })], [remote])).toEqual([]);
  });

  it('never updates a copy without a catalog address, even when the slug matches', () => {
    const remote = exercise('plank', { nostr_address: address('plank'), origin_created_at: 200 });
    expect(planLibraryCatalogUpdates([exercise('plank', { source_type: 'manual', image_url: 'mine.png' })], [remote])).toEqual([]);
  });

  it('never takes another address for the same slug', () => {
    const local = exercise('plank', { nostr_address: '33401:someone:workstr:exercise:plank', origin_created_at: 1 });
    expect(planLibraryCatalogUpdates([local], [exercise('plank', { nostr_address: address('plank'), origin_created_at: 200 })])).toEqual([]);
  });
});

describe('a catalog update through the store', () => {
  it('keeps one row with its id and favourite and takes the new picture', async () => {
    const store = await WorkstrStore.open('library-catalog-updates');
    const id = await store.upsertExercise(exercise('mountain-climbers', { nostr_address: address('mountain-climbers'), origin_created_at: 100, image_url: 'old.png', favourite: true }));
    const remote = exercise('mountain-climbers', { nostr_address: address('mountain-climbers'), origin_created_at: 200, image_url: 'new.png' });

    for (const update of planLibraryCatalogUpdates(await store.listExercises(), [remote])) await store.upsertExercise(update);
    const rows = await store.listExercises();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, image_url: 'new.png', favourite: true, origin_created_at: 200 });
    expect(planLibraryCatalogUpdates(rows, [remote])).toEqual([]);
  });
});
