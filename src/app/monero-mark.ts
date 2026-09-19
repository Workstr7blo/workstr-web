import { renderSVG } from 'uqr';
// The official Monero symbol, from the Monero project's press kit:
// https://www.getmonero.org/press-kit/ (Symbols -> Monero Symbol, monero-symbol-480.png).
// Bundled rather than hot-linked, so a receive code draws offline and getmonero.org going down
// cannot change what Workstr shows. The only edits are a resize to 128px and a palette
// reduction: the geometry and the colours are the project's own, which is the point of using
// the official mark instead of drawing one (#268). Vite inlines it - it is under the 4 KB asset
// limit - so the code carries its own symbol and costs no second request.
import moneroSymbol from '../assets/monero-symbol.png';

// The Monero mark, vendored rather than fetched: two bars and the two chevrons of the
// Monero "M", drawn in `currentColor` so it inherits the payment accent from the surface it
// sits on. Monochrome use is what the Monero press kit allows without reproducing its
// artwork files, and a local path costs no request and works offline like the rest of the
// app. It identifies the payment mechanism only — never Workstr itself.
//
// It lives here rather than with either surface that draws it because both the creator tip
// sheet and the Monero support card need it, and features do not import each other. Nothing
// draws it bare any more: the account chip's medallion was the only caller of a standalone
// mark, and #260 took persistent payment branding out of the header.
export const MONERO_MARK = 'M4 7v10h3v-5.8l5 5 5-5V17h3V7l-8 8z';

// Share of the code's width the symbol's plate covers. 20% of the width is 4% of the area,
// against the 30% that error correction level H can lose, so the code still reads with the
// centre knocked out. Raising this trades scanning margin for a bigger mark; do not.
const MARK_PLATE_RATIO = 0.2;

export function moneroBadge(size = 56): string {
  return `<svg class="monero-badge" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>
    <path fill="currentColor" d="${MONERO_MARK}"/>
  </svg>`;
}

/**
 * A Monero payment code with the official Monero symbol in its middle.
 *
 * Level H because the centre is covered: the plate is a white quiet zone knocked out of the
 * modules, and H can lose 30% of them. What sits on the plate is the press-kit symbol itself,
 * not Workstr's monochrome mark - this is the one surface where the reader is looking at a
 * Monero payment destination and the network's own mark is the honest label for it. The symbol
 * is decorative: every caller wraps the code in a `role="img"` with its own label.
 */
export function moneroQr(uri: string): string {
  const svg = renderSVG(uri, { ecc: 'H', border: 2 });
  const size = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] || 0);
  if (!size) return svg;
  const plate = Math.round(size * MARK_PLATE_RATIO);
  const plateOffset = Math.round((size - plate) / 2);
  const mark = Math.round(plate * 0.74);
  const markOffset = (size - mark) / 2;
  return svg.replace(
    '</svg>',
    `<rect x="${plateOffset}" y="${plateOffset}" width="${plate}" height="${plate}" rx="${Math.round(plate * 0.18)}" fill="white"/>`
      + `<image href="${moneroSymbol}" x="${markOffset}" y="${markOffset}" width="${mark}" height="${mark}"`
      + ` preserveAspectRatio="xMidYMid meet" aria-hidden="true"/></svg>`
  );
}
