// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRenderTrace, rebuildRoot } from '../src/app/root-rebuild';
import type { ActiveSession, AppState } from '../src/app/state';

// The two things that decide whether a rebuild is allowed, plus the status lines and the
// live-session state a rebuild would destroy.
function shell(activeSession: ActiveSession | null, overlayOpen: boolean): { root: HTMLElement; state: AppState } {
  document.body.innerHTML = `<div id="app">
    <main class="content">
      <div id="discover-status">old exercise status</div>
      <div id="program-status">old program status</div>
      <input data-session-reps="0" value="8">
    </main>
    <div id="session-overlay" class="session-overlay ${overlayOpen ? 'open' : ''}"></div>
  </div>`;
  const root = document.getElementById('app') as HTMLElement;
  const state = { activeSession, exerciseStatus: 'loaded 42 Workstr exercises', programStatus: '' } as AppState;
  return { root, state };
}

const session = (): ActiveSession => ({ id: 1, sheetName: 'Push', startedAt: '2026-09-06T09:00:00.000Z', exercises: [], sets: [] });
const redraw = (root: HTMLElement) => (): void => { root.innerHTML = '<main class="content">rebuilt</main>'; };

describe('rebuilding the shell root', () => {
  it('rebuilds when no session is running', () => {
    const { root, state } = shell(null, false);
    rebuildRoot(root, state, redraw(root));
    expect(root.textContent).toContain('rebuilt');
  });

  // The bug this guards: the reps and load typed into the current set, and a running rest
  // countdown, exist only in the DOM. A background refresh must not take them away.
  it('holds the rebuild back while the live session overlay is open', () => {
    const { root, state } = shell(session(), true);
    const typed = root.querySelector<HTMLInputElement>('[data-session-reps="0"]')!;
    typed.value = '11';
    rebuildRoot(root, state, redraw(root));
    expect(root.textContent).not.toContain('rebuilt');
    expect(root.querySelector('[data-session-reps="0"]')).toBe(typed);
    expect(typed.value).toBe('11');
  });

  // A catalog refresh is the one thing that keeps changing behind the overlay, and both of
  // its status lines are already mounted, so they do not have to wait for the session.
  it('repaints the catalog status lines in place while it holds', () => {
    const { root, state } = shell(session(), true);
    state.programStatus = 'loaded 7 Workstr and creator programs';
    rebuildRoot(root, state, redraw(root));
    expect(root.querySelector('#discover-status')?.textContent).toBe('loaded 42 Workstr exercises');
    expect(root.querySelector('#program-status')?.textContent).toBe('loaded 7 Workstr and creator programs');
  });

  it('falls back to the same program status wording the markup uses', () => {
    const { root, state } = shell(session(), true);
    rebuildRoot(root, state, redraw(root));
    expect(root.querySelector('#program-status')?.textContent).toBe('program relay cache not loaded yet');
  });

  // Both halves are required. A session that has ended but left the class behind, or an
  // overlay that was never opened, must not freeze the app on a stale screen.
  it('rebuilds when the overlay is open without a session', () => {
    const { root, state } = shell(null, true);
    rebuildRoot(root, state, redraw(root));
    expect(root.textContent).toContain('rebuilt');
  });

  it('rebuilds when a session exists but its overlay is not open', () => {
    const { root, state } = shell(session(), false);
    rebuildRoot(root, state, redraw(root));
    expect(root.textContent).toContain('rebuilt');
  });

  it('still carries the reading position across a rebuild it allows', () => {
    const { root, state } = shell(null, false);
    (root.querySelector('.content') as HTMLElement).scrollTop = 640;
    rebuildRoot(root, state, redraw(root));
    expect((root.querySelector('.content') as HTMLElement).scrollTop).toBe(640);
  });

  // Which Settings categories are expanded lives in the DOM alone, so a rebuild for a sync
  // tick or an arriving profile used to collapse the card being read.
  it('reopens the Settings categories the reader had expanded', () => {
    const { root, state } = shell(null, false);
    root.querySelector('.content')!.innerHTML = `
      <details data-settings-section="account" open></details>
      <details data-settings-section="sync"></details>`;
    rebuildRoot(root, state, () => {
      root.innerHTML = `<main class="content">
        <details data-settings-section="account"></details>
        <details data-settings-section="sync"></details>
      </main>`;
    });
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="account"]')?.open).toBe(true);
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="sync"]')?.open).toBe(false);
  });

  // Monero Mode ships its card open so switching rails reveals the address section. Writing
  // the captured closed state back over that would undo the reveal.
  it('leaves a category the fresh markup opens on its own alone', () => {
    const { root, state } = shell(null, false);
    root.querySelector('.content')!.innerHTML = '<details data-settings-section="payment-mode"></details>';
    rebuildRoot(root, state, () => {
      root.innerHTML = '<main class="content"><details data-settings-section="payment-mode" open></details></main>';
    });
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="payment-mode"]')?.open).toBe(true);
  });

  it('goes to the top when the redraw is a different view', () => {
    const { root, state } = shell(null, false);
    (root.querySelector('.content') as HTMLElement).scrollTop = 640;
    rebuildRoot(root, state, redraw(root), { toTop: true });
    expect((root.querySelector('.content') as HTMLElement).scrollTop).toBe(0);
  });
});

// The count exists to answer one question across the increments of #178: did a change
// remove a full rebuild, or move it somewhere else? A counter at a call site could not,
// because there are over a hundred of them.
describe('tracing the rebuilds', () => {
  it('counts a rebuild it allowed, with the reason it was given', () => {
    const { root, state } = shell(null, false);
    const trace = createRenderTrace();
    rebuildRoot(root, state, redraw(root), { reason: 'boot-first-paint', trace });
    expect(trace.rebuilds).toBe(1);
    expect(trace.held).toBe(0);
    expect(trace.recent).toEqual([{ reason: 'boot-first-paint', held: false }]);
  });

  // A held rebuild is not a rebuild that did not happen: the caller still asked for one,
  // and an increment that stops it asking is a different result from one that only makes
  // the hold catch it.
  it('counts a held rebuild apart from an allowed one', () => {
    const { root, state } = shell(session(), true);
    const trace = createRenderTrace();
    rebuildRoot(root, state, redraw(root), { reason: 'exercise-catalog-loaded', trace });
    expect(trace.rebuilds).toBe(0);
    expect(trace.held).toBe(1);
    expect(trace.recent).toEqual([{ reason: 'exercise-catalog-loaded', held: true }]);
  });

  it('records a render nobody attributed rather than dropping it', () => {
    const { root, state } = shell(null, false);
    const trace = createRenderTrace();
    rebuildRoot(root, state, redraw(root), { trace });
    expect(trace.recent[0]).toEqual({ reason: 'unattributed', held: false });
  });

  // An installed PWA stays open for days. The counts are the measurement; the list is a
  // window on the end of it and must not grow without limit.
  it('keeps counting after the recent list has rolled over', () => {
    const { root, state } = shell(null, false);
    const trace = createRenderTrace();
    for (let i = 0; i < 250; i += 1) rebuildRoot(root, state, redraw(root), { reason: `render-${i}`, trace });
    expect(trace.rebuilds).toBe(250);
    expect(trace.recent).toHaveLength(200);
    expect(trace.recent[trace.recent.length - 1]?.reason).toBe('render-249');
  });

  it('rebuilds with no trace at all', () => {
    const { root, state } = shell(null, false);
    rebuildRoot(root, state, redraw(root));
    expect(root.textContent).toContain('rebuilt');
  });
});
