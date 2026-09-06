import { html } from '../../app/format';
import type { SessionExercise } from '../../app/state';
import { responsiveImageSrcset, responsiveImageUrl } from '../../core/media';

// The one hero both live-session views draw. It was written out twice, identically, and the
// responsive sources below would have made that two places to get `sizes` wrong.
//
// Eager on purpose: the exercise on screen is the reason the user opened the session, and
// this is the only image on it. The saving here is the size of the file, not when it starts.
//
// `.session-body` is `max-width: 720px` with `clamp(20px, 4vw, 34px)` of side padding,
// overridden to 18px below 736px, so the hero is the viewport less 36px on a phone and
// 652px once the body stops growing.
const SIZES = '(max-width: 736px) calc(100vw - 36px), 652px';

export function sessionHeroMedia(exercise: SessionExercise | undefined, name: string): string {
  const src = exercise?.imageUrl;
  if (!src) return '<div class="session-ex-image wide placeholder">No image</div>';
  const srcset = responsiveImageSrcset(src, [480, 720, 1080]);
  // `srcset` has to go with `src` when the image fails, or the browser reloads a rendition
  // straight back into the element the placeholder just took over.
  const onerror = "this.classList.add('placeholder');this.removeAttribute('src');this.removeAttribute('srcset');this.textContent='No image'";
  return `<img class="session-ex-image wide" src="${html(responsiveImageUrl(src, 720))}"${srcset ? ` srcset="${html(srcset)}" sizes="${SIZES}"` : ''} alt="${html(name)}" loading="eager" onerror="${onerror}">`;
}
