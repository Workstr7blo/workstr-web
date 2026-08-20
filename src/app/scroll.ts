// The app does not scroll the window. `.content` is a fixed-position pane with its own
// `overflow-y`, so the reading position lives on that element and `window.scrollY` is
// always 0 — which is why restoring the window position did nothing at all.
const SCROLLER = '.content';

// The shell redraws by replacing everything inside its root, and the pane that holds the
// reading position goes with it: the replacement starts at the top. Expanding a workout in
// history, or a backup progress line simply ticking over, therefore threw the reader back
// to the top of the page, on every device and repeatedly while a backup ran. Rebuilding
// wholesale is the design, so the position is carried across the rebuild.
export function preservingScroll(root: ParentNode, rebuild: () => void, toTop = false): void {
  const before = toTop ? 0 : (root.querySelector<HTMLElement>(SCROLLER)?.scrollTop ?? 0);
  rebuild();
  // Queried again on purpose: the rebuild threw the old pane away, so the position has to
  // be put back on the element that replaced it, not the one it was read from.
  const scroller = root.querySelector<HTMLElement>(SCROLLER);
  // Guarded because a redraw that did not move the pane must not scroll it at all: on iOS
  // a scroll that changes nothing still interrupts momentum scrolling under the finger.
  if (scroller && scroller.scrollTop !== before) scroller.scrollTop = before;
}
