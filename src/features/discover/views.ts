import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import { difficultyBadgeClass, displayPubkey, EX_PLACEHOLDER, exerciseFilterValues, fillSelectHtml, filterExercises, html } from '../../app/format';

export function exerciseAuthorPill(exercise: Exercise, state: AppState): string {
  const pubkey = exercise.nostr_pubkey || '';
  if (!pubkey) return '';
  const name = state.profileNames[pubkey] || displayPubkey(pubkey);
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  return `<span class="author-pill compact" title="${html(name)}"><span class="author-avatar-fallback">${html(initial)}</span><span>${html(name)}</span></span>`;
}

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
  if (importState === 'in-library') return `<button class="button ghost discover-import" data-import-address="${address}" disabled>In library</button>`;
  if (importState === 'update') return `<button class="button gold discover-import" data-import-address="${address}">Update</button>`;
  return `<button class="button primary discover-import" data-import-address="${address}">Import</button>`;
}

export function discoverCardHtml(exercise: Exercise, state: AppState): string {
  const src = exercise.image_url || '';
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${html(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const importState = discoverImportState(exercise, state.library);
  return `
    <div class="ex-card" data-address="${html(exercise.nostr_address || exercise.slug)}">
      <div class="card-img">
        ${img}
        <span class="source-badge badge-nostr">Workstr</span>
        ${exercise.difficulty ? `<span class="diff-badge ${difficultyBadgeClass(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${html(exercise.name)}</div>
        <div class="card-meta">
          ${exercise.muscle_group ? `<span class="muscle">${html(exercise.muscle_group)}</span>` : ''}
          ${exerciseAuthorPill(exercise, state)}
        </div>
        ${importButton(exercise, importState)}
      </div>
    </div>`;
}

export function discoverPanel(state: AppState): string {
  const filters = exerciseFilterValues(state.discoverExercises);
  const list = filterExercises(state.discoverExercises, state.discoverFilter.q, state.discoverFilter.cat, state.discoverFilter.muscle, state.discoverFilter.diff);
  return `<div class="panel">
    <div class="panel-head"><span>Discover exercises</span><button class="button ghost" id="discover-refresh">Refresh catalog</button></div>
    <p class="section-help">The official Workstr catalog, signed by the Workstr key and fetched from public relays. Importing an exercise copies it into your local library; when the catalog version is newer than your copy, an Update button appears.</p>
    <div class="filter-bar">
      <input class="grow" id="discover-search" placeholder="Search exercises..." autocomplete="off" value="${html(state.discoverFilter.q)}" />
      ${fillSelectHtml('discover-cat', filters.categories, 'All categories', state.discoverFilter.cat)}
      ${fillSelectHtml('discover-muscle', filters.muscles, 'All muscles', state.discoverFilter.muscle)}
      ${fillSelectHtml('discover-diff', filters.difficulties, 'All levels', state.discoverFilter.diff)}
    </div>
    <div id="discover-status" class="discover-status">${html(state.exerciseStatus)}</div>
    <div id="discover-grid" class="ex-grid">${list.map((exercise) => discoverCardHtml(exercise, state)).join('') || '<div class="empty">No exercises match.</div>'}</div>
  </div>`;
}
