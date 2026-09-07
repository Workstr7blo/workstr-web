import { discoverCards, discoverEmptyText } from '../features/discover/views';
import { writeCards } from './card-grid';
import { programStatusLine } from './layout';
import type { AppState } from './state';

// Catalog work runs on every launch and whenever Exercises or Workouts is opened: a status
// line, then relay answers, then author profiles, zap totals and payment targets arriving
// separately behind them. Each of those rebuilt the whole root. A reader sitting on
// Settings or Statistics watched their page redraw several times for data no surface in
// front of them was showing.
//
// `appView` renders one page, so whether a surface is mounted is the same question as
// whether the reader can see it. Each of these writes what is there and reports what it
// found; a caller that gets `false` has nothing to draw and only has to keep the state,
// which the next render of that page reads.

export function updateExerciseCatalogStatus(root: ParentNode, state: AppState): boolean {
  const line = root.querySelector('#discover-status');
  if (!line) return false;
  line.textContent = state.exerciseStatus;
  return true;
}

export function updateProgramCatalogStatus(root: ParentNode, state: AppState): boolean {
  const line = root.querySelector('#program-status');
  if (!line) return false;
  line.textContent = programStatusLine(state);
  return true;
}

// The cards are what a catalog answer changes. The toolbar, the filter chips and the status
// line above them are untouched, and the grid delegates its clicks to itself, so writing
// into it costs no listeners and redraws no image that is already on screen.
export function updateDiscoverExercises(root: ParentNode, state: AppState): boolean {
  const grid = root.querySelector('#discover-grid');
  if (!grid) return false;
  writeCards(grid, discoverCards(state), discoverEmptyText(state), 'data-address');
  grid.classList.toggle('selecting', state.discoverSelect.active);
  updateExerciseCatalogStatus(root, state);
  return true;
}

// Whether any program card is on screen. A catalog answer writes the lists through
// `src/app/program-list-controller.ts`, which binds the cards it wrote; a reader with no
// program card in front of them gets nothing written at all, and the next render of that
// page reads the state that was kept.
export function programSurfaceMounted(root: ParentNode): boolean {
  return Boolean(root.querySelector('.program-list'));
}
