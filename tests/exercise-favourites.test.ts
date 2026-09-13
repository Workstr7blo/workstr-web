// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { activeFacetCount, exerciseActiveFilters, exerciseFilterSheet, exerciseResults, exerciseToolbar } from '../src/app/exercise-browser';
import { bindExerciseBrowser } from '../src/app/exercise-browser-controller';
import type { CatalogController } from '../src/app/catalog-controller';
import type { AppState } from '../src/app/state';
import type { Exercise } from '../src/core/types';
import { libraryEmptyText, libraryPanel } from '../src/features/library/views';

const ex = (slug: string, name: string, extra: Partial<Exercise> = {}): Exercise => ({
  slug, name, muscles: [], equipment: [], tags: [], instructions: [], favourite: false,
  source_type: 'imported', status: 'active', created_at: '', updated_at: '', ...extra
});
const AIR_BIKE = ex('air-bike', 'Air Bike', { favourite: true, muscle_group: 'Core' });
const BIRD_DOG = ex('bird-dog', 'Bird Dog', { muscle_group: 'Core' });
const SQUAT = ex('bodyweight-squat', 'Bodyweight Squat', { favourite: true, muscle_group: 'Quadriceps' });

function browserState(partial: Partial<AppState> = {}): AppState {
  return {
    filter: '',
    exFilter: { cat: '', muscle: '', diff: '', equip: '', fav: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    exerciseFilterSheet: null,
    library: [AIR_BIKE, BIRD_DOG, SQUAT],
    discoverExercises: [AIR_BIKE, BIRD_DOG, SQUAT],
    librarySelect: { active: false, slugs: new Set<string>() },
    discoverSelect: { active: false, addresses: new Set<string>() },
    settings: { unit: 'kg', publicRelays: [] },
    authorProfiles: {},
    ...partial
  } as unknown as AppState;
}
const favourites = (extra: Partial<AppState['exFilter']> = {}) => ({ exFilter: { cat: '', muscle: '', diff: '', equip: '', fav: 'on', ...extra } });
const names = (state: AppState, view: 'library' | 'discover' = 'library') => exerciseResults(view, state).map((exercise) => exercise.name);

describe('Favorites only', () => {
  it('shows only starred exercises', () => {
    expect(names(browserState(favourites()))).toEqual(['Air Bike', 'Bodyweight Squat']);
  });

  it('combines with a muscle and with search', () => {
    expect(names(browserState(favourites({ muscle: 'Core' })))).toEqual(['Air Bike']);
    expect(names(browserState({ ...favourites(), filter: 'squat' }))).toEqual(['Bodyweight Squat']);
  });

  it('drops an exercise as soon as it is unstarred', () => {
    const state = browserState({ ...favourites(), library: [AIR_BIKE, BIRD_DOG, { ...SQUAT, favourite: false }] });
    expect(names(state)).toEqual(['Air Bike']);
  });

  it('never applies to Discover, whose exercises are not favorites yet', () => {
    const state = browserState({ ...favourites(), discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '', fav: 'on' } as AppState['discoverFilter'] });
    expect(names(state, 'discover')).toHaveLength(3);
    expect(activeFacetCount('discover', state)).toBe(0);
    expect(exerciseToolbar('discover', state)).not.toContain('lib-favourites-toggle');
  });

  it('counts as a filter, shows a chip, and presses the toolbar star', () => {
    const state = browserState(favourites());
    expect(activeFacetCount('library', state)).toBe(1);
    expect(exerciseActiveFilters('library', state)).toContain('data-exercise-filter-remove="fav" data-exercise-view="library"');
    expect(exerciseActiveFilters('library', state)).toContain('<span>Favorites</span>');
    const toolbar = exerciseToolbar('library', state);
    expect(toolbar).toContain('id="lib-favourites-toggle" type="button" aria-pressed="true" aria-label="Show favorite exercises only"');
    expect(toolbar).toContain('aria-label="Filter exercises, 1 filter active"');
    expect(exerciseToolbar('library', browserState())).toContain('aria-pressed="false" aria-label="Show favorite exercises only"');
  });

  it('sits between search and the filter button', () => {
    const toolbar = exerciseToolbar('library', browserState());
    const order = ['id="ex-search"', 'id="lib-favourites-toggle"', 'data-exercise-filter-open="library"', 'id="lib-select-toggle"'].map((marker) => toolbar.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('Favorites empty states', () => {
  it('explains how to add the first favorite', () => {
    const none = browserState({ ...favourites(), library: [BIRD_DOG] });
    expect(libraryEmptyText(none)).toContain('No favorite exercises yet.');
    expect(libraryEmptyText(none)).toContain('Tap the star on an exercise to add it here.');
  });

  it('says the filters are why favorites are hidden', () => {
    expect(libraryEmptyText(browserState(favourites({ muscle: 'Back' })))).toBe('No favorite exercises match these filters.');
  });

  it('leaves the ordinary messages alone when Favorites is off', () => {
    expect(libraryEmptyText(browserState({ exFilter: { cat: '', muscle: 'Back', diff: '', equip: '' } }))).toBe('No exercises match.');
    expect(libraryEmptyText(browserState({ library: [] }))).toContain('Your library is empty.');
  });
});

describe('Favorites controls', () => {
  function mount(state: AppState) {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const catalog = { toggleFavourite: vi.fn(async () => {}), openExerciseDetail: vi.fn() } as unknown as CatalogController;
    const render = vi.fn(() => { root.innerHTML = libraryPanel(state) + exerciseFilterSheet(state); bindExerciseBrowser(context); });
    const renderResults = vi.fn();
    const context = { root, state, render, renderResults, catalog };
    render();
    render.mockClear();
    return { root, catalog, render, renderResults };
  }

  it('toggles from the toolbar and keeps focus on the star', () => {
    const state = browserState();
    const app = mount(state);
    app.root.querySelector<HTMLButtonElement>('#lib-favourites-toggle')!.click();
    expect(state.exFilter.fav).toBe('on');
    expect(app.render).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe('lib-favourites-toggle');
    app.root.querySelector<HTMLButtonElement>('#lib-favourites-toggle')!.click();
    expect(state.exFilter.fav).toBe('');
  });

  it('turns off from its chip, and from Clear with the other facets, keeping the search', () => {
    const chip = browserState({ ...favourites({ muscle: 'Core' }), filter: 'air' });
    mount(chip).root.querySelector<HTMLButtonElement>('[data-exercise-filter-remove="fav"]')!.click();
    expect(chip.exFilter).toMatchObject({ fav: '', muscle: 'Core' });

    const clear = browserState({ ...favourites({ muscle: 'Core' }), filter: 'air' });
    mount(clear).root.querySelector<HTMLButtonElement>('[data-exercise-filter-clear="library"]')!.click();
    expect(clear.exFilter).toEqual({ cat: '', muscle: '', diff: '', equip: '', fav: '' });
    expect(clear.filter).toBe('air');
  });

  it('turns off from Reset filters in the sheet', () => {
    const state = browserState({ ...favourites({ diff: 'beginner' }), exerciseFilterSheet: 'library' });
    const app = mount(state);
    app.root.querySelector<HTMLButtonElement>('#exercise-filter-reset')!.click();
    expect(state.exFilter).toEqual({ cat: '', muscle: '', diff: '', equip: '', fav: '' });
    expect(app.renderResults).toHaveBeenCalledWith('library');
  });

  it('stars from the card without opening the exercise', () => {
    const app = mount(browserState());
    app.root.querySelector<HTMLButtonElement>('[data-fav="bird-dog"]')!.click();
    expect(app.catalog.toggleFavourite).toHaveBeenCalledWith('bird-dog');
    expect(app.catalog.openExerciseDetail).not.toHaveBeenCalled();
  });
});
