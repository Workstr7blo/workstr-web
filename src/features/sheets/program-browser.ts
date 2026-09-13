import type { AppState } from '../../app/state';
import { EQUIPMENT_KEYS, kitCoversEquipment, MY_EQUIPMENT, ownedEquipmentKeys } from '../../core/equipment';
import { formatTaxonomyLabel, TRAINING_LEVELS } from '../../core/training-taxonomy';
import type { Exercise } from '../../core/types';
import type { RelayProgram } from '../../nostr/canon';
import { html } from '../../app/format';
import { sheetToProgram } from './views';
import {
  PROGRAM_FOCUS_LABELS,
  PROGRAM_FORMAT_LABELS,
  PROGRAM_GOALS,
  programSearchTags,
  programTaxonomy
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

export type ProgramFilterKey = 'goal' | 'focus' | 'format' | 'level' | 'equipment';
export type ProgramBrowser = 'programs' | 'discover';

export type ProgramFilters = Record<ProgramFilterKey, string>;
type MatchableProgram = Pick<RelayProgram, 'name' | 'description' | 'exercises'> & {
  difficulty?: string;
  tags: string[];
  blocks?: RelayProgram['blocks'];
};

// The one place the set of filters is spelled out, so adding a filter is not a hunt through
// every default and reset.
export function emptyProgramFilters(): ProgramFilters {
  return { goal: '', focus: '', format: '', level: '', equipment: '' };
}

// Order is the order the groups appear in the sheet and the chips in the row.
const FILTER_LABELS: Record<ProgramFilterKey, string> = {
  goal: 'Goal', focus: 'Focus', format: 'Format', level: 'Level', equipment: 'Equipment'
};

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
  return { ...emptyProgramFilters(), ...(state.programFilters || {}) };
}

/**
 * Free-text search is deliberately not counted. It is already visible in the field it was
 * typed into, so counting it would make the badge disagree with what the sheet can reset.
 */
export function activeProgramFilterCount(state: AppState): number {
  return Object.values(programFilterValues(state)).filter(Boolean).length;
}

export function programFilterLabel(value: string): string {
  return value === MY_EQUIPMENT ? 'My equipment' : formatTaxonomyLabel(value);
}

// Equipment is the shared vocabulary exercises filter on. My equipment appears once a kit is
// saved, as it does for exercises, and a selection nothing offers any more stays listed so it
// can still be undone.
function filterGroups(state: AppState): { key: ProgramFilterKey; label: string; values: string[] }[] {
  const selected = programFilterValues(state).equipment;
  const equipment = [...(ownedEquipmentKeys(state.settings?.ownedEquipment).length ? [MY_EQUIPMENT] : []), ...EQUIPMENT_KEYS];
  if (selected && !equipment.includes(selected)) equipment.push(selected);
  return [
    { key: 'goal', label: FILTER_LABELS.goal, values: PROGRAM_GOALS },
    { key: 'focus', label: FILTER_LABELS.focus, values: PROGRAM_FOCUS_LABELS },
    { key: 'format', label: FILTER_LABELS.format, values: PROGRAM_FORMAT_LABELS },
    { key: 'level', label: FILTER_LABELS.level, values: [...TRAINING_LEVELS] },
    { key: 'equipment', label: FILTER_LABELS.equipment, values: equipment }
  ];
}

export function programMatcher(state: AppState): (program: MatchableProgram) => boolean {
  const query = state.programFilter.toLowerCase();
  const filter = programFilterValues(state);
  const owned = ownedEquipmentKeys(state.settings?.ownedEquipment);
  return (program) => {
    const exercises = state.exercises as Exercise[];
    const taxonomy = programTaxonomy(program as RelayProgram, exercises);
    const labels = programSearchTags(program as RelayProgram, exercises);
    // The author's own tags stay searchable even when they are not a Workstr goal.
    const text = [program.name, program.description, program.difficulty || '', ...(program.tags || []), ...labels, ...labels.map(formatTaxonomyLabel)];
    return text.join(' ').toLowerCase().includes(query)
      && (!filter.goal || taxonomy.goals.includes(filter.goal))
      && (!filter.focus || taxonomy.focus.includes(filter.focus))
      && (!filter.format || taxonomy.format.includes(filter.format))
      && (!filter.level || taxonomy.level === filter.level)
      && (!filter.equipment || (filter.equipment === MY_EQUIPMENT
        ? kitCoversEquipment(taxonomy.equipment, owned)
        : taxonomy.equipment.includes(filter.equipment)));
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
  const chips = (Object.keys(FILTER_LABELS) as ProgramFilterKey[])
    .filter((key) => filter[key])
    .map((key) => `<button class="program-filter-chip" type="button" data-program-filter-remove="${key}" data-program-filter-context="${context}" aria-label="Remove ${html(FILTER_LABELS[key].toLowerCase())} filter ${html(programFilterLabel(filter[key]))}"><span>${html(programFilterLabel(filter[key]))}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`)
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
/**
 * Exported because the sheet's footer is patched in place when a filter changes rather than
 * rendered again — the option that was tapped has to stay the focused element — and the
 * count it shows has to keep agreeing with the list behind it.
 */
export function programFilterMatches(context: ProgramBrowser, state: AppState): number {
  const match = programMatcher(state);
  return context === 'discover'
    ? state.programs.filter(match).length
    : state.sheets.map(sheetToProgram).filter(match).length;
}

export function programMatchLabel(matches: number): string {
  return `Show ${matches} ${matches === 1 ? 'program' : 'programs'}`;
}

export function programFilterSheet(state: AppState): string {
  const context = state.programFilterSheet;
  if (!context) return '';
  const filter = programFilterValues(state);
  const matches = programFilterMatches(context, state);
  return `<div class="program-filter-backdrop" data-program-filter-close="1"></div>
  <div class="program-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="program-filter-title">
    <div class="program-filter-sheet-handle" aria-hidden="true"></div>
    <div class="program-filter-sheet-header"><h2 id="program-filter-title">Filter ${context === 'discover' ? 'relay programs' : 'programs'}</h2></div>
    <div class="program-filter-sheet-body">
      ${filterGroups(state).map((group) => filterGroup(group, filter[group.key])).join('')}
    </div>
    <div class="program-filter-sheet-footer">
      <button class="button quiet" id="program-filter-reset" type="button">Reset filters</button>
      <button class="button primary" id="program-filter-apply" type="button">${programMatchLabel(matches)}</button>
    </div>
  </div>`;
}
