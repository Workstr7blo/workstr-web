// The Settings categories are native `<details>`, so which ones the reader has expanded is
// held in the DOM and nowhere else. The shell redraws by replacing everything inside its
// root, and the expanded category went with it: a sync status tick, a profile arriving or a
// catalog refresh landing collapsed the card the user was reading, mid-sentence and
// repeatedly during the first seconds after launch. The open sections are carried across
// the rebuild instead.
const SECTION = 'details[data-settings-section]';

// Reopening only, never closing. A card that ships `open` from its own markup means it
// deliberately — `payment-mode-card` opens as Monero Mode is switched on, so the address
// section it reveals is on screen — and writing a captured `false` back over that would
// undo the reveal. Sections closing under the reader is the whole of the reported problem.
//
// This is a mitigation for rebuilding Settings at all. Once background state stops
// redrawing the root, the disclosures survive because their DOM is never thrown away, and
// this can go with the rest of the full-root path.
export function preservingSettingsDisclosures(root: ParentNode, rebuild: () => void): void {
  const open = new Set(
    [...root.querySelectorAll<HTMLDetailsElement>(`${SECTION}[open]`)]
      .map((details) => details.dataset.settingsSection)
      .filter((section): section is string => Boolean(section))
  );
  rebuild();
  if (!open.size) return;
  // Queried again on purpose: the rebuild threw the captured elements away, so the state
  // has to be put back on the ones that replaced them.
  root.querySelectorAll<HTMLDetailsElement>(SECTION).forEach((details) => {
    const section = details.dataset.settingsSection;
    if (section && open.has(section)) details.open = true;
  });
}
