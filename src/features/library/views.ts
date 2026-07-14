import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import { difficultyBadgeClass, EX_PLACEHOLDER, exerciseFilterValues, exerciseSourceLabel, fillSelectHtml, filterExercises, html } from '../../app/format';

export function libraryPanel(state: AppState): string {
  const filters = exerciseFilterValues(state.library);
  const list = filterExercises(state.library, state.filter, state.exFilter.cat, state.exFilter.muscle, state.exFilter.diff);
  const hasFilters = Boolean(state.filter || state.exFilter.cat || state.exFilter.muscle || state.exFilter.diff);
  const emptyText = state.library.length === 0 && !hasFilters
    ? 'Your exercise library is empty. Create an exercise manually or discover exercises from relays.'
    : 'No exercises match.';
  return `<div class="panel">
    <div class="panel-head"><span>Exercise library</span><span class="head-actions"><button class="button primary small" id="new-exercise">+ New exercise</button></span></div>
    <div class="filter-bar">
      <input class="grow" id="ex-search" placeholder="Search exercises..." autocomplete="off" value="${html(state.filter)}" />
      ${fillSelectHtml('ex-cat', filters.categories, 'All categories', state.exFilter.cat)}
      ${fillSelectHtml('ex-muscle', filters.muscles, 'All muscles', state.exFilter.muscle)}
      ${fillSelectHtml('ex-diff', filters.difficulties, 'All levels', state.exFilter.diff)}
    </div>
    <div id="ex-grid" class="ex-grid">${list.map(exerciseCardHtml).join('')}</div>
    <div id="ex-empty" class="empty" style="display:${list.length ? 'none' : 'block'}">${emptyText}</div>
  </div>`;
}

export function exerciseCardHtml(exercise: Exercise): string {
  const src = exercise.image_url || '';
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${html(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const source = exerciseSourceLabel(exercise);
  const sourceCls = source === 'ai' ? 'badge-ai' : source === 'nostr' ? 'badge-nostr' : 'badge-manual';
  return `
    <div class="ex-card" data-slug="${html(exercise.slug)}">
      <div class="card-img">
        ${img}
        <span class="source-badge ${sourceCls}">${html(source)}</span>
        ${exercise.nostr_event_id ? '<span class="published-badge" title="Shared on relays">shared</span>' : ''}
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
