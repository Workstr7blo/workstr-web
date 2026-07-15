import { describe, expect, it } from 'vitest';
import type { Exercise, Sheet } from '../src/core/types';
import type { RelayProgram, RelayProgramExercise } from '../src/nostr/canon';
import { planProgramImport, programImportState } from '../src/nostr/programImport';

const exerciseBase: Omit<Exercise, 'slug'> = {
  name: 'Bench Press',
  muscles: ['Chest'],
  equipment: [],
  tags: [],
  instructions: [],
  favourite: false,
  source_type: 'imported',
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const exercise = (slug: string, address?: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ ...exerciseBase, slug, name: slug.replace(/-/g, ' '), nostr_address: address, ...extra });

const address = (slug: string) => `33401:op:workstr:exercise:${slug}`;

const program = (members: RelayProgramExercise[], extra: Partial<RelayProgram> = {}): RelayProgram => ({
  slug: 'push-day',
  name: 'Push Day',
  description: 'Chest and triceps',
  tags: [],
  exercises: members,
  sourceLabel: 'Workstr',
  eventId: 'ev1',
  pubkey: 'op',
  address: '33402:op:workstr:program:push-day',
  createdAt: 100,
  ...extra
});

const sheet = (nostrAddress?: string, originCreatedAt?: number): Sheet => ({
  slug: 'push-day',
  name: 'Push Day',
  is_temporary: false,
  nostr_address: nostrAddress,
  origin_created_at: originCreatedAt,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
});

describe('programImportState', () => {
  it('is new when no sheet carries the program address', () => {
    expect(programImportState(program([]), [])).toBe('new');
    expect(programImportState(program([]), [sheet()])).toBe('new');
  });

  it('is in-library when the same address exists at the same version', () => {
    expect(programImportState(program([]), [sheet('33402:op:workstr:program:push-day', 100)])).toBe('in-library');
  });

  it('is update when the remote created_at is newer on the same address', () => {
    expect(programImportState(program([], { createdAt: 200 }), [sheet('33402:op:workstr:program:push-day', 100)])).toBe('update');
  });

  it('is new when the sheet was forked by a builder edit', () => {
    // Saving from the builder clears the nostr fields, so the program can be
    // imported again as a separate sheet without clobbering the edit.
    expect(programImportState(program([]), [sheet(undefined, undefined)])).toBe('new');
  });
});

describe('planProgramImport', () => {
  it('imports referenced canon exercises missing from the library', () => {
    const canon = [exercise('bench-press', address('bench-press')), exercise('dips', address('dips'))];
    const library = [exercise('bench-press', address('bench-press'))];
    const plan = planProgramImport(program([{ address: address('bench-press') }, { address: address('dips') }]), library, canon);
    expect(plan.exercisesToImport.map((entry) => entry.slug)).toEqual(['dips']);
    expect(plan.unresolved).toEqual([]);
  });

  it('does not import twice when a program references the same exercise in two rows', () => {
    const canon = [exercise('dips', address('dips'))];
    const plan = planProgramImport(program([{ address: address('dips') }, { address: address('dips') }]), [], canon);
    expect(plan.exercisesToImport).toHaveLength(1);
  });

  it('reuses a forked library row on slug collision instead of importing over it', () => {
    // The library row lost its address by editing; importing the canon row
    // would clobber it (upsertExercise matches by slug), so the walk links
    // the sheet row to the local fork instead.
    const canon = [exercise('bench-press', address('bench-press'))];
    const library = [exercise('bench-press', undefined, { name: 'My Bench' })];
    const plan = planProgramImport(program([{ address: address('bench-press') }]), library, canon);
    expect(plan.exercisesToImport).toEqual([]);
    expect(plan.sheet.exercises[0].exercise_slug).toBe('bench-press');
  });

  it('keeps a name-only row for addresses resolved nowhere', () => {
    const plan = planProgramImport(program([{ address: address('ghost-move'), name: 'Ghost Move' }]), [], []);
    expect(plan.unresolved).toEqual([address('ghost-move')]);
    expect(plan.sheet.exercises[0].exercise_name).toBe('Ghost Move');
    expect(plan.sheet.exercises[0].exercise_slug).toBe('ghost-move');
  });

  it('derives a readable name from the address slug when the event has none', () => {
    const plan = planProgramImport(program([{ address: address('ghost-move') }]), [], []);
    expect(plan.sheet.exercises[0].exercise_name).toBe('ghost move');
  });

  it('maps event fields into sheet rows with library fallbacks and positions', () => {
    const canon = [exercise('dips', address('dips'), { default_sets: 4, default_reps: '6-10', default_rest: 120, muscle_group: 'Chest', image_url: 'img' })];
    const plan = planProgramImport(program([
      { address: address('dips'), sets: 5, reps: '5', restSec: 180, weight: '20', notes: 'slow negatives' },
      { address: address('dips') }
    ]), [], canon);
    expect(plan.sheet.exercises[0]).toMatchObject({ sets: 5, reps: '5', rest: 180, weight: 20, notes: 'slow negatives', position: 0 });
    expect(plan.sheet.exercises[1]).toMatchObject({ sets: 4, reps: '6-10', rest: 120, muscle_group: 'Chest', image_url: 'img', weight: undefined, position: 1 });
  });

  it('stamps the sheet with the program nostr identity for update detection', () => {
    const plan = planProgramImport(program([], { createdAt: 321 }), [], []);
    expect(plan.sheet).toMatchObject({
      name: 'Push Day',
      notes: 'Chest and triceps',
      nostr_address: '33402:op:workstr:program:push-day',
      nostr_pubkey: 'op',
      nostr_event_id: 'ev1',
      origin_created_at: 321
    });
  });
});
