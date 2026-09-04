import type { ExerciseFacet, ExerciseView } from './exercise-browser';
import type { AppState } from './state';

export interface ExerciseBrowserContext {
  root: HTMLElement;
  state: AppState;
  render(options?: { toTop?: boolean }): void;
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
export function bindExerciseBrowser({ root, state, render }: ExerciseBrowserContext): void {
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
}
