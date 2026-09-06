import { libraryEmptyText, libraryGrid } from '../features/library/views';
import { programFilterMatches, programMatchLabel, programFilterValues, type ProgramBrowser, type ProgramFilterKey } from '../features/sheets/program-browser';
import { updateDiscoverExercises } from './catalog-surfaces';
import { exerciseFacets, exerciseMatchLabel, exerciseResults, type ExerciseFacet, type ExerciseView } from './exercise-browser';
import { programListMarkup } from './layout';
import type { AppState } from './state';

// What a filter actually changes is the result of that filter: a grid of cards, a list of
// programs, the line that says nothing matched, the count on the sheet's apply button.
// Typing used to redraw the application for each of those keystrokes and then hunt down the
// input it had just destroyed to put the caret back. These write the regions instead, which
// is why no caret has to be restored - the input is never touched.
//
// Each returns nothing and does nothing when its surface is not mounted: the caller is a
// handler on that surface, so in practice it always is, and a missing node means the page
// moved on and the next page render will draw whatever is current.

export function renderExerciseResults(root: ParentNode, state: AppState, view: ExerciseView): void {
  if (view === 'discover') updateDiscoverExercises(root, state);
  else updateLibraryExercises(root, state);
  updateExerciseSelectionBar(root, state, view);
}

export function updateLibraryExercises(root: ParentNode, state: AppState): void {
  const grid = root.querySelector('#ex-grid');
  if (!grid) return;
  grid.innerHTML = libraryGrid(state);
  grid.classList.toggle('selecting', state.librarySelect.active);
  const empty = root.querySelector<HTMLElement>('#ex-empty');
  if (!empty) return;
  // Always in the DOM and toggled by display, so it is a node to write rather than one to
  // create - and the wording differs between an empty library and a filter matching none.
  empty.innerHTML = libraryEmptyText(state);
  empty.style.display = exerciseResults('library', state).length ? 'none' : 'block';
}

export function renderProgramResults(root: ParentNode, state: AppState, context: ProgramBrowser): void {
  const list = root.querySelector(context === 'discover' ? '#program-discover-list' : '#programs-list');
  if (!list) return;
  list.innerHTML = programListMarkup(context, state);
}

/**
 * Three things on the bar move: whether everything visible is selected, how many are, and
 * whether the action is available. The bar is patched rather than rendered again so its
 * buttons keep their listeners and it does not flicker under a finger that is still typing.
 * Whether the bar exists at all is a page render's business - it opens and closes with
 * selection mode, not with a filter.
 */
function updateExerciseSelectionBar(root: ParentNode, state: AppState, view: ExerciseView): void {
  const selecting = view === 'discover' ? state.discoverSelect.active : state.librarySelect.active;
  const selectAll = root.querySelector(view === 'discover' ? '#discover-select-all' : '#lib-select-all');
  if (!selecting || !selectAll) return;
  const visible = exerciseResults(view, state);
  const discover = view === 'discover';
  const allSelected = discover
    ? discoverAllSelected(visible, state)
    : visible.length > 0 && visible.every((exercise) => state.librarySelect.slugs.has(exercise.slug));
  selectAll.textContent = allSelected ? 'Clear all' : 'Select all';
  const chosen = discover ? state.discoverSelect.addresses.size : state.librarySelect.slugs.size;
  const action = root.querySelector<HTMLButtonElement>(discover ? '#discover-import-selected' : '#lib-delete-selected');
  if (!action) return;
  action.textContent = `${discover ? 'Import' : 'Delete'} (${chosen})`;
  action.disabled = chosen === 0;
}

function discoverAllSelected(visible: ReturnType<typeof exerciseResults>, state: AppState): boolean {
  const owned = new Set(state.library.map((exercise) => exercise.nostr_address || exercise.slug));
  const importable = visible.filter((exercise) => !owned.has(exercise.nostr_address || exercise.slug));
  return importable.length > 0 && importable.every((exercise) => state.discoverSelect.addresses.has(exercise.nostr_address || exercise.slug));
}

/**
 * The sheets are patched, not rendered again, for the same reason the search input is left
 * alone: the option that was tapped is the focused element, and rebuilding the sheet moved
 * focus to the document and made the next arrow key do nothing. Everything that changes on
 * a facet tap is a class, an aria state and the count on the apply button.
 */
export function updateExerciseFilterSheet(root: ParentNode, state: AppState): void {
  const view = state.exerciseFilterSheet;
  if (!view) return;
  const facets = exerciseFacets(view, state);
  root.querySelectorAll<HTMLElement>('.program-filter-sheet [data-exercise-filter]').forEach((option) => {
    const facet = option.dataset.exerciseFilter as ExerciseFacet;
    const active = facets[facet] === (option.dataset.exerciseFilterValue || '');
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
  const apply = root.querySelector('#exercise-filter-apply');
  if (apply) apply.textContent = exerciseMatchLabel(exerciseResults(view, state).length);
}

export function updateProgramFilterSheet(root: ParentNode, state: AppState): void {
  const context = state.programFilterSheet;
  if (!context) return;
  const filter = programFilterValues(state);
  root.querySelectorAll<HTMLElement>('.program-filter-sheet [data-program-filter]').forEach((option) => {
    const key = option.dataset.programFilter as ProgramFilterKey;
    const active = filter[key] === (option.dataset.programFilterValue || '');
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
  const apply = root.querySelector('#program-filter-apply');
  if (apply) apply.textContent = programMatchLabel(programFilterMatches(context, state));
}
