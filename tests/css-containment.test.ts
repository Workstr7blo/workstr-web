import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A decoration that overhangs its own card has to be contained by that card.
//
// `.support-panel::after` is a glow deliberately positioned outside the panel's edges
// (`right: -12%`). The panel set `overflow: hidden` to clip it and never set
// `position: relative`, so the glow resolved against `.content` instead - which is
// `position: fixed`, and therefore the nearest positioned ancestor. `-12%` then meant 12%
// of the whole pane rather than of the card: on a 390px phone the glow hung 47px past the
// right edge, `.content` became 47px wider than the viewport, and the entire Settings page
// could be dragged sideways. The panel's own `overflow: hidden` had never applied to it,
// and neither had `.settings-category { overflow: clip }`, because an absolutely positioned
// box is only clipped by ancestors inside its containing block chain.
//
// The guard is the general rule rather than that one selector: a pseudo-element positioned
// absolutely must have a base rule that establishes a containing block for it.
const root = resolve(__dirname, '..');
const sources = ['src/workstr-reference.css', 'src/style.css'];

const POSITIONED = /position:\s*(relative|absolute|fixed|sticky)/;

interface Rule { file: string; selector: string; body: string }

function rules(file: string): Rule[] {
  const css = readFileSync(resolve(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    found.push({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] });
  }
  return found;
}

const all = sources.flatMap(rules);

// `.a .b::after` -> `.a .b`, so the element the pseudo-element hangs off can be looked up.
const baseSelector = (selector: string): string => selector.replace(/::?(after|before)\b.*$/, '').trim();

// The classes on the element itself, ignoring its ancestors: `.a .b.c` -> {b, c}. A rule for
// `.nav-item` establishes the containing block for `.nav-item.active::before`, so matching
// has to be by subset rather than by identical selector text.
const targetTokens = (selector: string): Set<string> => {
  const last = selector.split(/[\s>+~]+/).filter(Boolean).pop() || '';
  return new Set(last.match(/[.#]?[\w-]+/g) || []);
};

const appliesTo = (candidate: string, base: Set<string>): boolean => {
  const tokens = targetTokens(candidate);
  return tokens.size > 0 && [...tokens].every((token) => base.has(token));
};

describe('absolutely positioned decorations', () => {
  it('are contained by the element they decorate', () => {
    const escaping = all
      .filter((rule) => /::(after|before)/.test(rule.selector) && /position:\s*absolute/.test(rule.body))
      .flatMap((rule) => rule.selector.split(',').map((one) => ({ rule, base: baseSelector(one) })))
      .filter(({ base }) => base.length > 0)
      .filter(({ base }) => {
        // Everything that can position this element: its own rule, and any rule for a
        // looser form of it.
        const tokens = targetTokens(base);
        const declarations = all
          .filter((candidate) => candidate.selector.split(',').some((one) => appliesTo(one.trim(), tokens)))
          .map((candidate) => candidate.body)
          .join(' ');
        return !POSITIONED.test(declarations);
      })
      .map(({ rule, base }) => `${rule.file}: ${base} (for ${rule.selector})`);

    expect(escaping).toEqual([]);
  });

  // The specific regression, named so a future edit that drops the line is obvious.
  it('keeps the support glow inside the support panel', () => {
    const panel = all.find((rule) => rule.selector.split(',').some((one) => one.trim() === '.support-panel'));
    expect(panel).toBeDefined();
    expect(panel!.body).toMatch(POSITIONED);
    expect(panel!.body).toMatch(/overflow:\s*hidden/);
  });
});

describe('the main scroll pane', () => {
  // Vertical scrolling is the architecture; horizontal panning is always a bug here.
  it('scrolls vertically and never horizontally', () => {
    const content = all.find((rule) => rule.selector.split(',').some((one) => one.trim() === '.content'));
    expect(content).toBeDefined();
    expect(content!.body).toMatch(/overflow-y:\s*auto/);
    expect(content!.body).toMatch(/overflow-x:\s*hidden/);
  });
});
