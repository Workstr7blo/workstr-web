import { updateCatalogStatusLines } from './catalog-surfaces';
import { preservingScroll } from './scroll';
import { preservingSettingsDisclosures } from './settings-disclosure';
import type { AppState } from './state';

// Rendering scope is the open question this file exists to narrow, so the count of full
// rebuilds is kept here rather than at any of the hundred-odd `render()` call sites: a
// counter at a caller counts that caller, and what nobody could say is how many rebuilds a
// cold start costs in total, or which of them a change removed rather than moved. Held
// rebuilds are counted apart - the work was skipped, but the caller still asked.
export interface RenderOptions {
  // Moving to another view is a new page to the reader, not a redraw.
  toTop?: boolean;
  // Free text, read by a person: what made this render happen. Worth passing from anything
  // that renders without the reader having asked for it - a boot step, arriving relay data,
  // a status changing - because those are the renders #178 is trying to be rid of. A render
  // that answers a tap is attributed by the tap and needs no reason.
  reason?: string;
}

export interface RebuildOptions extends RenderOptions {
  trace?: RenderTrace;
}

export interface RenderRecord {
  reason: string;
  held: boolean;
}

export interface RenderTrace {
  readonly rebuilds: number;
  readonly held: number;
  readonly recent: readonly RenderRecord[];
  record(record: RenderRecord): void;
}

const UNATTRIBUTED = 'unattributed';
// The counts run for the life of the tab; the list is a window on the end of it. An
// installed PWA stays open for days, and an unbounded log of every render it ever did
// would be a leak in the diagnostic meant to find one.
const RECENT_LIMIT = 200;
// A dev build only, and not under the test runner: the suite boots a shell per test and
// the trace would bury the assertions it exists to support. Vite replaces `DEV` with a
// literal, so a production build drops the branch entirely and logs nothing.
const TRACE_TO_CONSOLE = import.meta.env.DEV && import.meta.env.MODE !== 'test';

export function createRenderTrace(): RenderTrace {
  const recent: RenderRecord[] = [];
  let rebuilds = 0;
  let held = 0;
  return {
    get rebuilds(): number { return rebuilds; },
    get held(): number { return held; },
    get recent(): readonly RenderRecord[] { return recent; },
    record(record: RenderRecord): void {
      if (record.held) held += 1;
      else rebuilds += 1;
      recent.push(record);
      if (recent.length > RECENT_LIMIT) recent.shift();
      if (TRACE_TO_CONSOLE) console.debug(`[render] ${record.reason}${record.held ? ' (held)' : ''}`);
    }
  };
}

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
export function rebuildRoot(root: HTMLElement, state: AppState, rebuild: () => void, options: RebuildOptions = {}): void {
  const reason = options.reason || UNATTRIBUTED;
  if (heldForLiveSession(root, state)) {
    options.trace?.record({ reason, held: true });
    return;
  }
  options.trace?.record({ reason, held: false });
  preservingScroll(root, () => preservingSettingsDisclosures(root, rebuild), options.toTop);
}

// The class rather than `state.activeSession` alone: the overlay is mounted by
// `shellMarkup` and opened by the runner, so only the class says a rebuild would land
// under the user. A background catalog refresh is the one thing that keeps changing while
// the rebuild is held, and its status lines are already mounted, so they are patched in
// place instead of waiting for the session to end.
function heldForLiveSession(root: HTMLElement, state: AppState): boolean {
  if (!state.activeSession) return false;
  if (!root.querySelector('#session-overlay')?.classList.contains('open')) return false;
  updateCatalogStatusLines(root, state);
  return true;
}
