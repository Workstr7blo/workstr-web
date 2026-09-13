import { describe, expect, it } from 'vitest';
import {
  activeProgramFilterCount,
  programActiveFilters,
  programFilterLabel,
  emptyProgramFilters,
  programFilterSheet,
  programMatcher,
  programToolbar,
  type ProgramFilters
} from '../src/features/sheets/program-browser';
import { MY_EQUIPMENT } from '../src/core/equipment';
import type { Exercise } from '../src/core/types';
import type { SheetWithExercises } from '../src/db/store';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';

function prog(partial: Partial<RelayProgram>): RelayProgram {
  return {
    slug: 's', name: 'P', description: '', tags: [], sourceLabel: '', eventId: '',
    pubkey: '', address: 'local:1', createdAt: 0, exercises: [], ...partial
  };
}

function browserState(partial: Partial<AppState> = {}): AppState {
  return {
    programFilter: '',
    programFilters: { goal: '', focus: '', format: '', level: '', equipment: '' },
    programFilterSheet: null,
    exercises: [],
    programs: [],
    sheets: [],
    ...partial
  } as unknown as AppState;
}

describe('program filter state', () => {
  it('counts only the four advanced filters, never the text search', () => {
    expect(activeProgramFilterCount(browserState())).toBe(0);
    expect(activeProgramFilterCount(browserState({ programFilter: 'squat' }))).toBe(0);
    expect(activeProgramFilterCount(browserState({
      programFilters: { goal: 'strength', focus: '', format: 'emom', level: '', equipment: '' }
    }))).toBe(2);
  });

  it('reads a state that predates programFilters without throwing', () => {
    const state = browserState();
    delete (state as Partial<AppState>).programFilters;
    expect(activeProgramFilterCount(state)).toBe(0);
    expect(programToolbar('programs', state)).toContain('program-search');
  });

  it('titles filter values for humans and keeps EMOM an acronym', () => {
    expect(programFilterLabel('strength')).toBe('Strength');
    expect(programFilterLabel('full-body')).toBe('Full Body');
    expect(programFilterLabel('minimal-equipment')).toBe('Minimal Equipment');
    expect(programFilterLabel('emom')).toBe('EMOM');
  });
});

describe('programMatcher', () => {
  const strength = prog({ name: 'Heavy Day', tags: ['strength', 'barbell'], difficulty: 'advanced' });
  const mobility = prog({ name: 'Loosen Up', address: 'local:2', tags: ['mobility', 'bodyweight'] });

  it('matches everything when nothing is set', () => {
    const match = programMatcher(browserState());
    expect([strength, mobility].filter(match)).toHaveLength(2);
  });

  it('searches name, description and difficulty', () => {
    expect([strength, mobility].filter(programMatcher(browserState({ programFilter: 'heavy' })))).toEqual([strength]);
    expect([strength, mobility].filter(programMatcher(browserState({ programFilter: 'advanced' })))).toEqual([strength]);
  });

  it('ands the advanced filters together with the search', () => {
    const state = browserState({ programFilters: { goal: 'mobility', focus: '', format: '', level: '', equipment: '' } });
    expect([strength, mobility].filter(programMatcher(state))).toEqual([mobility]);

    const both = browserState({
      programFilter: 'heavy',
      programFilters: { goal: 'mobility', focus: '', format: '', level: '', equipment: '' }
    });
    expect([strength, mobility].filter(programMatcher(both))).toEqual([]);
  });
});

describe('programToolbar', () => {
  it('keeps the ids the shell already binds, one per browser', () => {
    expect(programToolbar('programs', browserState())).toContain('id="program-filter"');
    expect(programToolbar('programs', browserState())).toContain('id="new-program"');
    expect(programToolbar('discover', browserState())).toContain('id="program-discover-filter"');
    expect(programToolbar('discover', browserState())).toContain('id="program-discover-refresh"');
  });

  it('offers create in Programs and refresh in Discover, never both', () => {
    const programs = programToolbar('programs', browserState());
    const discover = programToolbar('discover', browserState());
    expect(programs).not.toContain('program-discover-refresh');
    expect(discover).not.toContain('id="new-program"');
  });

  it('carries the search text and each browser its own placeholder', () => {
    const state = browserState({ programFilter: 'press' });
    expect(programToolbar('programs', state)).toContain('placeholder="Search programs..."');
    expect(programToolbar('programs', state)).toContain('value="press"');
    expect(programToolbar('discover', state)).toContain('placeholder="Search relay programs..."');
    expect(programToolbar('discover', state)).toContain('value="press"');
  });

  it('badges the toggle only when an advanced filter is on', () => {
    expect(programToolbar('programs', browserState())).not.toContain('program-filter-count');
    const filtered = programToolbar('programs', browserState({
      programFilters: { goal: 'strength', focus: 'core', format: '', level: '', equipment: '' }
    }));
    expect(filtered).toContain('<span class="program-filter-count" aria-hidden="true">2</span>');
    // The badge is decorative, so the count reaches assistive tech through the button's name.
    expect(filtered).toContain('aria-label="Filter programs, 2 filters active"');
  });

  it('renders no permanent filter selects', () => {
    expect(programToolbar('programs', browserState())).not.toContain('<select');
  });
});

