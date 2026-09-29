import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const styleCss = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');
const referenceCss = readFileSync(resolve(__dirname, '../src/workstr-reference.css'), 'utf8');
const settingsCss = readFileSync(resolve(__dirname, '../src/settings.css'), 'utf8');

describe('Settings hierarchy styles', () => {
  it('dims the Settings backdrop without removing the shared grid', () => {
    expect(styleCss).toContain('.settings-page::before');
    expect(styleCss).toContain('rgba(var(--void-rgb), .42)');
    expect(styleCss).toContain('isolation: isolate');
  });

  // Every card header leads with an icon tile and ends in a Lucide chevron, and an open
  // card pins its header so a long body never loses its name.
  it('gives every card header an icon tile, a chevron, and a pinned open state', () => {
    expect(settingsCss).toContain('grid-template-columns: 34px minmax(0, 1fr) auto 18px;');
    expect(settingsCss).toMatch(/\.settings-category\[open\] > summary \{[^}]*position: sticky;/);
    expect(settingsCss).toContain('.settings-category[open] > summary .settings-category-chevron { transform: rotate(180deg);');
    // The old text glyph chevrons are gone from every stylesheet.
    for (const sheet of [styleCss, referenceCss, settingsCss]) expect(sheet).not.toContain("content: '\\203A'");
  });

  it('keeps group containers restrained and internal dividers quiet', () => {
    expect(styleCss).toContain('border-color: rgba(var(--accent-line-rgb), .22)');
    expect(styleCss).toContain('border-top-color: rgba(var(--accent-line-rgb), .12)');
    expect(styleCss).not.toContain('0 0 30px rgba(var(--accent-rgb), .14)');
  });

  it('draws every in-card action as one row shape with its control on the right', () => {
    expect(settingsCss).toContain('.settings-row,\n.security-setting-row,\n.training-preference {');
    expect(settingsCss).toContain('.settings-row-button');
    expect(settingsCss).toContain('.security-setting-row--select { grid-template-columns: minmax(0, 1fr); align-items: stretch; }');
  });

  it('frames Support like a group without the payment glow', () => {
    expect(settingsCss).toContain('.support-standalone {');
    expect(settingsCss).toContain('.support-standalone::after { display: none; }');
    expect(styleCss).not.toContain('.settings-group-cards--support .support-panel');
  });
});
