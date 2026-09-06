import { discoverImportable, discoverImportState } from '../features/discover/views';
import type { CatalogController } from './catalog-controller';
import { exerciseResults, type ExerciseFacet, type ExerciseView } from './exercise-browser';
import type { RenderOptions } from './root-rebuild';
import type { AppState } from './state';

export interface ExerciseBrowserContext {
  root: HTMLElement;
  state: AppState;
  render(options?: RenderOptions): void;
  // Opening a card, importing one, favouriting and deleting are the catalog's work; this
  // module owns which card was clicked, not what happens to it.
  catalog: CatalogController;
}

const NO_FACETS = { cat: '', muscle: '', diff: '', equip: '' };

/**
 * Wiring for the exercise filter sheet, its options, the active-facet chips, and Clear.
 *
 * Library and Discover keep separate facet state, so every handler resolves which view it
 * is acting on before writing. Writing the wrong one would silently filter the view the
 * user is not looking at.
 *
 * Rebound after every render, like the rest of the shell's bindings, and every handler
 * redraws — so anything that should still hold focus is refocused by selector.
 */
export function bindExerciseBrowser({ root, state, render, catalog }: ExerciseBrowserContext): void {
  bindLibraryGrid();
  bindDiscoverGrid();

  const setFacet = (view: ExerciseView, facet: ExerciseFacet, value: string) => {
    if (view === 'discover') state.discoverFilter = { ...state.discoverFilter, [facet]: value };
    else state.exFilter = { ...state.exFilter, [facet]: value };
  };

  // Clears facets only. The text search is the user's own typing, is visible in the field
  // they typed it into, and is not one of the chips being cleared.
  const clearFacets = (view: ExerciseView) => {
    if (view === 'discover') state.discoverFilter = { ...state.discoverFilter, ...NO_FACETS };
    else state.exFilter = { ...NO_FACETS };
  };

  const closeSheet = () => {
    const opener = state.exerciseFilterSheet;
    state.exerciseFilterSheet = null;
    render();
    root.querySelector<HTMLElement>(`[data-exercise-filter-open="${opener}"]`)?.focus();
  };

  root.querySelectorAll<HTMLElement>('[data-exercise-filter-open]').forEach((button) => button.addEventListener('click', () => {
    state.exerciseFilterSheet = button.dataset.exerciseFilterOpen as AppState['exerciseFilterSheet'];
    render();
    root.querySelector<HTMLElement>('.program-filter-sheet .program-filter-option')?.focus();
  }));

  root.querySelectorAll<HTMLElement>('[data-exercise-filter-close]').forEach((backdrop) => backdrop.addEventListener('click', closeSheet));
  root.querySelector('#exercise-filter-apply')?.addEventListener('click', closeSheet);

  // Scoped to the sheet, not the document: these bindings rerun on every render, and a
  // document listener added here would stack up one copy per redraw.
  root.querySelector('.program-filter-sheet')?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && state.exerciseFilterSheet) closeSheet();
  });

  root.querySelectorAll<HTMLElement>('[data-exercise-filter]').forEach((option) => option.addEventListener('click', () => {
    const view = state.exerciseFilterSheet;
    if (!view) return;
    const facet = option.dataset.exerciseFilter as ExerciseFacet;
    const value = option.dataset.exerciseFilterValue || '';
    setFacet(view, facet, value);
    render();
    // The sheet stays open, so put focus back on the option that was just chosen.
    root.querySelector<HTMLElement>(`[data-exercise-filter="${facet}"][data-exercise-filter-value="${value}"]`)?.focus();
  }));

  root.querySelector('#exercise-filter-reset')?.addEventListener('click', () => {
    if (!state.exerciseFilterSheet) return;
    clearFacets(state.exerciseFilterSheet);
    render();
    root.querySelector<HTMLElement>('#exercise-filter-reset')?.focus();
  });

  root.querySelectorAll<HTMLElement>('[data-exercise-filter-remove]').forEach((chip) => chip.addEventListener('click', () => {
    setFacet(chip.dataset.exerciseView as ExerciseView, chip.dataset.exerciseFilterRemove as ExerciseFacet, '');
    render();
  }));

  root.querySelectorAll<HTMLElement>('[data-exercise-filter-clear]').forEach((button) => button.addEventListener('click', () => {
    clearFacets(button.dataset.exerciseFilterClear as ExerciseView);
    render();
  }));

  // Card clicks are delegated to the grid itself, so writing new cards into it - which a
  // catalog answer does - costs no listeners.
  function bindLibraryGrid(): void {
    root.querySelector('#ex-grid')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-slug]');
      if (state.librarySelect.active) {
        const slug = card?.dataset.slug;
        if (!slug) return;
        if (state.librarySelect.slugs.has(slug)) state.librarySelect.slugs.delete(slug);
        else state.librarySelect.slugs.add(slug);
        render();
        return;
      }
      const fav = target.closest<HTMLElement>('[data-fav]');
      if (fav) { void catalog.toggleFavourite(fav.dataset.fav || ''); return; }
      if (!card) return;
      const exercise = state.library.find((entry) => entry.slug === card.dataset.slug);
      if (exercise) catalog.openExerciseDetail(exercise, 'library');
    });
    root.querySelector('#lib-select-toggle')?.addEventListener('click', () => { state.librarySelect = { active: true, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-cancel')?.addEventListener('click', () => { state.librarySelect = { active: false, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-all')?.addEventListener('click', () => {
      const visible = exerciseResults('library', state).map((exercise) => exercise.slug);
      const allSelected = visible.length > 0 && visible.every((slug) => state.librarySelect.slugs.has(slug));
      state.librarySelect.slugs = allSelected ? new Set() : new Set(visible);
      render();
    });
    root.querySelector('#lib-delete-selected')?.addEventListener('click', () => { void catalog.deleteSelectedExercises(); });
  }

  function bindDiscoverGrid(): void {
    root.querySelector('#discover-grid')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-address]');
      if (!card) return;
      const exercise = state.discoverExercises.find((entry) => (entry.nostr_address || entry.slug) === card.dataset.address);
      if (!exercise) return;
      if (state.discoverSelect.active) {
        if (discoverImportState(exercise, state.library) === 'in-library') return;
        const address = exercise.nostr_address || exercise.slug;
        if (state.discoverSelect.addresses.has(address)) state.discoverSelect.addresses.delete(address);
        else state.discoverSelect.addresses.add(address);
        render();
        return;
      }
      const importButton = target.closest<HTMLButtonElement>('[data-import-address]');
      if (importButton) { void catalog.importDiscovered(exercise, importButton); return; }
      catalog.openExerciseDetail(exercise, 'discover');
    });
    root.querySelector('#discover-select-toggle')?.addEventListener('click', () => { state.discoverSelect = { active: true, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-cancel')?.addEventListener('click', () => { state.discoverSelect = { active: false, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-all')?.addEventListener('click', () => {
      const visible = exerciseResults('discover', state);
      const importable = discoverImportable(visible, state.library).map((exercise) => exercise.nostr_address || exercise.slug);
      const allSelected = importable.length > 0 && importable.every((address) => state.discoverSelect.addresses.has(address));
      state.discoverSelect.addresses = allSelected ? new Set() : new Set(importable);
      render();
    });
    root.querySelector('#discover-import-selected')?.addEventListener('click', () => { void catalog.importSelectedDiscovered(); });
  }
}