describe('programActiveFilters', () => {
  it('renders nothing at all when no filter is active, reserving no space', () => {
    expect(programActiveFilters('programs', browserState())).toBe('');
  });

  it('shows one removable chip per active filter plus Clear', () => {
    const markup = programActiveFilters('programs', browserState({
      programFilters: { goal: 'strength', focus: '', format: 'emom', level: '', equipment: 'dumbbell' }
    }));
    expect(markup).toContain('data-program-filter-remove="goal"');
    expect(markup).toContain('data-program-filter-remove="format"');
    expect(markup).toContain('data-program-filter-remove="equipment"');
    expect(markup).not.toContain('data-program-filter-remove="focus"');
    expect(markup).toContain('>Strength</span>');
    expect(markup).toContain('>EMOM</span>');
    expect(markup).toContain('data-program-filter-clear="programs"');
  });
});

describe('programFilterSheet', () => {
  const withPrograms = (context: AppState['programFilterSheet'], programs: RelayProgram[]) =>
    browserState({ programFilterSheet: context, programs });

  it('renders nothing while closed', () => {
    expect(programFilterSheet(browserState())).toBe('');
  });

  it('is a labelled modal dialog', () => {
    const markup = programFilterSheet(withPrograms('discover', []));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="program-filter-title"');
  });

  it('offers every group as real buttons, with Any first and the current value pressed', () => {
    const markup = programFilterSheet(browserState({
      programFilterSheet: 'programs',
      programFilters: { goal: 'strength', focus: '', format: '', level: '', equipment: '' }
    }));
    for (const key of ['goal', 'focus', 'format', 'equipment']) {
      expect(markup).toContain(`data-program-filter="${key}" data-program-filter-value=""`);
    }
    expect(markup).toContain('data-program-filter="goal" data-program-filter-value="strength" aria-pressed="true"');
    expect(markup).toContain('data-program-filter="goal" data-program-filter-value="hypertrophy" aria-pressed="false"');
    expect(markup).not.toContain('<select');
  });

  it('counts the browser it was opened from, through the same matcher as the list', () => {
    const relay = [
      prog({ name: 'Relay A', address: 'a', tags: ['strength'] }),
      prog({ name: 'Relay B', address: 'b', tags: ['mobility'] })
    ];
    expect(programFilterSheet(withPrograms('discover', relay))).toContain('Show 2 programs');

    const filtered = browserState({
      programFilterSheet: 'discover',
      programs: relay,
      programFilters: { goal: 'mobility', focus: '', format: '', level: '', equipment: '' }
    });
    expect(programFilterSheet(filtered)).toContain('Show 1 program');

    // Programs counts local sheets, not the relay list, even with relay programs loaded.
    expect(programFilterSheet(withPrograms('programs', relay))).toContain('Show 0 programs');
  });

  it('names the list it is filtering', () => {
    expect(programFilterSheet(withPrograms('programs', []))).toContain('Filter programs');
    expect(programFilterSheet(withPrograms('discover', []))).toContain('Filter relay programs');
  });
});

