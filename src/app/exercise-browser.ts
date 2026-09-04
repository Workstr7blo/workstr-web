import type { Exercise } from '../core/types';
import type { AppState } from './state';
import { equipmentLabel, MY_EQUIPMENT, ownedEquipmentKeys } from '../core/equipment';
import { exerciseFilterValues, filterExercises, html } from './format';

/**
 * The Library and Discover browsing chrome: the compact toolbar, the active-facet chips,
 * the filter sheet, and the selection bar.
 *
 * The two views deliberately do not share filter state — Library keeps its search in
 * `state.filter` and its facets in `state.exFilter`, Discover keeps both in
 * `state.discoverFilter`. Everything here is therefore parameterised by view rather than
 * reading one global, and `state.exerciseFilterSheet` only records which view has the
 * sheet open.
 */

export type ExerciseView = 'library' | 'discover';
export type ExerciseFacet = 'cat' | 'muscle' | 'diff' | 'equip';

export interface ExerciseFacets {
  cat: string;
  muscle: string;
  diff: string;
  equip: string;
}

const NO_FACETS: ExerciseFacets = { cat: '', muscle: '', diff: '', equip: '' };

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v5h-5"/>'
};

function icon(name: keyof typeof ICONS, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

export function exerciseSource(view: ExerciseView, state: AppState): Exercise[] {
  return view === 'discover' ? state.discoverExercises : state.library;
}

/**
 * Picks the four facets by name rather than spreading the slice: `discoverFilter` also
 * carries the view's search text in `q`, and spreading it would count typing as a filter,
 * inflating the badge and letting Reset wipe what the user typed.
 */
export function exerciseFacets(view: ExerciseView, state: AppState): ExerciseFacets {
  const source = (view === 'discover' ? state.discoverFilter : state.exFilter) || NO_FACETS;
  return { cat: source.cat || '', muscle: source.muscle || '', diff: source.diff || '', equip: source.equip || '' };
}

export function exerciseQuery(view: ExerciseView, state: AppState): string {
  return (view === 'discover' ? state.discoverFilter?.q : state.filter) || '';
}

export function activeFacetCount(view: ExerciseView, state: AppState): number {
  return Object.values(exerciseFacets(view, state)).filter(Boolean).length;
}

/**
 * The one call that produces a view's visible list. The sheet's "Show N" count and the grid
 * both go through it, so the number and the grid cannot disagree.
 */
export function exerciseResults(view: ExerciseView, state: AppState): Exercise[] {
  return filterExercises(exerciseSource(view, state), {
    ...exerciseFacets(view, state),
    q: exerciseQuery(view, state),
    ownedEquipment: ownedEquipmentKeys(state.settings.ownedEquipment)
  });
}

const FACET_LABELS: Record<ExerciseFacet, string> = {
  cat: 'Category', muscle: 'Muscle', diff: 'Level', equip: 'Equipment'
};

export function facetValueLabel(facet: ExerciseFacet, value: string): string {
  if (facet !== 'equip') return value;
  return value === MY_EQUIPMENT ? 'My equipment' : equipmentLabel(value);
}

/**
 * Groups are derived from the exercises actually loaded, so Library and Discover offer
 * different option sets and both grow with the catalog.
 *
 * A selected value can outlive its option — delete the last kettlebell exercise and the
 * grid is still filtering on a value nothing offers, which reads as an empty grid for no
 * reason. Orphans are kept in the list so the filter stays visible and undoable, which is
 * the same rule the select this replaced followed.
 */
interface FacetOption { value: string; label: string }

function facetGroups(view: ExerciseView, state: AppState): { facet: ExerciseFacet; label: string; anyLabel: string; options: FacetOption[] }[] {
  const values = exerciseFilterValues(exerciseSource(view, state));
  const owned = ownedEquipmentKeys(state.settings.ownedEquipment);
  const current = exerciseFacets(view, state);
  // Equipment carries its own curated label from `equipmentOptions`; the other three are
  // the stored values themselves, shown as they are stored.
  const equipment: FacetOption[] = [
    ...(owned.length ? [{ value: MY_EQUIPMENT, label: 'My equipment' }] : []),
    ...values.equipment.map((item) => ({ value: item.key, label: item.label }))
  ];
  const plain = (list: string[]): FacetOption[] => list.map((value) => ({ value, label: value }));
  const withOrphan = (facet: ExerciseFacet, options: FacetOption[]): FacetOption[] =>
    current[facet] && !options.some((option) => option.value === current[facet])
      ? [...options, { value: current[facet], label: facetValueLabel(facet, current[facet]) }]
      : options;
  return [
    { facet: 'cat', label: FACET_LABELS.cat, anyLabel: 'All categories', options: withOrphan('cat', plain(values.categories)) },
    { facet: 'muscle', label: FACET_LABELS.muscle, anyLabel: 'All muscles', options: withOrphan('muscle', plain(values.muscles)) },
    { facet: 'diff', label: FACET_LABELS.diff, anyLabel: 'All levels', options: withOrphan('diff', plain(values.difficulties)) },
    { facet: 'equip', label: FACET_LABELS.equip, anyLabel: 'All equipment', options: withOrphan('equip', equipment) }
  ];
}

/**
 * Search, filter, and the view's own actions on one row. Both views keep the input ids the
 * shell already binds.
 */
export function exerciseToolbar(view: ExerciseView, state: AppState): string {
  const discover = view === 'discover';
  const inputId = discover ? 'discover-search' : 'ex-search';
  const count = activeFacetCount(view, state);
  const badge = count ? `<span class="program-filter-count" aria-hidden="true">${count}</span>` : '';
  const filterLabel = count ? `Filter exercises, ${count} filter${count === 1 ? '' : 's'} active` : 'Filter exercises';
  const selecting = discover ? state.discoverSelect.active : state.librarySelect.active;
  const selectable = discover
    ? discoverImportableCount(state) > 0
    : state.library.length > 0;
  const refresh = discover
    ? `<button class="program-toolbar-action" id="discover-refresh" type="button" aria-label="Refresh the Workstr catalog" title="Refresh catalog">${icon('refresh')}<span class="program-toolbar-action-text">Refresh</span></button>`
    : '';
  const selectId = discover ? 'discover-select-toggle' : 'lib-select-toggle';
  return `<div class="program-toolbar">
    <div class="program-search-wrap">
      ${icon('search', 'program-search-icon')}
      <input class="program-search" id="${inputId}" type="search" placeholder="Search exercises..." aria-label="Search exercises" autocomplete="off" value="${html(exerciseQuery(view, state))}" />
    </div>
    <button class="program-toolbar-action program-filter-toggle ${count ? 'on' : ''}" type="button" data-exercise-filter-open="${view}" aria-label="${html(filterLabel)}" aria-haspopup="dialog" aria-expanded="${state.exerciseFilterSheet === view}" title="Filter exercises">${icon('sliders')}${badge}</button>
    ${refresh}
    <button class="program-toolbar-action program-filter-toggle ${selecting ? 'on' : ''}" id="${selectId}" type="button" aria-label="Select exercises" aria-pressed="${selecting}" title="Select"${selectable ? '' : ' disabled'}>${icon('select')}</button>
  </div>`;
}

export function discoverImportableCount(state: AppState): number {
  const owned = new Set(state.library.map((exercise) => exercise.nostr_address || exercise.slug));
  return state.discoverExercises.filter((exercise) => !owned.has(exercise.nostr_address || exercise.slug)).length;
}

export function exerciseActiveFilters(view: ExerciseView, state: AppState): string {
  const facets = exerciseFacets(view, state);
  const chips = (Object.keys(FACET_LABELS) as ExerciseFacet[])
    .filter((facet) => facets[facet])
    .map((facet) => `<button class="program-filter-chip" type="button" data-exercise-filter-remove="${facet}" data-exercise-view="${view}" aria-label="Remove ${html(FACET_LABELS[facet].toLowerCase())} filter ${html(facetValueLabel(facet, facets[facet]))}"><span>${html(facetValueLabel(facet, facets[facet]))}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`)
    .join('');
  if (!chips) return '';
  return `<div class="program-active-filters">${chips}<button class="program-filter-clear" type="button" data-exercise-filter-clear="${view}">Clear</button></div>`;
}

export function exerciseFilterSheet(state: AppState): string {
  const view = state.exerciseFilterSheet;
  if (!view) return '';
  const facets = exerciseFacets(view, state);
  const matches = exerciseResults(view, state).length;
  const noun = matches === 1 ? 'exercise' : 'exercises';
  const groups = facetGroups(view, state).map((group) => {
    const option = (value: string, label: string) =>
      `<button class="program-filter-option ${facets[group.facet] === value ? 'active' : ''}" type="button" data-exercise-filter="${group.facet}" data-exercise-filter-value="${html(value)}" aria-pressed="${facets[group.facet] === value}">${html(label)}</button>`;
    return `<div class="program-filter-group">
      <h3 class="program-filter-group-title" id="exercise-filter-group-${group.facet}">${html(group.label)}</h3>
      <div class="program-filter-options" role="group" aria-labelledby="exercise-filter-group-${group.facet}">
        ${option('', group.anyLabel)}${group.options.map((item) => option(item.value, item.label)).join('')}
      </div>
    </div>`;
  }).join('');
  return `<div class="program-filter-backdrop" data-exercise-filter-close="1"></div>
  <div class="program-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="exercise-filter-title">
    <div class="program-filter-sheet-handle" aria-hidden="true"></div>
    <div class="program-filter-sheet-header"><h2 id="exercise-filter-title">Filter ${view === 'discover' ? 'the catalog' : 'your library'}</h2></div>
    <div class="program-filter-sheet-body">${groups}</div>
    <div class="program-filter-sheet-footer">
      <button class="button quiet" id="exercise-filter-reset" type="button">Reset filters</button>
      <button class="button primary" id="exercise-filter-apply" type="button">Show ${matches} ${noun}</button>
    </div>
  </div>`;
}

/**
 * Selection actions in a bar that slides up from the bottom, clearing the mobile nav. The
 * toolbar above stays put, so search still works while picking things.
 */
export function exerciseSelectionBar(state: AppState): string {
  const library = state.librarySelect.active;
  const discover = state.discoverSelect.active;
  const view: ExerciseView | null = library ? 'library' : discover ? 'discover' : null;
  if (!view) return '';
  const list = exerciseResults(view, state);
  if (view === 'library') {
    const chosen = state.librarySelect.slugs;
    const allSelected = list.length > 0 && list.every((exercise) => chosen.has(exercise.slug));
    return `<div class="bulk-bar open" role="group" aria-label="Selected exercises">
      <button class="button small" id="lib-select-all" type="button">${allSelected ? 'Clear all' : 'Select all'}</button>
      <button class="button quiet small" id="lib-delete-selected" type="button"${chosen.size ? '' : ' disabled'}>Delete (${chosen.size})</button>
      <button class="button small" id="lib-select-cancel" type="button">Done</button>
    </div>`;
  }
  const owned = new Set(state.library.map((exercise) => exercise.nostr_address || exercise.slug));
  const importable = list.filter((exercise) => !owned.has(exercise.nostr_address || exercise.slug));
  const chosen = state.discoverSelect.addresses;
  const allSelected = importable.length > 0 && importable.every((exercise) => chosen.has(exercise.nostr_address || exercise.slug));
  return `<div class="bulk-bar open" role="group" aria-label="Selected exercises">
    <button class="button small" id="discover-select-all" type="button">${allSelected ? 'Clear all' : 'Select all'}</button>
    <button class="button primary small" id="discover-import-selected" type="button"${chosen.size ? '' : ' disabled'}>Import (${chosen.size})</button>
    <button class="button small" id="discover-select-cancel" type="button">Done</button>
  </div>`;
}
