// The Monero mark, vendored rather than fetched: two bars and the two chevrons of the
// Monero "M", drawn in `currentColor` so it inherits the payment accent from the surface it
// sits on. Monochrome use is what the Monero press kit allows without reproducing its
// artwork files, and a local path costs no request and works offline like the rest of the
// app. It identifies the payment mechanism only — never Workstr itself.
//
// It lives here rather than with either surface that draws it because both the creator tip
// sheet and the Monero support card need it, and features do not import each other.
const MONERO_MARK = 'M4 7v10h3v-5.8l5 5 5-5V17h3V7l-8 8z';

export function moneroMark(size = 16): string {
  return `<svg class="monero-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${MONERO_MARK}"/></svg>`;
}

export function moneroBadge(size = 56): string {
  return `<svg class="monero-badge" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>
    <path fill="currentColor" d="${MONERO_MARK}"/>
  </svg>`;
}
