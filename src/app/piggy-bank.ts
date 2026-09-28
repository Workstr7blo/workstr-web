import { ICON_PATHS } from './icon-paths';

// The Tip Jar's piggy bank with a plus on its back. It lives here rather than with any one
// surface that draws it: the bottom-nav item and Recent activity are in `features/monero`, the
// program-card Tip is in `features/sheets`, and features do not import each other.
//
// The pig itself is Lucide's, through `icon('piggy-bank')`, everywhere it appears alone. Only
// this composition needs its geometry directly, because the badge has to sit inside the same
// 24px box as the pig rather than beside it.

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
  return `<svg class="tip-piggy-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS['piggy-bank']}${PLUS_BADGE}</svg>`;
}
