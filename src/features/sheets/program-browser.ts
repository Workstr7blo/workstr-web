import type { AppState } from '../../app/state';
import type { Exercise } from '../../core/types';
import type { RelayProgram } from '../../nostr/canon';
import { html } from '../../app/format';
import { sheetToProgram } from './views';
import {
  PROGRAM_EQUIPMENT_LABELS,
  PROGRAM_FOCUS_LABELS,
  PROGRAM_FORMAT_LABELS,
  PROGRAM_GOALS,
  programSearchTags
} from './program-labels';

/**
 * The Programs and Discover browsing chrome: the compact toolbar, the active-filter chips,
 * and the filter sheet behind them.
 *
 * Both lists are filtered by one predicate built here. The sheet's "Show N" count and the
 * list it is counting have to agree, and the only way to guarantee that is for both to call
 * the same function — a second copy of the matching rules would drift the first time either
 * side changed.
 */

export type ProgramFilterKey = 'goal' | 'focus' | 'format' | 'equipment';
export type ProgramBrowser = 'programs' | 'discover';

type ProgramFilters = Record<ProgramFilterKey, string>;
type MatchableProgram = Pick<RelayProgram, 'name' | 'description' | 'exercises'> & {
  difficulty?: string;
  tags: string[];
  blocks?: RelayProgram['blocks'];
};

const NO_FILTERS: ProgramFilters = { goal: '', focus: '', format: '', equipment: '' };

// Order is the order the groups appear in the sheet and the chips in the row.
const FILTER_GROUPS: { key: ProgramFilterKey; label: string; values: string[] }[] = [
  { key: 'goal', label: 'Goal', values: PROGRAM_GOALS },
  { key: 'focus', label: 'Focus', values: PROGRAM_FOCUS_LABELS },
  { key: 'format', label: 'Format', values: PROGRAM_FORMAT_LABELS },
  { key: 'equipment', label: 'Equipment', values: PROGRAM_EQUIPMENT_LABELS }
];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v5h-5"/>'
};

function icon(name: keyof typeof ICONS, cls = ''): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

export function programFilterValues(state: AppState): ProgramFilters {
  return { ...NO_FILTERS, ...(state.programFilters || {}) };
}

/**
 * Free-text search is deliberately not counted. It is already visible in the field it was
 * typed into, so counting it would make the badge disagree with what the sheet can reset.
 */
export function activeProgramFilterCount(state: AppState): number {
  return Object.values(programFilterValues(state)).filter(Boolean).length;
}

