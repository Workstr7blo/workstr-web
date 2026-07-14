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

export function discoverCardHtml(exercise: Exercise, state: AppState): string {
  const src = exercise.image_url || '';
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${html(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const imported = state.library.some((entry) => entry.slug === exercise.slug || (entry.nostr_address && entry.nostr_address === exercise.nostr_address));
  return `
    <div class="ex-card" data-address="${html(exercise.nostr_address || exercise.slug)}">
      <div class="card-img">
        ${img}
        <span class="source-badge badge-nostr">NIP-101e</span>
        ${exercise.difficulty ? `<span class="diff-badge ${difficultyBadgeClass(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${html(exercise.name)}</div>
        <div class="card-meta">
          ${exercise.muscle_group ? `<span class="muscle">${html(exercise.muscle_group)}</span>` : ''}
          ${exerciseAuthorPill(exercise, state)}
        </div>
        <button class="button ${imported ? 'ghost' : 'primary'} discover-import" data-import-address="${html(exercise.nostr_address || exercise.slug)}"${imported ? ' disabled' : ''}>${imported ? 'In library' : 'Import'}</button>
      </div>
    </div>`;
}

export function discoverPanel(state: AppState): string {
  const filters = exerciseFilterValues(state.discoverExercises);
  const list = filterExercises(state.discoverExercises, state.discoverFilter.q, state.discoverFilter.cat, state.discoverFilter.muscle, state.discoverFilter.diff);
  return `<div class="panel">
    <div class="panel-head"><span>Discover exercises</span><button class="button ghost" id="discover-refresh">Search relays</button></div>
    <p class="section-help">Browse exercises shared on your relays. Importing an exercise saves it into your local library so it can be used in programs and workouts.</p>
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
