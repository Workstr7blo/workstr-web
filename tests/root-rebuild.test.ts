// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRenderTrace, rebuildRoot } from '../src/app/root-rebuild';

// The shell frame as a render sees it: a page host it writes, and the live-session overlay
// standing outside the host, which is the whole reason a render no longer has to be held.
function shell(overlayOpen: boolean): HTMLElement {
  document.body.innerHTML = `<div id="app">
    <main class="content">
      <div id="page-host">old page</div>
    </main>
    <div id="session-overlay" class="session-overlay ${overlayOpen ? 'open' : ''}">
      <input data-session-reps="0" value="8">
      <div id="session-rest-val">42</div>
    </div>
  </div>`;
  return document.getElementById('app') as HTMLElement;
}

// A render writes the page host and nothing else. This is what `render()` in the shell
// does, reduced to the part that matters here.
const redraw = (root: HTMLElement) => (): void => {
  const host = root.querySelector('#page-host');
  if (host) host.innerHTML = 'rebuilt';
};

describe('rebuilding the shell root', () => {
  it('writes the page', () => {
    const root = shell(false);
    rebuildRoot(root, redraw(root));
    expect(root.querySelector('#page-host')?.textContent).toBe('rebuilt');
  });

  // The regression from #165, and why the hold that used to catch it is gone. A background
  // refresh mid-workout once took away the reps typed into the current set and reset a
  // running rest countdown, so the render was refused outright while the overlay was open.
  // The overlay is mounted with the frame now and a page render cannot reach it, so the
  // render is allowed to happen and the session is untouched anyway.
  it('leaves a live session alone instead of refusing to run', () => {
    const root = shell(true);
    const typed = root.querySelector<HTMLInputElement>('[data-session-reps="0"]')!;
    typed.value = '11';

    rebuildRoot(root, redraw(root), { reason: 'exercise-catalog-loaded' });

    expect(root.querySelector('#page-host')?.textContent).toBe('rebuilt');
    expect(root.querySelector('[data-session-reps="0"]')).toBe(typed);
    expect(typed.value).toBe('11');
    expect(root.querySelector('#session-rest-val')?.textContent).toBe('42');
    expect(root.querySelector('#session-overlay')?.classList.contains('open')).toBe(true);
  });

  it('still carries the reading position across a rebuild', () => {
    const root = shell(false);
    (root.querySelector('.content') as HTMLElement).scrollTop = 640;
    rebuildRoot(root, redraw(root));
    expect((root.querySelector('.content') as HTMLElement).scrollTop).toBe(640);
  });

  // Which Settings categories are expanded lives in the DOM alone, so a rebuild for a sync
  // tick or an arriving profile used to collapse the card being read.
  it('reopens the Settings categories the reader had expanded', () => {
    const root = shell(false);
    root.querySelector('#page-host')!.innerHTML = `
      <details data-settings-section="account" open></details>
      <details data-settings-section="sync"></details>`;
    rebuildRoot(root, () => {
      root.querySelector('#page-host')!.innerHTML = `
        <details data-settings-section="account"></details>
        <details data-settings-section="sync"></details>`;
    });
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="account"]')?.open).toBe(true);
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="sync"]')?.open).toBe(false);
  });

  // Monero Mode ships its card open so switching rails reveals the address section. Writing
  // the captured closed state back over that would undo the reveal.
  it('leaves a category the fresh markup opens on its own alone', () => {
    const root = shell(false);
    root.querySelector('#page-host')!.innerHTML = '<details data-settings-section="payment-mode"></details>';
    rebuildRoot(root, () => {
      root.querySelector('#page-host')!.innerHTML = '<details data-settings-section="payment-mode" open></details>';
    });
    expect(root.querySelector<HTMLDetailsElement>('[data-settings-section="payment-mode"]')?.open).toBe(true);
  });

  it('goes to the top when the redraw is a different view', () => {
    const root = shell(false);
    (root.querySelector('.content') as HTMLElement).scrollTop = 640;
    rebuildRoot(root, redraw(root), { toTop: true });
    expect((root.querySelector('.content') as HTMLElement).scrollTop).toBe(0);
  });
});

// The count exists to answer one question across the increments of #178: did a change
// remove a render, or move it somewhere else? A counter at a call site could not, because
// there are over a hundred of them.
describe('tracing the rebuilds', () => {
  it('counts a rebuild with the reason it was given', () => {
    const root = shell(false);
    const trace = createRenderTrace();
    rebuildRoot(root, redraw(root), { reason: 'boot-first-paint', trace });
    expect(trace.rebuilds).toBe(1);
    expect(trace.recent).toEqual([{ reason: 'boot-first-paint' }]);
  });

  // Nothing is held back any more, so a render asked for during a workout is a render that
  // happened, and the count says so rather than hiding it in a second column.
  it('counts a render asked for during a live session like any other', () => {
    const root = shell(true);
    const trace = createRenderTrace();
    rebuildRoot(root, redraw(root), { reason: 'exercise-catalog-loaded', trace });
    expect(trace.rebuilds).toBe(1);
    expect(trace.recent).toEqual([{ reason: 'exercise-catalog-loaded' }]);
  });

  it('records a render nobody attributed rather than dropping it', () => {
    const root = shell(false);
    const trace = createRenderTrace();
    rebuildRoot(root, redraw(root), { trace });
    expect(trace.recent[0]).toEqual({ reason: 'unattributed' });
  });

  // An installed PWA stays open for days. The count is the measurement; the list is a
  // window on the end of it and must not grow without limit.
  it('keeps counting after the recent list has rolled over', () => {
    const root = shell(false);
    const trace = createRenderTrace();
    for (let i = 0; i < 250; i += 1) rebuildRoot(root, redraw(root), { reason: `render-${i}`, trace });
    expect(trace.rebuilds).toBe(250);
    expect(trace.recent).toHaveLength(200);
    expect(trace.recent[trace.recent.length - 1]?.reason).toBe('render-249');
  });

  it('rebuilds with no trace at all', () => {
    const root = shell(false);
    rebuildRoot(root, redraw(root));
    expect(root.querySelector('#page-host')?.textContent).toBe('rebuilt');
  });
});
