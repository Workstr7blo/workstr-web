import { ICON_PATHS, type IconName } from './icon-paths';

/**
 * Every generic UI icon in the app (#287). One wrapper, so a chevron in the workout card and
 * a chevron in the calendar header cannot end up different weights, and so an icon added next
 * year inherits the accessibility rule instead of restating it.
 *
 * The geometry is upstream Lucide, generated into `icon-paths.ts`; this module owns
 * everything around it. Stroke width is fixed at Lucide's own 2 and is deliberately not an
 * option: varying it per call site is the inconsistency this replaced.
 *
 * Every icon carries `data-icon="<lucide name>"`, which is what a test or a browser check
 * should assert on. Path geometry is Lucide's to change on an upgrade; the name is ours.
 *
 * Not covered here, and correctly still hand-drawn: the recovery body map
 * (`src/app/bodymap.ts`), the Monero mark (`src/app/monero-mark.ts`), progress rings and
 * charts. Those are artwork or data, not interface icons.
 */

export type { IconName };

export interface IconOptions {
  /** Class on the `<svg>` itself. Sizing normally belongs in CSS, keyed off this. */
  class?: string;
  /** Explicit pixel size, for the few icons drawn inside markup that has no class to hang CSS on. */
  size?: number;
  /**
   * Announce the icon. Omit it whenever the icon sits next to its own label or inside a
   * button that already names the action, which is the usual case - a second announcement
   * of the same thing is noise, so decorative is the default.
   */
  label?: string;
  /** DOM id, for the icons a controller later patches in place. */
  id?: string;
  /** Fill the geometry in `currentColor` for solid glyphs such as play and pause. */
  filled?: boolean;
}

function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function icon(name: IconName, options: IconOptions = {}): string {
  const attributes = [
    options.id ? ` id="${attribute(options.id)}"` : '',
    options.class ? ` class="${attribute(options.class)}"` : '',
    ` data-icon="${name}"`,
    ' viewBox="0 0 24 24"',
    options.size ? ` width="${options.size}" height="${options.size}"` : '',
    options.filled ? ' fill="currentColor"' : ' fill="none"',
    ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',
    options.label ? ` role="img" aria-label="${attribute(options.label)}"` : ' aria-hidden="true"',
    ' focusable="false"'
  ].join('');
  return `<svg${attributes}>${ICON_PATHS[name]}</svg>`;
}
