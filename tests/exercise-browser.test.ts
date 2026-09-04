import { describe, expect, it } from 'vitest';
import {
  activeFacetCount,
  exerciseActiveFilters,
  exerciseFilterSheet,
  exerciseQuery,
  exerciseResults,
  exerciseSelectionBar,
  exerciseToolbar
} from '../src/app/exercise-browser';
import type { AppState } from '../src/app/state';
import type { Exercise } from '../src/core/types';

function ex(partial: Partial<Exercise>): Exercise {
  return {
    slug: 'x', name: 'X', muscles: [], equipment: [], tags: [], instructions: [],
    favourite: false, source_type: 'manual', status: 'active', ...partial
  } as Exercise;
}

function browserState(partial: Partial<AppState> = {}): AppState {
  return {
    filter: '',
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    exerciseFilterSheet: null,
    library: [],
    discoverExercises: [],
    librarySelect: { active: false, slugs: new Set<string>() },
    discoverSelect: { active: false, addresses: new Set<string>() },
    settings: { unit: 'kg', publicRelays: [] },
    ...partial
  } as unknown as AppState;
}

const PRESS = ex({ slug: 'press', name: 'Bench Press', category: 'strength', difficulty: 'beginner', equipment: ['barbell'] });
const PLANK = ex({ slug: 'plank', name: 'Plank', category: 'core', difficulty: 'beginner', equipment: [] });

describe('exercise filter state', () => {
  it('reads each view from its own slice of state', () => {
    const state = browserState({
      filter: 'bench',
      exFilter: { cat: 'strength', muscle: '', diff: '', equip: '' },
      discoverFilter: { q: 'squat', cat: '', muscle: '', diff: 'beginner', equip: '' }
    });
    expect(exerciseQuery('library', state)).toBe('bench');
    expect(exerciseQuery('discover', state)).toBe('squat');
    expect(activeFacetCount('library', state)).toBe(1);
    expect(activeFacetCount('discover', state)).toBe(1);
  });

  it('counts facets only, never the text search', () => {
    expect(activeFacetCount('library', browserState({ filter: 'anything' }))).toBe(0);
    expect(activeFacetCount('library', browserState({
      exFilter: { cat: 'strength', muscle: 'Core', diff: 'beginner', equip: '' }
    }))).toBe(3);
  });

  it('filters each view from its own list', () => {
    const state = browserState({ library: [PRESS, PLANK], discoverExercises: [PRESS] });
    expect(exerciseResults('library', state)).toHaveLength(2);
    expect(exerciseResults('discover', state)).toHaveLength(1);
  });

  it('applies one view\'s facets without touching the other view\'s results', () => {
    const state = browserState({
      library: [PRESS, PLANK],
      discoverExercises: [PRESS, PLANK],
      exFilter: { cat: 'core', muscle: '', diff: '', equip: '' }
    });
    expect(exerciseResults('library', state).map((e) => e.slug)).toEqual(['plank']);
    expect(exerciseResults('discover', state)).toHaveLength(2);
  });
});

describe('exerciseToolbar', () => {
  it('keeps the search ids the shell already binds, one per view', () => {
    expect(exerciseToolbar('library', browserState())).toContain('id="ex-search"');
    expect(exerciseToolbar('discover', browserState())).toContain('id="discover-search"');
  });

  it('offers refresh only on Discover, and a select toggle on both', () => {
    const library = exerciseToolbar('library', browserState({ library: [PRESS] }));
    const discover = exerciseToolbar('discover', browserState({ discoverExercises: [PRESS] }));
    expect(library).not.toContain('id="discover-refresh"');
    expect(library).toContain('id="lib-select-toggle"');
    expect(discover).toContain('id="discover-refresh"');
    expect(discover).toContain('id="discover-select-toggle"');
  });

  it('disables select when there is nothing to select', () => {
    expect(exerciseToolbar('library', browserState())).toContain('title="Select" disabled');
    expect(exerciseToolbar('library', browserState({ library: [PRESS] }))).not.toContain('disabled');
  });

  it('badges each view from its own facets', () => {
    const state = browserState({ exFilter: { cat: 'strength', muscle: 'Core', diff: '', equip: '' } });
    expect(exerciseToolbar('library', state)).toContain('>2</span>');
    expect(exerciseToolbar('library', state)).toContain('aria-label="Filter exercises, 2 filters active"');
    expect(exerciseToolbar('discover', state)).not.toContain('program-filter-count');
  });

  it('renders no permanent selects', () => {
    expect(exerciseToolbar('library', browserState())).not.toContain('<select');
    expect(exerciseToolbar('discover', browserState())).not.toContain('<select');
  });
});

