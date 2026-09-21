// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { handleImageError, installImageFallbacks } from '../src/app/image-fallback';

function mount(markup: string): HTMLElement {
  document.body.innerHTML = `<div id="app">${markup}</div>`;
  return document.getElementById('app') as HTMLElement;
}

const fail = (root: HTMLElement) => root.querySelector('img')!.dispatchEvent(new Event('error'));

describe('image fallbacks without inline script', () => {
  installImageFallbacks();

  it('shows the element after a broken avatar', () => {
    const root = mount('<img data-fallback="next" src="https://x.invalid/a.png"><span hidden>S</span>');
    fail(root);
    expect(root.querySelector('img')?.hidden).toBe(true);
    expect(root.querySelector('span')?.hidden).toBe(false);
  });

  it('removes, or marks the parent a placeholder', () => {
    const removed = mount('<div><img data-fallback="remove" src="x"></div>');
    fail(removed);
    expect(removed.querySelector('img')).toBeNull();
    const parent = mount('<div class="detail-img"><img data-fallback="parent-placeholder" src="x"></div>');
    fail(parent);
    expect(parent.querySelector('.detail-img')?.classList.contains('placeholder')).toBe(true);
    expect(parent.querySelector('img')).toBeNull();
  });

  it('turns a session image into its placeholder and drops srcset with src', () => {
    const root = mount('<img class="session-ex-image" data-fallback="hero" src="x" srcset="x 1x">');
    fail(root);
    const image = root.querySelector('img')!;
    expect(image.classList.contains('placeholder')).toBe(true);
    expect(image.hasAttribute('src')).toBe(false);
    expect(image.hasAttribute('srcset')).toBe(false);
  });

  // The text is a name someone else chose. It becomes text, whatever it contains.
  it('replaces with an element whose text is set, never parsed', () => {
    const root = mount(`<img data-fallback="replace" data-fallback-class="author-avatar-fallback" data-fallback-text="&lt;img src=x onerror=alert(1)&gt;" src="x">`);
    fail(root);
    const replacement = root.querySelector('.author-avatar-fallback')!;
    expect(replacement.tagName).toBe('SPAN');
    expect(replacement.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull();
    const div = mount('<img data-fallback="replace" data-fallback-tag="div" data-fallback-class="wk-ex-img placeholder" src="x">');
    fail(div);
    expect(div.querySelector('div.wk-ex-img.placeholder')).toBeTruthy();
  });

  it('leaves an image without a declared fallback alone', () => {
    const root = mount('<img src="x">');
    handleImageError(root.querySelector('img')!);
    fail(root);
    expect(root.querySelector('img')).toBeTruthy();
  });
});
