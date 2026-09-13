import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import type { GridCard } from '../../app/card-grid';
import { html } from '../../app/format';
import { exerciseCard } from '../../app/exercise-card';
import { activeFacetCount, exerciseActiveFilters, exerciseQuery, exerciseResults, exerciseToolbar } from '../../app/exercise-browser';

export type DiscoverImportState = 'new' | 'in-library' | 'update';

// Identity of a remote item is its full nostr address, never the d-tag/slug
// alone. A local row still carrying the address is by definition unmodified
// (editing forks a row by clearing its nostr fields), so a newer remote
// created_at on the same address means an update is available.
export function discoverImportState(exercise: Exercise, library: Exercise[]): DiscoverImportState {
  const byAddress = exercise.nostr_address
    ? library.find((entry) => entry.nostr_address === exercise.nostr_address)
    : undefined;
  if (byAddress) {
    return (exercise.origin_created_at || 0) > (byAddress.origin_created_at || 0) ? 'update' : 'in-library';
  }
  return library.some((entry) => entry.slug === exercise.slug) ? 'in-library' : 'new';
}

function importButton(exercise: Exercise, importState: DiscoverImportState): string {
  const address = html(exercise.nostr_address || exercise.slug);
  if (importState === 'in-library') return `<button class="button discover-import" data-import-address="${address}" disabled>In library</button>`;
  if (importState === 'update') return `<button class="button primary discover-import" data-import-address="${address}">Update</button>`;
  return `<button class="button primary discover-import" data-import-address="${address}">Import</button>`;
}

export function discoverCardHtml(exercise: Exercise, state: AppState): string {
  const importState = discoverImportState(exercise, state.library);
  const sel = state.discoverSelect;
  // Only importable cards (new/update) take part in select mode.
  const selectable = sel.active && importState !== 'in-library';
  const selected = selectable && sel.addresses.has(exercise.nostr_address || exercise.slug);
  // No star: a catalog exercise is favorited after it is imported, never by a tap that imports it.
  return exerciseCard({
    exercise,
    keyAttribute: `data-address="${html(exercise.nostr_address || exercise.slug)}"`,
    classes: `${selected ? ' selected' : ''}${sel.active && !selectable ? ' unselectable' : ''}`,
    selectable,
    footer: importButton(exercise, importState)
  });
}

export function discoverImportable(list: Exercise[], library: Exercise[]): Exercise[] {
  return list.filter((exercise) => discoverImportState(exercise, library) !== 'in-library');
}

export function discoverPanel(state: AppState): string {
  const sel = state.discoverSelect;
  return `<div class="discover-exercise-panel">
    ${exerciseToolbar('discover', state)}
    ${exerciseActiveFilters('discover', state)}
    <div id="discover-status" class="discover-status">${html(state.exerciseStatus)}</div>
    <div id="discover-grid" class="ex-grid discover-exercise-grid${sel.active ? ' selecting' : ''}">${discoverGrid(state)}</div>
  </div>`;
}

// Separate from the panel because the grid is written on its own when the catalog answers:
// the cards are what changed, and the toolbar, the filters and the status line above them
// have not. Card clicks are delegated to `#discover-grid` itself, so replacing what is
// inside it costs no listeners.
export function discoverGrid(state: AppState): string {
  const list = exerciseResults('discover', state);
  const hasFilters = Boolean(exerciseQuery('discover', state) || activeFacetCount('discover', state));
  // The explanation of what importing does lives here rather than in a permanent paragraph:
  // it is what someone needs when the grid is empty, not on every visit.
  const empty = state.discoverExercises.length === 0 && !hasFilters
    ? 'The official Workstr catalog loads here. Importing an exercise copies it into your local library, which is what you edit and add to programs; updates appear when catalog versions are newer.'
    : 'No exercises match.';
  return list.map((exercise) => discoverCardHtml(exercise, state)).join('') || `<div class="empty">${empty}</div>`;
}

// The same cards the grid is made of, keyed the way the markup keys them, so a caller can
// write the ones that changed instead of all of them.
export function discoverCards(state: AppState): GridCard[] {
  return exerciseResults('discover', state).map((exercise) => ({
    key: exercise.nostr_address || exercise.slug,
    html: discoverCardHtml(exercise, state)
  }));
}

export function discoverEmptyText(state: AppState): string {
  const hasFilters = Boolean(exerciseQuery('discover', state) || activeFacetCount('discover', state));
  return state.discoverExercises.length === 0 && !hasFilters
    ? '<div class="empty">The official Workstr catalog loads here. Importing an exercise copies it into your local library, which is what you edit and add to programs; updates appear when catalog versions are newer.</div>'
    : '<div class="empty">No exercises match.</div>';
}
