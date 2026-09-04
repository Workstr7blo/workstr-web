import type { ProgramFilterKey } from '../features/sheets/program-browser';
import type { AppState } from './state';

export interface ProgramBrowserContext {
  root: HTMLElement;
  state: AppState;
  render(options?: { toTop?: boolean }): void;
}

const NO_FILTERS = { goal: '', focus: '', format: '', equipment: '' };

/**
 * Wiring for the Programs and Discover browsing chrome: the filter sheet, its options, the
 * active-filter chips, and Clear.
 *
 * Rebound after every render, like the rest of the shell's bindings. Every handler here
 * redraws, which destroys the element that was clicked, so anything that should still hold
 * focus afterwards is refocused by selector rather than by reference.
 */
export function bindProgramBrowser({ root, state, render }: ProgramBrowserContext): void {
  const setFilter = (key: ProgramFilterKey, value: string) => {
    state.programFilters ||= { ...NO_FILTERS };
    state.programFilters[key] = value;
  };

  const closeSheet = () => {
    const opener = state.programFilterSheet;
    state.programFilterSheet = null;
    render();
    root.querySelector<HTMLElement>(`[data-program-filter-open="${opener}"]`)?.focus();
  };

  root.querySelectorAll<HTMLElement>('[data-program-filter-open]').forEach((button) => button.addEventListener('click', () => {
    state.programFilterSheet = button.dataset.programFilterOpen as AppState['programFilterSheet'];
    render();
    root.querySelector<HTMLElement>('.program-filter-sheet .program-filter-option')?.focus();
  }));

  root.querySelectorAll<HTMLElement>('[data-program-filter-close]').forEach((backdrop) => backdrop.addEventListener('click', closeSheet));
  root.querySelector('#program-filter-apply')?.addEventListener('click', closeSheet);

  // Scoped to the sheet rather than the document: this function reruns on every render, and
  // a document listener added here would stack up one copy per redraw. Focus is moved into
  // the sheet on open and kept there, so the key still arrives.
  root.querySelector('.program-filter-sheet')?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') closeSheet();
  });

  root.querySelectorAll<HTMLElement>('[data-program-filter]').forEach((option) => option.addEventListener('click', () => {
    const key = option.dataset.programFilter as ProgramFilterKey;
    const value = option.dataset.programFilterValue || '';
    setFilter(key, value);
    render();
    // The sheet stays open, so put focus back on the option that was just chosen.
    root.querySelector<HTMLElement>(`[data-program-filter="${key}"][data-program-filter-value="${value}"]`)?.focus();
  }));

  root.querySelector('#program-filter-reset')?.addEventListener('click', () => {
    state.programFilters = { ...NO_FILTERS };
    render();
    root.querySelector<HTMLElement>('#program-filter-reset')?.focus();
  });

  root.querySelectorAll<HTMLElement>('[data-program-filter-remove]').forEach((chip) => chip.addEventListener('click', () => {
    setFilter(chip.dataset.programFilterRemove as ProgramFilterKey, '');
    render();
  }));

  // Clears the four advanced filters only. Text in the search field is the user's own
  // typing, is visible where they typed it, and is not one of the chips being cleared.
  root.querySelectorAll<HTMLElement>('[data-program-filter-clear]').forEach((button) => button.addEventListener('click', () => {
    state.programFilters = { ...NO_FILTERS };
    render();
  }));
}
