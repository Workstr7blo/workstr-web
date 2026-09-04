import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import { authorPill, difficultyBadgeClass, EX_PLACEHOLDER, html } from '../../app/format';
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
  const src = exercise.image_url || '';
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${html(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const importState = discoverImportState(exercise, state.library);
  const sel = state.discoverSelect;
  // Only importable cards (new/update) take part in select mode.
  const selectable = sel.active && importState !== 'in-library';
  const selected = selectable && sel.addresses.has(exercise.nostr_address || exercise.slug);
  const author = exercise.nostr_pubkey ? authorPill(state.authorProfiles?.[exercise.nostr_pubkey], exercise.nostr_pubkey, { compact: true }) : '';
  return `
    <div class="ex-card${selected ? ' selected' : ''}${sel.active && !selectable ? ' unselectable' : ''}" data-address="${html(exercise.nostr_address || exercise.slug)}">
      <div class="card-img">
        ${img}
        ${selectable ? '<span class="sel-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        <span class="source-badge badge-nostr">Workstr</span>
        ${exercise.difficulty ? `<span class="diff-badge ${difficultyBadgeClass(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${html(exercise.name)}</div>
        <div class="card-meta discover-card-meta">
          ${exercise.muscle_group ? `<span class="muscle">${html(exercise.muscle_group)}</span>` : ''}
          ${author}
        </div>
        ${importButton(exercise, importState)}
      </div>
    </div>`;
}

export function discoverImportable(list: Exercise[], library: Exercise[]): Exercise[] {
  return list.filter((exercise) => discoverImportState(exercise, library) !== 'in-library');
}

export function discoverPanel(state: AppState): string {
  const list = exerciseResults('discover', state);
  const sel = state.discoverSelect;
  const hasFilters = Boolean(exerciseQuery('discover', state) || activeFacetCount('discover', state));
  // The explanation of what importing does moved here from a permanent paragraph: it is
  // what someone needs when the grid is empty, not on every visit.
  const empty = state.discoverExercises.length === 0 && !hasFilters
    ? 'The official Workstr catalog loads here. Importing an exercise copies it into your local library, which is what you edit and add to programs; updates appear when catalog versions are newer.'
    : 'No exercises match.';
  return `<div class="discover-exercise-panel">
    ${exerciseToolbar('discover', state)}
    ${exerciseActiveFilters('discover', state)}
    <div id="discover-status" class="discover-status">${html(state.exerciseStatus)}</div>
    <div id="discover-grid" class="ex-grid discover-exercise-grid${sel.active ? ' selecting' : ''}">${list.map((exercise) => discoverCardHtml(exercise, state)).join('') || `<div class="empty">${empty}</div>`}</div>
  </div>`;
}
