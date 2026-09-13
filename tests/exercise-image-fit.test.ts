import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exerciseImage } from '../src/app/format';
import type { AppState } from '../src/app/state';
import type { Exercise } from '../src/core/types';
import { discoverCardHtml } from '../src/features/discover/views';
import { exerciseCardHtml } from '../src/features/library/views';
import { sessionHeroMedia } from '../src/features/train/session-hero';

// Exercise art is 4:3 and every surface that shows it has its own frame: 16:10 cards, a 16:9
// detail, square rows and a 16:7 session hero. `cover` cropped each one differently, so the
// frames stay and the fit changes. jsdom cannot compute styles, so the cascade is read here
// in the order the app loads it.
const root = resolve(__dirname, '..');
const SOURCES = ['src/workstr-reference.css', 'src/style.css'];

function declarations(selector: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of SOURCES) {
    const css = readFileSync(resolve(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].split(',').map((one) => one.trim().replace(/\s+/g, ' '));
      if (!selectors.includes(selector)) continue;
      for (const declaration of match[2].split(';')) {
        const [property, ...value] = declaration.split(':');
        if (property.trim() && value.length) result.set(property.trim(), value.join(':').trim());
      }
    }
  }
  return result;
}

function expectContained(selector: string, background = selector): void {
  const rule = declarations(selector);
  expect(rule.get('object-fit'), `${selector} object-fit`).toBe('contain');
  expect(rule.get('object-position'), `${selector} object-position`).toBe('center');
  expect(declarations(background).get('background'), `${background} background`).toBe('#000');
}

describe('exercise image frames', () => {
  it('keeps Library and Discover cards at 16:10 and contains their photos', () => {
    expect(declarations('.library-panel .card-img').get('aspect-ratio')).toBe('16 / 10');
    expect(declarations('.discover-exercise-panel .card-img').get('aspect-ratio')).toBe('16 / 10');
    expectContained('.card-img img');
  });

  it('leaves the 4:3 editor preview as it was', () => {
    const frame = declarations('.image-preview');
    expect([frame.get('width'), frame.get('height')]).toEqual(['96px', '72px']);
    expect(declarations('.image-preview img').get('object-fit')).toBe('cover');
  });

  it('keeps the exercise detail at 16:9 and contains its photo', () => {
    expect(declarations('.detail-img').get('aspect-ratio')).toBe('16 / 9');
    expectContained('.detail-img img');
  });

  it('keeps program and builder thumbnails square at their sizes and contains them', () => {
    const row = declarations('.wk-ex-img');
    expect([row.get('width'), row.get('height')]).toEqual(['40px', '40px']);
    expectContained('.wk-ex-img', '.wk-ex-img:not(.placeholder)');
    const builder = declarations('.wex-img');
    expect([builder.get('width'), builder.get('height')]).toEqual(['48px', '48px']);
    expectContained('.wex-img', '.wex-img:not(.placeholder)');
  });

  it('keeps the live-session hero at 16:7 and contains it, with a compact placeholder', () => {
    expect(declarations('.session-ex-image.wide').get('aspect-ratio')).toBe('16 / 7');
    expectContained('.session-ex-image.wide', '.session-ex-image.wide:not(.placeholder)');
    expect(declarations('.session-ex-image.wide.placeholder').get('height')).toBe('54px');
  });

  // Black belongs to a real picture. A placeholder keeps its own quiet background and icon.
  it('never paints a placeholder black', () => {
    for (const selector of ['.wk-ex-img.placeholder', '.wex-img.placeholder', '.detail-img.placeholder', '.session-ex-image.wide.placeholder']) {
      expect(declarations(selector).get('background'), selector).not.toBe('#000');
    }
    expect(declarations('.wk-ex-img').get('background')).not.toBe('#000');
    expect(declarations('.wex-img').get('background')).not.toBe('#000');
  });

  it('adds no blurred backdrop behind exercise images', () => {
    const css = SOURCES.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
    const imageRules = [...css.matchAll(/([^{}]*(?:card-photo|card-img|detail-img|wk-ex-img|wex-img|session-ex-image)[^{}]*)\{([^{}]*)\}/g)];
    expect(imageRules.length).toBeGreaterThan(0);
    expect(imageRules.filter((rule) => /blur\(/.test(rule[2])).map((rule) => rule[1].trim())).toEqual([]);
  });
});

describe('exercise image markup', () => {
  const exercise = { slug: 'jumping-jack', name: 'Jumping Jack', image_url: 'https://i.nostr.build/jack.png', difficulty: 'beginner', category: 'cardio', muscles: [], equipment: [], tags: [], instructions: [] } as unknown as Exercise;
  const imgCount = (markup: string) => (markup.match(/<img\b/g) || []).length;

  it('draws one photo over the placeholder on Library and Discover cards', () => {
    const state = { library: [], discoverSelect: { active: false, addresses: new Set() }, authorProfiles: {} } as unknown as AppState;
    for (const card of [exerciseCardHtml(exercise), discoverCardHtml(exercise, state)]) {
      expect(imgCount(card)).toBe(1);
      expect(card).toContain('class="card-placeholder"');
      expect(card).toContain('class="card-photo" src="https://i.nostr.build/jack.png?w=360"');
      expect(card).toContain('onerror="this.remove()"');
    }
  });

  it('keeps the row thumbnail fallback', () => {
    expect(exerciseImage('')).toContain('wk-ex-img placeholder');
    expect(exerciseImage('https://x/y.png')).toContain("className:'wk-ex-img placeholder'");
  });

  it('draws the hero once, responsive, named, and falls back to the placeholder', () => {
    const hero = sessionHeroMedia({ imageUrl: 'https://i.nostr.build/jack.png' } as never, 'Jumping Jack');
    expect(imgCount(hero)).toBe(1);
    expect(hero).toContain('class="session-ex-image wide"');
    expect(hero).toContain('srcset="');
    expect(hero).toContain('alt="Jumping Jack"');
    expect(hero).toContain("this.classList.add('placeholder')");
    expect(sessionHeroMedia(undefined, 'Jumping Jack')).toBe('<div class="session-ex-image wide placeholder">No image</div>');
  });

  it('shares that one hero between the standard and EMOM runners', () => {
    for (const file of ['src/features/train/standard-session-view.ts', 'src/features/train/emom-session-view.ts']) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source, file).toContain('sessionHeroMedia(');
      expect(source, file).not.toContain('session-ex-image');
    }
  });
});
