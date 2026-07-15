import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import { difficultyBadgeClass, EX_PLACEHOLDER, exerciseFilterValues, exerciseSourceLabel, fillSelectHtml, filterExercises, html } from '../../app/format';

export function libraryPanel(state: AppState): string {
  const filters = exerciseFilterValues(state.library);
  const list = filterExercises(state.library, state.filter, state.exFilter.cat, state.exFilter.muscle, state.exFilter.diff);
  const hasFilters = Boolean(state.filter || state.exFilter.cat || state.exFilter.muscle || state.exFilter.diff);
  const emptyText = state.library.length === 0 && !hasFilters
    ? '<p>Your library is empty. Add exercises from the Workstr catalog.</p><button class="button primary" data-parent="exercises" data-subtab="discover">Browse Discover</button>'
    : 'No exercises match.';
  const sel = state.librarySelect;
  const allVisibleSelected = list.length > 0 && list.every((exercise) => sel.slugs.has(exercise.slug));
  const headActions = sel.active
    ? `<span class="head-actions">
        <button class="button ghost small" id="lib-select-all">${allVisibleSelected ? 'Clear all' : 'Select all'}</button>
        <button class="button danger small" id="lib-delete-selected"${sel.slugs.size ? '' : ' disabled'}>Delete (${sel.slugs.size})</button>
        <button class="button small" id="lib-select-cancel">Done</button>
      </span>`
    : `<span class="head-actions">
        <button class="button ghost small" id="lib-select-toggle"${state.library.length ? '' : ' disabled'}>Select</button>
      </span>`;
  return `<div class="panel">
    <div class="panel-head"><span>Exercise library</span>${headActions}</div>
    <div class="filter-bar">
      <input class="grow" id="ex-search" placeholder="Search exercises..." autocomplete="off" value="${html(state.filter)}" />
      ${fillSelectHtml('ex-cat', filters.categories, 'All categories', state.exFilter.cat)}
      ${fillSelectHtml('ex-muscle', filters.muscles, 'All muscles', state.exFilter.muscle)}
      ${fillSelectHtml('ex-diff', filters.difficulties, 'All levels', state.exFilter.diff)}
    </div>
    <div id="ex-grid" class="ex-grid${sel.active ? ' selecting' : ''}">${list.map((exercise) => exerciseCardHtml(exercise, sel.active, sel.slugs.has(exercise.slug))).join('')}</div>
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
