import { describe, expect, it } from 'vitest';
import type { Exercise, Sheet } from '../src/core/types';
import type { RelayProgram, RelayProgramExercise } from '../src/nostr/canon';
import { planProgramImport, programImportState } from '../src/nostr/programImport';
import type { Event } from 'nostr-tools';
import type { SheetWithExercises } from '../src/db/store';
import { programFromEvent } from '../src/nostr/canon';
import { buildCreatorProgramEvent } from '../src/nostr/program-publish';

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
  difficulty: 'advanced',
  tags: ['hypertrophy', 'push'],
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

  describe("the active account's own publication", () => {
    const me = 'a'.repeat(64);
    const ownAddress = `33402:${me}:workstr:beastmode:program:push-day`;
    const own = (extra: Partial<RelayProgram> = {}) => program([], { pubkey: me, address: ownAddress, ...extra });

    it('is in-library when the relay copy is newer than the local sheet, not an update over edits', () => {
      const local = { ...sheet(ownAddress, 100), nostr_pubkey: me };
      expect(programImportState(own({ createdAt: 200 }), [local], me)).toBe('in-library');
      // Signed out, the same pair is an ordinary import again.
      expect(programImportState(own({ createdAt: 200 }), [local])).toBe('update');
    });

    it('is in-library when an edit cleared the address of the sheet it was published from', () => {
      expect(programImportState(own(), [sheet()], me)).toBe('in-library');
    });

    it('stays new for another author whose slug matches a local sheet', () => {
      expect(programImportState(program([], { address: '33402:op:workstr:beastmode:program:push-day' }), [sheet()], me)).toBe('new');
    });
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
      difficulty: 'advanced',
      tags: ['hypertrophy', 'push'],
      nostr_address: '33402:op:workstr:program:push-day',
      nostr_pubkey: 'op',
      nostr_event_id: 'ev1',
      origin_created_at: 321
    });
  });
});

// Creator programs published from Workstr Web name exercises by bare d tag, not full address.
describe('planProgramImport for creator programs', () => {
  const bare = (slug: string) => `workstr:exercise:${slug}`;
  const creator = (members: RelayProgramExercise[]) => program(members, { pubkey: 'creator', address: '33402:creator:workstr:beastmode:program:cardio', sourceLabel: 'creator' });

  it('imports a catalog exercise the library lacks when referenced by its bare d tag', () => {
    const canon = [exercise('burpee', address('burpee'), { muscle_group: 'Core', image_url: 'img' })];
    const plan = planProgramImport(creator([{ address: bare('burpee'), name: 'Burpee' }]), [], canon);
    expect(plan.unresolved).toEqual([]);
    expect(plan.exercisesToImport.map((entry) => entry.nostr_address)).toEqual([address('burpee')]);
    expect(plan.sheet.exercises[0]).toMatchObject({ exercise_slug: 'burpee', exercise_name: 'Burpee', muscle_group: 'Core', image_url: 'img' });
  });

  it('still prefers the library copy and imports nothing', () => {
    const canon = [exercise('burpee', address('burpee'))];
    const plan = planProgramImport(creator([{ address: bare('burpee') }]), [exercise('burpee', address('burpee'))], canon);
    expect(plan.exercisesToImport).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });

  it('imports once when a bare and a full reference name the same exercise', () => {
    const canon = [exercise('burpee', address('burpee'))];
    const plan = planProgramImport(creator([{ address: bare('burpee') }, { address: address('burpee') }]), [], canon);
    expect(plan.exercisesToImport).toHaveLength(1);
  });

  it('never resolves another author full address by slug', () => {
    const canon = [exercise('burpee', address('burpee'))];
    const plan = planProgramImport(creator([{ address: '33401:someone:workstr:exercise:burpee', name: 'Their Burpee' }]), [], canon);
    expect(plan.exercisesToImport).toEqual([]);
    expect(plan.unresolved).toEqual(['33401:someone:workstr:exercise:burpee']);
  });

  it('still reports a bare reference the catalog does not have', () => {
    expect(planProgramImport(creator([{ address: bare('ghost-move') }]), [], []).unresolved).toEqual([bare('ghost-move')]);
  });

  it('resolves the references Workstr Web itself publishes', () => {
    const published = {
      id: 1, slug: 'cardio', name: 'Cardio', notes: '', difficulty: 'beginner', tags: [], is_temporary: false, created_at: '', updated_at: '',
      exercises: [{ sheet_id: 1, exercise_slug: 'burpee', exercise_name: 'Burpee', position: 0, sets: 3, reps: '10', rest: 60 }]
    } as SheetWithExercises;
    const event = { ...buildCreatorProgramEvent(published), pubkey: 'c'.repeat(64), id: 'e'.repeat(64), sig: '' } as Event;
    const relay = programFromEvent(event);
    expect(relay?.exercises[0].address).toBe(bare('burpee'));
    const plan = planProgramImport(relay!, [], [exercise('burpee', address('burpee'))]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.exercisesToImport.map((entry) => entry.slug)).toEqual(['burpee']);
  });
});

describe('program exercise pictures on import', () => {
  it('uses the current catalog picture over the one the program event carries', () => {
    const canon = [exercise('mountain-climbers', address('mountain-climbers'), { image_url: 'new.png' })];
    const plan = planProgramImport(program([{ address: address('mountain-climbers'), imageUrl: 'old.png' }]), [], canon);
    expect(plan.sheet.exercises[0].image_url).toBe('new.png');
  });

  it('keeps the event picture for an exercise found nowhere', () => {
    const plan = planProgramImport(program([{ address: address('ghost-move'), imageUrl: 'old.png' }]), [], []);
    expect(plan.sheet.exercises[0].image_url).toBe('old.png');
  });
});
