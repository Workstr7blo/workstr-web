import { programStatusLine } from './layout';
import { preservingScroll } from './scroll';
import { preservingSettingsDisclosures } from './settings-disclosure';
import type { AppState } from './state';

// The shell redraws by replacing everything inside its root. That is right for every view,
// which is rebuilt from state, and wrong for the live session, whose current set and rest
// countdown exist only in the DOM. A catalog refresh, a sync restore or a profile arriving
// would take the reps and load typed into the current set away mid-workout, and silently:
// the row comes back looking filled, with the prescription rather than what was typed. A
// running rest countdown would lose its overlay and reset to the number in the markup.
//
// Nothing behind the overlay is on screen, so the rebuild waits: `closeSessionOverlay` in
// the session runner renders once the session ends, which is also the first moment the
// wait costs the user nothing.
// The disclosures are restored inside the scroll pass, not around it: reopening a category
// changes the height of the page, and the reading position has to be put back against the
// page the reader will actually see.
export function rebuildRoot(root: HTMLElement, state: AppState, rebuild: () => void, toTop = false): void {
  if (heldForLiveSession(root, state)) return;
  preservingScroll(root, () => preservingSettingsDisclosures(root, rebuild), toTop);
}

// The class rather than `state.activeSession` alone: the overlay is mounted by
// `shellMarkup` and opened by the runner, so only the class says a rebuild would land
// under the user. A background catalog refresh is the one thing that keeps changing while
// the rebuild is held, and its status lines are already mounted, so they are patched in
// place instead of waiting for the session to end.
function heldForLiveSession(root: HTMLElement, state: AppState): boolean {
  if (!state.activeSession) return false;
  if (!root.querySelector('#session-overlay')?.classList.contains('open')) return false;
  const exercises = root.querySelector('#discover-status');
  if (exercises) exercises.textContent = state.exerciseStatus;
  const programs = root.querySelector('#program-status');
  if (programs) programs.textContent = programStatusLine(state);
  return true;
}
