import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const styleCss = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');
const referenceCss = readFileSync(resolve(__dirname, '../src/workstr-reference.css'), 'utf8');
const css = `${styleCss}\n${referenceCss}`;

describe('Settings hierarchy styles', () => {
  it('dims the Settings backdrop without removing the shared grid', () => {
    expect(styleCss).toContain('.settings-page::before');
    expect(styleCss).toContain('rgba(var(--void-rgb), .42)');
    expect(styleCss).toContain('isolation: isolate');
  });

  it('uses compact labels instead of icon-heavy section anchors', () => {
    expect(styleCss).toMatch(/\.settings-group\s*\{\s*margin-top:\s*22px;/);
    expect(styleCss).toMatch(/\.settings-category > summary\s*\{\s*min-height:\s*54px;\s*padding:\s*9px 12px;/);
    expect(styleCss).not.toContain('grid-template-columns: 32px minmax(0, 1fr)');
    expect(styleCss).not.toContain('border: 1px solid rgba(var(--accent-rgb), .58)');
    expect(styleCss).not.toContain('text-shadow: 0 0 18px');
  });

  it('keeps group containers restrained and internal dividers quiet', () => {
    expect(styleCss).toContain('border-color: rgba(var(--accent-line-rgb), .22)');
    expect(styleCss).toContain('border-top-color: rgba(var(--accent-line-rgb), .12)');
    expect(styleCss).not.toContain('0 0 30px rgba(var(--accent-rgb), .14)');
  });

  it('gives Security rows dedicated responsive classes instead of account-row mobile layout', () => {
    expect(css).toContain('.security-settings-list');
    expect(css).toContain('.security-setting-row');
    expect(css).toContain('.security-account-actions');
    expect(referenceCss).toContain('.security-setting-row { grid-template-columns: minmax(0, 1fr) max-content; align-items: center; }');
    expect(referenceCss).toContain('.security-setting-row--select, .security-setting-row--danger { grid-template-columns: minmax(0, 1fr); align-items: stretch; }');
    expect(referenceCss).not.toContain('.account-row { align-items: center; flex-direction: row; }');
  });

  it('keeps Support standalone and compact while reserving payment treatment for the expanded body', () => {
    expect(styleCss).toContain('.support-standalone { margin-top: 18px; padding: 0;');
    expect(styleCss).toContain('.support-standalone::after { display: none; }');
    expect(styleCss).toContain('.support-standalone[open]');
    expect(styleCss).not.toContain('.settings-group-cards--support .support-panel');
  });
});