export function programFilterLabel(value: string): string {
  if (value === 'emom') return 'EMOM';
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function programMatcher(state: AppState): (program: MatchableProgram) => boolean {
  const query = state.programFilter.toLowerCase();
  const filter = programFilterValues(state);
  return (program) => {
    const labels = programSearchTags(program as RelayProgram, state.exercises as Exercise[]);
    return [program.name, program.description, program.difficulty || '', ...labels].join(' ').toLowerCase().includes(query)
      && (!filter.goal || labels.includes(filter.goal))
      && (!filter.focus || labels.includes(filter.focus))
      && (!filter.format || labels.includes(filter.format))
      && (!filter.equipment || labels.includes(filter.equipment));
  };
}

/**
 * Search, filter, and one context action on a single row. Programs creates a program;
 * Discover refetches the relay cache. The trailing action is the only difference between
 * the two, so they share everything else.
 */
export function programToolbar(context: ProgramBrowser, state: AppState): string {
  const discover = context === 'discover';
  const inputId = discover ? 'program-discover-filter' : 'program-filter';
  const placeholder = discover ? 'Search relay programs...' : 'Search programs...';
  const count = activeProgramFilterCount(state);
  const badge = count ? `<span class="program-filter-count" aria-hidden="true">${count}</span>` : '';
  const filterLabel = count
    ? `Filter programs, ${count} filter${count === 1 ? '' : 's'} active`
    : 'Filter programs';
  const action = discover
    ? `<button class="program-toolbar-action" id="program-discover-refresh" type="button" aria-label="Refresh relay programs" title="Refresh">${icon('refresh')}<span class="program-toolbar-action-text">Refresh</span></button>`
    : `<button class="program-toolbar-action accent" id="new-program" type="button" aria-label="Create new program" title="New program">${icon('plus')}<span class="program-toolbar-action-text">New program</span></button>`;
  return `<div class="program-toolbar">
    <div class="program-search-wrap">
      ${icon('search', 'program-search-icon')}
      <input class="program-search" id="${inputId}" type="search" placeholder="${html(placeholder)}" aria-label="${html(placeholder)}" autocomplete="off" value="${html(state.programFilter)}" />
    </div>
    <button class="program-toolbar-action program-filter-toggle ${count ? 'on' : ''}" type="button" data-program-filter-open="${context}" aria-label="${html(filterLabel)}" aria-haspopup="dialog" aria-expanded="${state.programFilterSheet === context}" title="Filter programs">${icon('sliders')}${badge}</button>
    ${action}
  </div>`;
}

/**
 * Rendered only when something is active — an always-present empty row would give back the
 * vertical space this redesign is reclaiming.
 */
export function programActiveFilters(context: ProgramBrowser, state: AppState): string {
  const filter = programFilterValues(state);
  const chips = FILTER_GROUPS
    .filter((group) => filter[group.key])
    .map((group) => `<button class="program-filter-chip" type="button" data-program-filter-remove="${group.key}" data-program-filter-context="${context}" aria-label="Remove ${html(group.label.toLowerCase())} filter ${html(programFilterLabel(filter[group.key]))}"><span>${html(programFilterLabel(filter[group.key]))}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`)
    .join('');
  if (!chips) return '';
  return `<div class="program-active-filters">${chips}<button class="program-filter-clear" type="button" data-program-filter-clear="${context}">Clear</button></div>`;
}

function filterGroup(group: { key: ProgramFilterKey; label: string; values: string[] }, current: string): string {
  const option = (value: string, label: string) =>
    `<button class="program-filter-option ${current === value ? 'active' : ''}" type="button" data-program-filter="${group.key}" data-program-filter-value="${html(value)}" aria-pressed="${current === value}">${html(label)}</button>`;
  return `<div class="program-filter-group">
    <h3 class="program-filter-group-title" id="program-filter-group-${group.key}">${html(group.label)}</h3>
    <div class="program-filter-options" role="group" aria-labelledby="program-filter-group-${group.key}">
      ${option('', 'Any')}${group.values.map((value) => option(value, programFilterLabel(value))).join('')}
    </div>
  </div>`;
}

/**
 * One sheet serves both browsers. They share `state.programFilters`, so a second copy would
 * only be a second thing to keep in sync; `state.programFilterSheet` carries which list the
 * count at the bottom is counting.
 *
 * Rendered outside `.content`, next to the modal, because `.content` is a fixed positioned
 * stacking context at z-index 1 — a sheet inside it cannot paint over the bottom nav no
 * matter what z-index it is given, and the nav swallowed the footer's clicks.
 */
export function programFilterSheet(state: AppState): string {
  const context = state.programFilterSheet;
  if (!context) return '';
  const filter = programFilterValues(state);
  const match = programMatcher(state);
  const matches = context === 'discover'
    ? state.programs.filter(match).length
    : state.sheets.map(sheetToProgram).filter(match).length;
  const noun = matches === 1 ? 'program' : 'programs';
  return `<div class="program-filter-backdrop" data-program-filter-close="1"></div>
  <div class="program-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="program-filter-title">
    <div class="program-filter-sheet-handle" aria-hidden="true"></div>
    <div class="program-filter-sheet-header"><h2 id="program-filter-title">Filter ${context === 'discover' ? 'relay programs' : 'programs'}</h2></div>
    <div class="program-filter-sheet-body">
      ${FILTER_GROUPS.map((group) => filterGroup(group, filter[group.key])).join('')}
    </div>
    <div class="program-filter-sheet-footer">
      <button class="button quiet" id="program-filter-reset" type="button">Reset filters</button>
      <button class="button primary" id="program-filter-apply" type="button">Show ${matches} ${noun}</button>
    </div>
  </div>`;
}
