import { describe, expect, it } from 'vitest';
import {
  activeProgramFilterCount,
  programActiveFilters,
  programFilterLabel,
  programFilterSheet,
  programMatcher,
  programToolbar
} from '../src/features/sheets/program-browser';
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
    programFilters: { goal: '', focus: '', format: '', equipment: '' },
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
      programFilters: { goal: 'strength', focus: '', format: 'emom', equipment: '' }
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
    const state = browserState({ programFilters: { goal: 'mobility', focus: '', format: '', equipment: '' } });
    expect([strength, mobility].filter(programMatcher(state))).toEqual([mobility]);

    const both = browserState({
      programFilter: 'heavy',
      programFilters: { goal: 'mobility', focus: '', format: '', equipment: '' }
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
      programFilters: { goal: 'strength', focus: 'core', format: '', equipment: '' }
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
      programFilters: { goal: 'strength', focus: '', format: 'emom', equipment: 'dumbbell' }
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
      programFilters: { goal: 'strength', focus: '', format: '', equipment: '' }
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
      programFilters: { goal: 'mobility', focus: '', format: '', equipment: '' }
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