describe('program taxonomy filters', () => {
  const exercise = (partial: Partial<Exercise>) => ({ muscles: [], tags: [], instructions: [], ...partial }) as Exercise;
  const burpee = exercise({ slug: 'burpee', name: 'Burpee', category: 'cardio', muscle_group: 'Core', equipment: ['bodyweight'] });
  const press = exercise({ slug: 'db-press', name: 'Dumbbell Press', category: 'strength', muscle_group: 'Chest', equipment: ['Dumbbells'] });
  const emom = [{ type: 'emom', rounds: 10, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'burpee' }] }] }] as unknown as RelayProgram['blocks'];
  const endurance = prog({ name: 'Burpee EMOM', address: 'e', difficulty: 'Beginner', tags: ['endurance'], blocks: emom, exercises: [{ address: 'workstr:exercise:burpee', name: 'Burpee' }] });
  const heavy = prog({ name: 'Press Day', address: 'h', difficulty: 'intermediate', tags: ['strength'], exercises: [{ address: 'workstr:exercise:db-press', name: 'Dumbbell Press' }] });
  const expert = prog({ name: 'Expert', address: 'x', difficulty: 'advanced', tags: [] });
  const settings = (ownedEquipment: string[]) => ({ ownedEquipment }) as unknown as AppState['settings'];
  const filtered = (filters: Partial<ProgramFilters>, extra: Partial<AppState> = {}) =>
    browserState({ exercises: [burpee, press], programFilters: { ...emptyProgramFilters(), ...filters }, ...extra });
  const pick = (state: AppState) => [endurance, heavy, expert].filter(programMatcher(state)).map((program) => program.name);

  it('filters Level from the stated difficulty, whatever its capitalisation', () => {
    expect(pick(filtered({ level: 'beginner' }))).toEqual(['Burpee EMOM']);
    expect(pick(filtered({ level: 'advanced' }))).toEqual(['Expert']);
  });

  it('counts Level the same way in Programs and Discover', () => {
    const beginner = { ...emptyProgramFilters(), level: 'beginner' };
    expect(programFilterSheet(browserState({ programFilterSheet: 'discover', programs: [endurance, heavy, expert], programFilters: beginner }))).toContain('Show 1 program');
    const sheet = (id: number, name: string, difficulty: string) => ({ id, slug: `s${id}`, name, notes: '', difficulty, tags: [], is_temporary: false, created_at: '', updated_at: '', exercises: [] }) as SheetWithExercises;
    expect(programFilterSheet(browserState({ programFilterSheet: 'programs', sheets: [sheet(1, 'Easy', 'beginner'), sheet(2, 'Hard', 'advanced')], programFilters: beginner }))).toContain('Show 1 program');
  });

  it('ands goal, format, level and equipment together', () => {
    const match = { goal: 'endurance', format: 'emom', level: 'beginner', equipment: 'body weight' };
    expect(pick(filtered(match))).toEqual(['Burpee EMOM']);
    for (const [key, value] of [['goal', 'strength'], ['format', 'normal'], ['level', 'advanced'], ['equipment', 'dumbbell']]) {
      expect(pick(filtered({ ...match, [key]: value }))).toEqual([]);
    }
  });

  it('never infers a goal from the movement type of the exercises in a program', () => {
    const untagged = [prog({ ...endurance, tags: [] })];
    expect(untagged.filter(programMatcher(filtered({ goal: 'endurance' })))).toEqual([]);
    expect(untagged.filter(programMatcher(filtered({ goal: 'conditioning' })))).toEqual([]);
  });

  it('resolves exercise equipment spellings onto the keys exercises filter on', () => {
    expect(pick(filtered({ equipment: 'dumbbell' }))).toEqual(['Press Day']);
    expect(pick(filtered({ equipment: 'body weight' }))).toEqual(['Burpee EMOM']);
  });

  it('matches My equipment only when the kit covers every piece a program needs', () => {
    expect(pick(filtered({ equipment: MY_EQUIPMENT }, { settings: settings(['barbell']) }))).toEqual(['Burpee EMOM', 'Expert']);
    expect(pick(filtered({ equipment: MY_EQUIPMENT }, { settings: settings(['Dumbbells']) }))).toEqual(['Burpee EMOM', 'Press Day', 'Expert']);
  });

  it('keeps unknown tags searchable without making them goals', () => {
    const tagged = [prog({ name: 'Tagged', tags: ['kettlebell-flow', 'endurance-ish'] })];
    expect(tagged.filter(programMatcher(browserState({ programFilter: 'kettlebell-flow' })))).toHaveLength(1);
    expect(tagged.filter(programMatcher(filtered({ goal: 'endurance' })))).toEqual([]);
  });

  it('offers Level between Format and Equipment with the shared labels', () => {
    const markup = programFilterSheet(browserState({ programFilterSheet: 'programs' }));
    const order = ['goal', 'focus', 'format', 'level', 'equipment'].map((key) => markup.indexOf(`id="program-filter-group-${key}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const label of ['Beginner', 'Intermediate', 'Advanced', 'Body Weight', 'Bands', 'Full Body']) expect(markup).toContain(`>${label}<`);
    expect(markup).not.toContain('My equipment');
    expect(programFilterSheet(browserState({ programFilterSheet: 'programs', settings: settings(['dumbbell']) }))).toContain('>My equipment<');
  });
});
