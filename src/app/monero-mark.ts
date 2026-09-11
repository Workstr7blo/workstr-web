import { renderSVG } from 'uqr';

// The Monero mark, vendored rather than fetched: two bars and the two chevrons of the
// Monero "M", drawn in `currentColor` so it inherits the payment accent from the surface it
// sits on. Monochrome use is what the Monero press kit allows without reproducing its
// artwork files, and a local path costs no request and works offline like the rest of the
// app. It identifies the payment mechanism only — never Workstr itself.
//
// It lives here rather than with either surface that draws it because both the creator tip
// sheet and the Monero support card need it, and features do not import each other.
const MONERO_MARK = 'M4 7v10h3v-5.8l5 5 5-5V17h3V7l-8 8z';

// Share of the code's width the mark's plate covers. 22% of the width is 4.8% of the area,
// against the 30% that error correction level H can lose, so the code still reads with the
// centre knocked out. Raising this trades scanning margin for a bigger mark; do not.
const MARK_PLATE_RATIO = 0.22;

export function moneroMark(size = 16): string {
  return `<svg class="monero-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${MONERO_MARK}"/></svg>`;
}

export function moneroBadge(size = 56): string {
  return `<svg class="monero-badge" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>
    <path fill="currentColor" d="${MONERO_MARK}"/>
  </svg>`;
}

/**
 * A Monero payment code with the mark in its middle.
 *
 * Level H because the centre is covered: the plate is a white quiet zone knocked out of the
 * modules, and H can lose 30% of them. The mark is painted from `--payment-accent` rather
 * than `currentColor` - it sits on white inside the code, where the surrounding text colour
 * would be unreadable. Monero surfaces are the only callers, so that token is Monero
 * orange wherever this renders.
 */
export function moneroQr(uri: string): string {
  const svg = renderSVG(uri, { ecc: 'H', border: 2 });
  const size = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] || 0);
  if (!size) return svg;
  const plate = Math.round(size * MARK_PLATE_RATIO);
  const plateOffset = Math.round((size - plate) / 2);
  const mark = Math.round(plate * 0.66);
  const markOffset = (size - mark) / 2;
  return svg.replace(
    '</svg>',
    `<rect x="${plateOffset}" y="${plateOffset}" width="${plate}" height="${plate}" rx="${Math.round(plate * 0.18)}" fill="white"/>`
      + `<g transform="translate(${markOffset} ${markOffset}) scale(${(mark / 24).toFixed(4)})">`
      + `<path fill="var(--payment-accent)" d="${MONERO_MARK}"/></g></svg>`
  );
}