describe('exerciseActiveFilters', () => {
  it('renders nothing when no facet is active', () => {
    expect(exerciseActiveFilters('library', browserState())).toBe('');
  });

  it('tags each chip with the view it belongs to', () => {
    const markup = exerciseActiveFilters('discover', browserState({
      discoverFilter: { q: '', cat: 'core', muscle: '', diff: 'beginner', equip: '' }
    }));
    expect(markup).toContain('data-exercise-filter-remove="cat" data-exercise-view="discover"');
    expect(markup).toContain('data-exercise-filter-remove="diff" data-exercise-view="discover"');
    expect(markup).not.toContain('data-exercise-filter-remove="muscle"');
    expect(markup).toContain('data-exercise-filter-clear="discover"');
  });

  it('labels the owned-equipment facet in words', () => {
    const markup = exerciseActiveFilters('library', browserState({
      exFilter: { cat: '', muscle: '', diff: '', equip: '@mine' }
    }));
    expect(markup).toContain('>My equipment</span>');
  });
});

describe('exerciseFilterSheet', () => {
  it('renders nothing while closed', () => {
    expect(exerciseFilterSheet(browserState())).toBe('');
  });

  it('is a labelled modal dialog naming the list it filters', () => {
    const library = exerciseFilterSheet(browserState({ exerciseFilterSheet: 'library' }));
    expect(library).toContain('role="dialog"');
    expect(library).toContain('aria-modal="true"');
    expect(library).toContain('Filter your library');
    expect(exerciseFilterSheet(browserState({ exerciseFilterSheet: 'discover' }))).toContain('Filter the catalog');
  });

  it('derives its options from the exercises that view actually holds', () => {
    const state = browserState({
      exerciseFilterSheet: 'library',
      library: [PRESS, PLANK]
    });
    const markup = exerciseFilterSheet(state);
    expect(markup).toContain('data-exercise-filter-value="strength"');
    expect(markup).toContain('data-exercise-filter-value="core"');
    expect(markup).toContain('data-exercise-filter-value="barbell"');
    // Discover holds nothing here, so its sheet offers only the "any" options.
    expect(exerciseFilterSheet(browserState({ exerciseFilterSheet: 'discover', library: [PRESS] })))
      .not.toContain('data-exercise-filter-value="strength"');
  });

  it('offers My equipment only once a kit is saved', () => {
    const without = exerciseFilterSheet(browserState({ exerciseFilterSheet: 'library', library: [PRESS] }));
    expect(without).not.toContain('>My equipment<');
    const withKit = exerciseFilterSheet(browserState({
      exerciseFilterSheet: 'library', library: [PRESS],
      settings: { unit: 'kg', publicRelays: [], ownedEquipment: ['barbell'] }
    } as Partial<AppState>));
    expect(withKit).toContain('>My equipment<');
  });

  it('keeps a selected value listed after its option disappears', () => {
    // Delete the last kettlebell exercise and the grid is still filtering on it; dropping
    // the option would leave an empty grid with nothing to undo.
    const markup = exerciseFilterSheet(browserState({
      exerciseFilterSheet: 'library',
      library: [PLANK],
      exFilter: { cat: '', muscle: '', diff: '', equip: 'kettlebell' }
    }));
    expect(markup).toContain('data-exercise-filter-value="kettlebell" aria-pressed="true"');
  });

  it('counts through the same call that builds the grid', () => {
    const state = browserState({ exerciseFilterSheet: 'library', library: [PRESS, PLANK] });
    expect(exerciseFilterSheet(state)).toContain('Show 2 exercises');
    const filtered = browserState({
      exerciseFilterSheet: 'library', library: [PRESS, PLANK],
      exFilter: { cat: 'core', muscle: '', diff: '', equip: '' }
    });
    expect(exerciseFilterSheet(filtered)).toContain('Show 1 exercise');
  });
});

describe('exerciseSelectionBar', () => {
  it('renders nothing unless a view is selecting', () => {
    expect(exerciseSelectionBar(browserState())).toBe('');
  });

  it('offers delete for the library, with the count and a disabled empty state', () => {
    const empty = exerciseSelectionBar(browserState({
      library: [PRESS, PLANK], librarySelect: { active: true, slugs: new Set<string>() }
    }));
    expect(empty).toContain('id="lib-delete-selected"');
    expect(empty).toContain('Delete (0)');
    expect(empty).toContain('disabled');
    expect(empty).toContain('Select all');

    const chosen = exerciseSelectionBar(browserState({
      library: [PRESS, PLANK], librarySelect: { active: true, slugs: new Set(['press']) }
    }));
    expect(chosen).toContain('Delete (1)');
    expect(chosen).not.toContain('disabled');
  });

  it('flips Select all to Clear all once everything visible is chosen', () => {
    const all = exerciseSelectionBar(browserState({
      library: [PRESS, PLANK], librarySelect: { active: true, slugs: new Set(['press', 'plank']) }
    }));
    expect(all).toContain('Clear all');
  });

  it('offers import for Discover instead of delete', () => {
    const markup = exerciseSelectionBar(browserState({
      discoverExercises: [PRESS], discoverSelect: { active: true, addresses: new Set(['press']) }
    }));
    expect(markup).toContain('id="discover-import-selected"');
    expect(markup).toContain('Import (1)');
    expect(markup).not.toContain('lib-delete-selected');
  });
});
