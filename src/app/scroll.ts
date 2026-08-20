// The shell redraws by replacing the whole document, which collapses its height for an
// instant and takes the reading position with it. Expanding a workout in history, or a
// backup progress line simply ticking over, threw the page back to the top — on every
// device, and repeatedly while a backup ran. Rebuilding wholesale is the design, so the
// position is carried across the rebuild rather than the rebuild being unpicked.
export function preservingScroll(rebuild: () => void, toTop = false): void {
  // Read before the rebuild: afterwards the browser has already clamped it to whatever
  // the half-built document could hold.
  const restoreTo = toTop ? 0 : window.scrollY;
  rebuild();
  // Guarded because a redraw that did not move the page must not scroll it at all: on iOS
  // an unnecessary scrollTo interrupts momentum scrolling under the reader's finger.
  if (window.scrollY !== restoreTo) window.scrollTo(0, restoreTo);
}
