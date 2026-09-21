// What a broken image turns into, declared in markup and carried out by one listener.
//
// These used to be inline `onerror="..."` handlers. Inline script is exactly what the Content
// Security Policy forbids (`script-src 'self'`), and three of them built a JavaScript string
// out of a creator's name - text another Nostr user controls, one quote away from being code.
// Markup now says only which fallback it wants, as data, and this module is the only code
// that runs:
//
//   data-fallback="next"                 hide the image and show the element right after it
//   data-fallback="remove"               remove the image
//   data-fallback="parent-placeholder"   mark the parent a placeholder and remove the image
//   data-fallback="hero"                 keep the element as an empty "No image" placeholder
//   data-fallback="replace"              swap in a <span> or <div> (`data-fallback-tag`) with
//                                        `data-fallback-class` and `data-fallback-text`
//
// `error` does not bubble, so the listener captures it on the document instead.
export type ImageFallback = 'next' | 'remove' | 'parent-placeholder' | 'hero' | 'replace';

export function handleImageError(image: HTMLImageElement): void {
  const mode = image.dataset.fallback as ImageFallback | undefined;
  if (mode === 'next') {
    image.hidden = true;
    const next = image.nextElementSibling as HTMLElement | null;
    if (next) next.hidden = false;
  } else if (mode === 'remove') {
    image.remove();
  } else if (mode === 'parent-placeholder') {
    image.parentElement?.classList.add('placeholder');
    image.remove();
  } else if (mode === 'hero') {
    // `srcset` has to go with `src`, or the browser reloads a rendition straight back into
    // the element the placeholder just took over.
    image.classList.add('placeholder');
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    image.textContent = 'No image';
  } else if (mode === 'replace') {
    const replacement = document.createElement(image.dataset.fallbackTag === 'div' ? 'div' : 'span');
    if (image.dataset.fallbackClass) replacement.className = image.dataset.fallbackClass;
    // textContent, never markup: the text is a name someone else chose.
    if (image.dataset.fallbackText) replacement.textContent = image.dataset.fallbackText;
    image.replaceWith(replacement);
  }
}

let installed = false;

export function installImageFallbacks(target: Document = document): void {
  if (installed && target === document) return;
  if (target === document) installed = true;
  target.addEventListener('error', (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.dataset.fallback) handleImageError(image);
  }, true);
}
