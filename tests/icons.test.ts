import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { icon } from '../src/app/icons';
import { ICON_PATHS, type IconName } from '../src/app/icon-paths';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('icon rendering', () => {
  it('gives every icon one stroke weight, one set of caps and joins, and its Lucide name', () => {
    const svg = icon('chevron-down');
    expect(svg).toContain('data-icon="chevron-down"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain(ICON_PATHS['chevron-down']);
  });

  it('is decorative unless it is given something to say', () => {
    expect(icon('star')).toContain('aria-hidden="true"');
    expect(icon('star')).toContain('focusable="false"');
    expect(icon('star')).not.toContain('role="img"');

    const labelled = icon('star', { label: 'Favourite' });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Favourite"');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('carries the class, id and explicit size a caller asks for', () => {
    const svg = icon('flame', { id: 'stat-streak-flame', class: 'flame active', size: 16 });
    expect(svg).toContain('id="stat-streak-flame"');
    expect(svg).toContain('class="flame active"');
    expect(svg).toContain('width="16" height="16"');
  });

  it('fills the geometry for a solid glyph', () => {
    expect(icon('play', { filled: true })).toContain('fill="currentColor"');
    expect(icon('play')).toContain('fill="none"');
  });

  it('escapes a label so it cannot close the attribute it sits in', () => {
    const svg = icon('info', { label: 'Sets & reps" onload="alert(1)' });
    expect(svg).toContain('aria-label="Sets &amp; reps&quot; onload=&quot;alert(1)"');
    expect(svg).not.toContain('onload="alert(1)"');
  });

  it('renders every generated icon', () => {
    for (const name of Object.keys(ICON_PATHS) as IconName[]) {
      expect(ICON_PATHS[name]).not.toBe('');
      expect(icon(name)).toMatch(/^<svg[^>]*>.+<\/svg>$/);
    }
  });
});

describe('the generated icon set', () => {
  it('holds exactly the names the generator is asked for, so a manifest edit cannot ship unregenerated', () => {
    const script = fs.readFileSync(path.join(root, 'scripts/generate-icons.mjs'), 'utf8');
    const manifest = script.slice(script.indexOf('const ICONS = ['), script.indexOf('];'));
    const requested = [...manifest.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]).sort();
    expect(Object.keys(ICON_PATHS).sort()).toEqual(requested);
  });
});

// Hand-written interface SVG is what #287 removed. These files keep theirs on purpose, and
// each is artwork or data rather than an icon: a body map, a currency mark, a composed badge,
// progress rings, a trend chart, and the renderer itself.
const HAND_DRAWN_SVG = [
  'src/app/bodymap.ts',
  'src/app/icons.ts',
  'src/app/layout.ts',
  'src/app/monero-mark.ts',
  'src/app/piggy-bank.ts',
  'src/features/monero/tip-jar-view.ts',
  'src/features/progress/views.ts',
  'src/features/recovery/views.ts',
  'src/features/train/emom-session-view.ts'
];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [path.relative(root, full)] : [];
  });
}

describe('no new hand-written interface icons', () => {
  it('keeps inline SVG to the files that draw something an icon cannot', () => {
    const offenders = sourceFiles(path.join(root, 'src'))
      .filter((file) => !HAND_DRAWN_SVG.includes(file))
      .filter((file) => fs.readFileSync(path.join(root, file), 'utf8').includes('<svg'));
    expect(offenders).toEqual([]);
  });

  it('lists only files that still exist and still draw one', () => {
    for (const file of HAND_DRAWN_SVG) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).toContain('<svg');
    }
  });
});
