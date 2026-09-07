// A grid of cards, written so that a card the reader is already looking at is not thrown
// away and built again.
//
// Scoping a catalog answer to the grid it changes (#185) stopped the page being rebuilt,
// but the grid was still written with one `innerHTML`, so every card in it - and every
// exercise photo - was destroyed and recreated for an answer that usually changes nothing
// on screen. The browser then reloads each image: a blank tile and a second download of
// something already painted, which on a phone is the flicker the whole of #178 is about.
//
// Cards are keyed and compared by their own markup. One that has not changed is moved, not
// rebuilt; one that has is replaced; one that is gone is removed. Callers still delegate
// their clicks to the grid, so nothing here costs or loses a listener.
export interface GridCard {
  key: string;
  html: string;
}

export function writeCards(grid: Element, cards: readonly GridCard[], emptyHtml: string, keyAttr: string): void {
  if (!cards.length) {
    // The empty line is not a card and has no key. Writing it over an identical one would
    // be harmless, but there is nothing to compare it against and nothing to preserve.
    grid.innerHTML = emptyHtml;
    return;
  }
  const standing = new Map<string, Element>();
  for (const child of Array.from(grid.children)) {
    const key = child.getAttribute(keyAttr);
    if (key !== null && !standing.has(key)) standing.set(key, child);
  }
  // Detached, and only ever used to turn markup into a node. The reference taken from it
  // stays valid after the next write, because replacing a parent's children does not
  // invalidate a node something else is still holding.
  //
  // Every card is parsed, including ones that turn out to be unchanged, because the
  // comparison has to be like for like: a node standing in the document serialises the way
  // the parser left it - quoted attributes, no self-closing slash - and template markup
  // almost never matches that byte for byte. Comparing the two directly finds a difference
  // in every card and rebuilds the grid it was meant to preserve.
  const scratch = grid.ownerDocument.createElement('div');
  const wanted = cards.map((card) => {
    const found = standing.get(card.key);
    standing.delete(card.key);
    scratch.innerHTML = card.html;
    const fresh = scratch.firstElementChild as Element;
    return found && found.outerHTML === fresh.outerHTML ? found : fresh;
  });
  for (const gone of standing.values()) gone.remove();
  wanted.forEach((node, index) => {
    const atIndex = grid.children[index];
    if (atIndex !== node) grid.insertBefore(node, atIndex ?? null);
  });
  while (grid.children.length > wanted.length) grid.lastElementChild?.remove();
}
