import type { Exercise } from '../../core/types';
import type { AppState } from '../../app/state';
import type { GridCard } from '../../app/card-grid';
import { html } from '../../app/format';
import { exerciseBrowseHero, exerciseCard } from '../../app/exercise-card';
import { icon } from '../../app/icons';
import { activeFacetCount, exerciseActiveFilters, exerciseFacets, exerciseQuery, exerciseResults, exerciseToolbar } from '../../app/exercise-browser';

export function libraryPanel(state: AppState): string {
  const sel = state.librarySelect;
  return `<div class="library-panel">
    ${libraryHero(state)}
    ${exerciseToolbar('library', state)}
    ${exerciseActiveFilters('library', state)}
    <div id="ex-grid" class="ex-grid exercise-library-grid${sel.active ? ' selecting' : ''}">${libraryGrid(state)}</div>
    <div id="ex-empty" class="empty" style="display:${exerciseResults('library', state).length ? 'none' : 'block'}">${libraryEmptyText(state)}</div>
  </div>`;
}

// Whole-library figures, not the filtered view: a filter change writes only the grid, so a
// count here that followed the filter would go stale under it. Favoriting renders the page.
function libraryHero(state: AppState): string {
  const total = state.library.length;
  const favourites = state.library.filter((exercise) => exercise.favourite).length;
  const muscles = new Set(state.library.map((exercise) => (exercise.muscle_group || '').trim()).filter(Boolean)).size;
  const stat = (name: 'dumbbell' | 'star' | 'target', value: number, one: string, many: string) => `<span>${icon(name)}<strong>${value}</strong> ${value === 1 ? one : many}</span>`;
  return exerciseBrowseHero('dumbbell', 'Exercise library', 'Your own copies: edit them, star favorites, add them to programs.',
    `${stat('dumbbell', total, 'exercise', 'exercises')}${stat('star', favourites, 'favorite', 'favorites')}${stat('target', muscles, 'muscle', 'muscles')}`);
}

// Separate from the panel because the cards are written on their own when a filter changes:
// the toolbar above them, and the search input in it, have not changed and must not be
// thrown away. Clicks are delegated to `#ex-grid` itself, so replacing what is inside it
// costs no listeners.
export function libraryGrid(state: AppState): string {
  return libraryCards(state).map((card) => card.html).join('');
}

// The same cards, keyed the way the markup keys them, so a caller can write the ones that
// changed instead of all of them.
export function libraryCards(state: AppState): GridCard[] {
  const sel = state.librarySelect;
  return exerciseResults('library', state).map((exercise) => ({
    key: exercise.slug,
    html: exerciseCardHtml(exercise, sel.active, sel.slugs.has(exercise.slug))
  }));
}

// An empty library and a filter that matches nothing are different situations and read
// differently: one offers the way to fill it, the other says the filter is the reason.
// Favorites gets its own pair, because "no exercises match" is wrong when the library is full
// and nothing has been starred yet.
export function libraryEmptyText(state: AppState): string {
  if (exerciseFacets('library', state).fav) {
    return state.library.some((exercise) => exercise.favourite)
      ? 'No favorite exercises match these filters.'
      : '<p>No favorite exercises yet.</p><p>Tap the star on an exercise to add it here.</p>';
  }
  const hasFilters = Boolean(exerciseQuery('library', state) || activeFacetCount('library', state));
  return state.library.length === 0 && !hasFilters
    ? '<p>Your library is empty. Add exercises from the Workstr catalog.</p><button class="button primary" data-parent="exercises" data-subtab="discover">Browse Discover</button>'
    : 'No exercises match.';
}

export function exerciseCardHtml(exercise: Exercise, selecting = false, selected = false): string {
  const label = exercise.favourite ? `Remove ${exercise.name} from favorites` : `Add ${exercise.name} to favorites`;
  const star = `<button class="fav ${exercise.favourite ? 'on' : ''}" type="button" data-fav="${html(exercise.slug)}" aria-pressed="${exercise.favourite}" aria-label="${html(label)}" title="${html(label)}">${icon('star', { class: 'fav-icon', filled: exercise.favourite })}</button>`;
  return exerciseCard({ exercise, keyAttribute: `data-slug="${html(exercise.slug)}"`, classes: selected ? ' selected' : '', selectable: selecting, nameAction: star });
}
