// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { preservingScroll } from '../src/app/scroll';

// The real shape: a shell root whose entire contents, `.content` included, are replaced.
function shell(scrollTop = 0): HTMLElement {
  document.body.innerHTML = '<div id="app"><main class="content">old</main></div>';
  const root = document.getElementById('app') as HTMLElement;
  (root.querySelector('.content') as HTMLElement).scrollTop = scrollTop;
  return root;
}

const redraw = (root: HTMLElement) => (): void => { root.innerHTML = '<main class="content">new</main>'; };
const scrollTop = (root: HTMLElement): number => (root.querySelector('.content') as HTMLElement).scrollTop;

describe('redrawing without losing the reader\'s place', () => {
  it('puts the pane back where it was', () => {
    const root = shell(820);
    preservingScroll(root, redraw(root));
    expect(scrollTop(root)).toBe(820);
    expect(root.querySelector('.content')?.textContent).toBe('new');
  });

  // The position lives on `.content`, not the window: a fixed pane with its own overflow
  // leaves `window.scrollY` at 0 forever, so restoring the window restored nothing.
  it('reads the pane rather than the window', () => {
    const root = shell(500);
    expect(window.scrollY).toBe(0);
    preservingScroll(root, redraw(root));
    expect(scrollTop(root)).toBe(500);
  });

  it('goes to the top when the redraw is a different view', () => {
    const root = shell(820);
    preservingScroll(root, redraw(root), true);
    expect(scrollTop(root)).toBe(0);
  });

  it('reads the position before the redraw, not after', () => {
    const root = shell(640);
    preservingScroll(root, () => {
      // The old pane is gone by the time the new one exists, and a position read here
      // would be the replacement's zero.
      root.innerHTML = '<main class="content">new</main>';
    });
    expect(scrollTop(root)).toBe(640);
  });

  it('survives a rebuild that renders the pane deeper in the tree', () => {
    const root = shell(300);
    preservingScroll(root, () => { root.innerHTML = '<div class="app"><main class="content">new</main></div>'; });
    expect(scrollTop(root)).toBe(300);
  });
});
