// Exercise photos are hosted on nostr.build, which resizes on demand: appending `?w=`
// redirects to a rendition under `/resp/<bucket>/` and serves AVIF where the browser takes
// it. The seed's 1200x1200 photos are 90KB of PNG each and 5.8KB at the smallest bucket -
// the same picture, at something nearer the size a 48px thumbnail actually needs.
//
// The canonical URL is what Workstr stores. Renditions are a rendering detail and must not
// reach IndexedDB, a Nostr event, a published program, an active session or a backup: the
// stored reference stays the original so the data remains portable.
const RESIZING_HOSTS = new Set(['i.nostr.build', 'image.nostr.build']);

// `media.nostr.build` serves the URL unchanged and `nostr.build` answers with HTML, so
// neither belongs here. Any other host - a Blossom server, an imported program's own media,
// a URL the user typed - is left alone.

export type ResponsiveImageWidth = 240 | 360 | 480 | 720 | 1080;

// The buckets are named for video heights, so the width asked for is not the width served.
// Measured against i.nostr.build with a 1200x1200 source:
//
//   ?w=240 -> 426px   ?w=480 -> 640px   ?w=1080 -> 1200px
//   ?w=360 -> 426px   ?w=720 -> 854px   (never upscaled past the original)
//
// `srcset` descriptors are therefore the delivered widths. Declaring the requested ones
// would tell the browser it is getting more pixels than it is, and it would pick too small
// a rendition on exactly the high-density phones this is meant to help.
const DELIVERED_WIDTH: Record<ResponsiveImageWidth, number> = {
  240: 426,
  360: 426,
  480: 640,
  720: 854,
  1080: 1200
};

// Returns the original for anything it cannot improve: a blank value, a `data:`/`blob:`
// URL, a host that does not resize, or a string that is not a URL at all. Reliability
// before bytes - an exercise photo must never go missing because an optimisation failed.
export function responsiveImageUrl(src: string | undefined | null, width: ResponsiveImageWidth): string {
  if (!src) return src || '';
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return src;
    if (!RESIZING_HOSTS.has(url.hostname)) return src;
    // `set` rather than `append`: a URL that already carries a width gets this one, not both.
    url.searchParams.set('w', String(width));
    return url.toString();
  } catch {
    return src;
  }
}

// Empty when the host does not resize, so the caller leaves the attribute off rather than
// emitting a srcset of one candidate identical to `src`.
export function responsiveImageSrcset(src: string | undefined | null, widths: ResponsiveImageWidth[]): string {
  if (!src) return '';
  const candidates = widths
    .map((width) => ({ width, url: responsiveImageUrl(src, width) }))
    .filter(({ url }) => url !== src);
  if (!candidates.length) return '';
  return candidates.map(({ width, url }) => `${url} ${DELIVERED_WIDTH[width]}w`).join(', ');
}
