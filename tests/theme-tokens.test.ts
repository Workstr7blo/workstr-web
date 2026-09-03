import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Monero Mode repaints the app purely by overriding channel tokens. That only works while
// the stylesheets keep routing colour through those tokens, so these guards fail loudly if
// a raw theme literal creeps back in or an override stops being consumed. The first version
// of Monero Mode shipped tokens that no rule referenced, which looked correct in review and
// did nothing in the browser.
const root = resolve(__dirname, '..');
const reference = readFileSync(resolve(root, 'src/workstr-reference.css'), 'utf8');
const style = readFileSync(resolve(root, 'src/style.css'), 'utf8');
const all = `${reference}\n${style}`.replace(/\/\*[\s\S]*?\*\//g, '');

// Modules that paint inline SVG `style="fill:..."` and so consume tokens outside the CSS.
const PAINTERS = ['src/app/bodymap.ts', 'src/features/recovery/views.ts'];

const MONERO_BLOCK = /:root\[data-payment-mode="monero"\]\s*\{[^}]*\}/;
// Colour literals are legal in exactly two places: the `:root` token definitions and the
// Monero override. Everywhere else a rule must reach for a token.
const rules = all.replace(MONERO_BLOCK, '').replace(/:root\s*\{[^}]*\}/, '');
const outsideOverride = all.replace(MONERO_BLOCK, '');

describe('theme tokens', () => {
  it('routes every purple theme colour through a channel token', () => {
    const literals = rules.match(
      /rgba?\(\s*(124\s*,\s*60\s*,\s*255|188\s*,\s*151\s*,\s*255|181\s*,\s*140\s*,\s*255|168\s*,\s*85\s*,\s*247)/g
    );
    expect(literals ?? []).toEqual([]);
    expect(rules).not.toMatch(/#4d1fd1/i);
  });

  it('defines the Monero override and actually changes the accent channel', () => {
    const block = all.match(MONERO_BLOCK)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain('--accent-rgb: 255, 102, 0');
    expect(block).toContain('--payment-rgb: 255, 102, 0');
    // Light grey, not orange: most --accent-soft usages are body text.
    expect(block).toContain('--accent-soft-rgb: 229, 229, 229');
  });

  it('has no override token that nothing consumes', () => {
    const block = all.match(MONERO_BLOCK)?.[0] ?? '';
    const overridden = [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(overridden.length).toBeGreaterThan(10);

    // Tokens are consumed by CSS rules, by another token's value, or by the modules that
    // paint inline SVG fills.
    const consumers = [outsideOverride, PAINTERS.map((f) => readFileSync(resolve(root, f), 'utf8')).join('\n')].join('\n');
    const orphans = overridden.filter((token) => !consumers.includes(`var(${token})`));
    expect(orphans).toEqual([]);
  });

  it('keeps the payment accent separate from the training gold action colour', () => {
    // --bitcoin-gold doubles as the log/train action colour, so Monero Mode must not move it.
    const block = all.match(MONERO_BLOCK)?.[0] ?? '';
    expect(block).not.toMatch(/^\s*--bitcoin-gold\s*:/m);
    expect(reference).toMatch(/--payment-accent:\s*rgb\(var\(--payment-rgb\)\)/);
  });

  it('paints inline SVG fills from tokens too', () => {
    // The body map and recovery map set `style="fill:..."` from TypeScript. Literals there
    // bypass the stylesheet entirely, so Monero Mode left them purple until this was fixed.
    for (const file of PAINTERS) {
      const source = readFileSync(resolve(root, file), 'utf8');
      const inlineFills = [...source.matchAll(/(?:fill|stroke):\s*(#[0-9a-f]{3,6})/gi)].map((m) => m[1]);
      expect(inlineFills, `${file} paints an inline fill from a literal`).toEqual([]);
    }
    const recovery = readFileSync(resolve(root, 'src/features/recovery/views.ts'), 'utf8');
    expect(recovery).toContain("untrained: 'var(--chrome-raised)'");
  });

  it('drives the theme from :root so the token override can win', () => {
    const shell = readFileSync(resolve(root, 'src/app/shell.ts'), 'utf8');
    expect(shell).toContain("document.documentElement.setAttribute('data-payment-mode', 'monero')");
    expect(all).not.toMatch(/body\[data-payment-mode/);
  });
});
