import { preservingScroll } from './scroll';

// Rendering scope is the open question this file exists to narrow, so the count of
// rebuilds is kept here rather than at any of the hundred-odd `render()` call sites: a
// counter at a caller counts that caller, and what nobody could say is how many rebuilds a
// cold start costs in total, or which of them a change removed rather than moved.
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
}

export interface RenderTrace {
  readonly rebuilds: number;
  readonly recent: readonly RenderRecord[];
  record(record: RenderRecord): void;
}

const UNATTRIBUTED = 'unattributed';
// The count runs for the life of the tab; the list is a window on the end of it. An
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
  return {
    get rebuilds(): number { return rebuilds; },
    get recent(): readonly RenderRecord[] { return recent; },
    record(record: RenderRecord): void {
      rebuilds += 1;
      recent.push(record);
      if (recent.length > RECENT_LIMIT) recent.shift();
      if (TRACE_TO_CONSOLE) console.debug(`[render] ${record.reason}`);
    }
  };
}

// A render writes the current page. It used to write the whole root, which is why this
// function once refused to run at all while a workout was live: the reps and load typed
// into the current set, and a running rest countdown, exist only in the DOM, and a catalog
// refresh or an arriving profile would take them away mid-workout — silently, because the
// row came back looking filled, with the prescription rather than what was typed.
//
// The overlay is mounted with the shell frame now and a render does not reach into it, so
// there is nothing left to protect and the hold is gone. What replaced it is not a better
// guard but the absence of the hazard: background work during a session repaints the page
// behind the overlay, where the user cannot see it and the session does not live.
//
// It also used to capture which Settings categories were open and reopen them afterwards,
// because background work redrew the page a reader was sitting on. Nothing background
// redraws Settings any more - the account chip, the catalog, the sync status, the funding
// meter and the sync switch are all written into the surfaces that show them - so a render
// here is a page the reader asked for, and a fresh page opens as a fresh page.
export function rebuildRoot(root: HTMLElement, rebuild: () => void, options: RebuildOptions = {}): void {
  options.trace?.record({ reason: options.reason || UNATTRIBUTED });
  preservingScroll(root, rebuild, options.toTop);
}
