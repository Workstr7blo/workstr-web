import { describe, expect, it, vi, afterEach } from 'vitest';
import { preservingScroll } from '../src/app/scroll';

// jsdom does not scroll, so the position is set directly and the call is observed.
function atScroll(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
}

afterEach(() => { vi.restoreAllMocks(); atScroll(0); });

describe('redrawing without losing the reader\'s place', () => {
  it('puts the page back where it was', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    atScroll(820);
    // What replacing the document does: the height collapses and the browser clamps.
    preservingScroll(() => atScroll(0));
    expect(scrollTo).toHaveBeenCalledWith(0, 820);
  });

  it('goes to the top when the redraw is a different view', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    atScroll(820);
    preservingScroll(() => {}, true);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  // An unnecessary scrollTo interrupts momentum scrolling on iOS, so a redraw that did
  // not move the page must not touch it.
  it('leaves the page alone when the redraw did not move it', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    atScroll(400);
    preservingScroll(() => {});
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('reads the position before the redraw, not after', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    atScroll(500);
    preservingScroll(() => atScroll(12));
    expect(scrollTo).toHaveBeenCalledWith(0, 500);
  });
});
