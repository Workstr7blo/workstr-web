// The Tip Jar's piggy bank. It lives here rather than with any one surface that draws it: the
// bottom-nav item and Recent activity are in `features/monero`, the program-card Tip is in
// `features/sheets`, and features do not import each other. One pig, drawn one way.
//
// Outline in the nav icon language: a 24px box, stroked in `currentColor`, so it takes the nav
// colour in navigation and the payment accent inside a Tip.
export const PIGGY_BANK = '<path d="M19 11.5c0-3.6-3.1-6.5-7-6.5-1.1 0-2.1.2-3 .6L6.5 4v3.3A6.2 6.2 0 0 0 5.1 10H3v3.5h2.2c.5 1.1 1.3 2.1 2.3 2.8V19.5h3v-1.8h2.8v1.8h3v-3.2c1.7-1.2 2.7-3 2.7-4.8z"/><path d="M10 8h3.5"/><path d="M15.5 10.5h.01"/>';

// A small plus resting on the pig's back, which is what a Tip does: add to this creator's Tip
// Jar. It stays a third of the pig and never becomes the subject - the button says Tip in words,
// and the icon only says which kind of tip (#267).
const PLUS_BADGE = '<circle cx="19.3" cy="4.7" r="3.2"/><path d="M19.3 3.1v3.2"/><path d="M17.7 4.7h3.2"/>';

/**
 * The piggy bank with its plus, for a Tip control.
 *
 * Decorative on purpose: every caller is a button that already says Tip, so a screen reader
 * that also announced "piggy bank plus icon" would be reading the same action twice.
 */
export function tipPiggyIcon(size = 18): string {
  return `<svg class="tip-piggy-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PIGGY_BANK}${PLUS_BADGE}</svg>`;
}
