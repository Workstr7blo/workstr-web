import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Two guards, protecting two different mistakes this feature has already made.
//
// 1. Colour must route through tokens. The first Monero Mode shipped tokens that no rule
//    referenced — it looked right in review and did nothing in the browser.
// 2. Monero Mode must only override the creator-payment layer. The second version swapped
//    the app accent and surface ramp too, which repainted navigation, cards, recovery and
//    identity orange and cost Workstr its Nostr identity.
//
// Purple is Workstr/Nostr. Orange is Monero. These tests keep those layers apart.
const root = resolve(__dirname, '..');
const reference = readFileSync(resolve(root, 'src/workstr-reference.css'), 'utf8');
const style = readFileSync(resolve(root, 'src/style.css'), 'utf8');
const all = `${reference}\n${style}`.replace(/\/\*[\s\S]*?\*\//g, '');

// Modules that paint inline SVG `style="fill:..."` and so consume tokens outside the CSS.
const PAINTERS = ['src/app/bodymap.ts', 'src/features/recovery/views.ts'];

// The Workstr/Nostr app theme. Owned by :root, never by a payment mode.
const APP_THEME_TOKENS = [
  '--accent-rgb', '--accent-soft-rgb', '--accent-line-rgb', '--accent-alt-rgb',
  '--accent-deep', '--accent-pale', '--accent', '--accent-soft', '--accent-glow', '--on-accent',
  '--surface-rgb', '--surface-raised-rgb', '--surface-panel-rgb', '--surface-track-rgb',
  '--void-rgb', '--void-deep-rgb', '--void',
  '--chrome-raised', '--chrome-fill', '--chrome-fill-strong', '--chrome-inset',
  '--chrome-body', '--chrome-menu', '--chrome-input',
  '--text', '--muted', '--dim', '--shadow', '--panel', '--border', '--border-hot'
];

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

  it('keeps the Workstr/Nostr identity while changing creator payments', () => {
    const block = all.match(MONERO_BLOCK)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain('--payment-rgb: 255, 102, 0');

    // Everything below belongs to Workstr, not to the payment mode. An active nav item,
    // a selected card or a recovery map means "this is where you are in Workstr" — never
    // "this is Monero" — so none of it may change with the payment mode.
    for (const token of APP_THEME_TOKENS) {
      expect(block, `${token} is Workstr identity and must not change with the payment mode`)
        .not.toMatch(new RegExp(`^\\s*${token}\\s*:`, 'm'));
    }
  });

  it('only overrides creator-payment tokens in Monero Mode', () => {
    const block = all.match(MONERO_BLOCK)?.[0] ?? '';
    const overridden = [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(overridden.length).toBeGreaterThan(0);

    // Fewer overrides are better here: the smaller this block, the more of Workstr survives
    // the mode switch intact.
    const allowed = new Set(['--payment-rgb', '--payment-accent', '--payment-accent-strong', '--on-payment']);
    for (const token of overridden) {
      expect(allowed.has(token), `${token} should not be overridden by Monero Mode`).toBe(true);
    }

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
