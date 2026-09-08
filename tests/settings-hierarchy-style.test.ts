import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');

describe('Settings hierarchy styles', () => {
  it('dims the Settings backdrop without removing the shared grid', () => {
    expect(css).toContain('.settings-page::before');
    expect(css).toContain('rgba(var(--void-rgb), .50)');
    expect(css).toContain('isolation: isolate');
  });

  it('promotes section headers and icons as category anchors', () => {
    expect(css).toMatch(/\.settings-group\s*\{\s*margin-top:\s*30px;/);
    expect(css).toContain('grid-template-columns: 32px minmax(0, 1fr)');
    expect(css).toContain('font-weight: 900');
    expect(css).toContain('letter-spacing: .15em');
    expect(css).toContain('.settings-group-icon {');
    expect(css).toContain('border: 1px solid rgba(var(--accent-rgb), .58)');
  });

  it('makes group containers stronger than internal row dividers', () => {
    expect(css).toContain('border-color: rgba(var(--accent-line-rgb), .36)');
    expect(css).toContain('box-shadow: 0 0 0 1px rgba(var(--accent-rgb), .035)');
    expect(css).toContain('border-top-color: rgba(var(--accent-line-rgb), .14)');
  });

  it('keeps Support on its special accent container instead of flattening it', () => {
    expect(css).toContain('.settings-group-cards--support');
    expect(css).toContain('border-color: rgba(var(--accent-rgb), .52)');
    expect(css).toContain('.settings-group-cards--support .support-panel');
  });
});
