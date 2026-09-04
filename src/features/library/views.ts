import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import { difficultyBadgeClass, EX_PLACEHOLDER, exerciseSourceLabel, html } from '../../app/format';
import { activeFacetCount, exerciseActiveFilters, exerciseQuery, exerciseResults, exerciseToolbar } from '../../app/exercise-browser';

export function libraryPanel(state: AppState): string {
  const list = exerciseResults('library', state);
  const sel = state.librarySelect;
  const hasFilters = Boolean(exerciseQuery('library', state) || activeFacetCount('library', state));
  const emptyText = state.library.length === 0 && !hasFilters
    ? '<p>Your library is empty. Add exercises from the Workstr catalog.</p><button class="button primary" data-parent="exercises" data-subtab="discover">Browse Discover</button>'
    : 'No exercises match.';
  return `<div class="library-panel">
    ${exerciseToolbar('library', state)}
    ${exerciseActiveFilters('library', state)}
    <div id="ex-grid" class="ex-grid exercise-library-grid${sel.active ? ' selecting' : ''}">${list.map((exercise) => exerciseCardHtml(exercise, sel.active, sel.slugs.has(exercise.slug))).join('')}</div>
    <div id="ex-empty" class="empty" style="display:${list.length ? 'none' : 'block'}">${emptyText}</div>
  </div>`;
}

export function exerciseCardHtml(exercise: Exercise, selecting = false, selected = false): string {
  const src = exercise.image_url || '';
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${html(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const source = exerciseSourceLabel(exercise);
  const sourceCls = source === 'ai' ? 'badge-ai' : source === 'Workstr' ? 'badge-nostr' : 'badge-manual';
  return `
    <div class="ex-card${selected ? ' selected' : ''}" data-slug="${html(exercise.slug)}">
      <div class="card-img">
        ${img}
        ${selecting ? '<span class="sel-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        <span class="source-badge ${sourceCls}">${html(source)}</span>
        ${exercise.difficulty ? `<span class="diff-badge ${difficultyBadgeClass(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${html(exercise.name)}<button class="fav ${exercise.favourite ? 'on' : ''}" data-fav="${html(exercise.slug)}" title="Favourite">${exercise.favourite ? '★' : '☆'}</button></div>
        <div class="card-meta">
          ${exercise.muscle_group ? `<span class="muscle">${html(exercise.muscle_group)}</span>` : ''}
          ${exercise.category ? `<span class="card-tag">${html(exercise.category)}</span>` : ''}
        </div>
      </div>
    </div>`;
}
