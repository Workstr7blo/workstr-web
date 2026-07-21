import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  html, shortNpub, displayIdentity, displayPubkey, difficultyBadgeClass,
  exerciseSourceLabel, exerciseCanonMuscleSet, exerciseFilterValues, filterExercises,
  fillSelectHtml, formatSessionDate, formatMinutes, exerciseImage, programMuscleLabel
} from '../src/app/format';
import type { Exercise } from '../src/core/types';
import type { AppState } from '../src/app/state';

const PUBKEY = 'ab'.repeat(32);

function ex(partial: Partial<Exercise>): Exercise {
  return {
    slug: 'x', name: 'X', muscles: [], equipment: [], tags: [], instructions: [],
    favourite: false, source_type: 'manual', status: 'active', ...partial
  } as Exercise;
}

describe('html', () => {
  it('escapes all five HTML-sensitive characters', () => {
    expect(html(`<a href="x" class='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('renders null/undefined as empty string', () => {
    expect(html(null)).toBe('');
    expect(html(undefined)).toBe('');
    expect(html(0)).toBe('0');
  });
});

describe('npub helpers', () => {
  it('shortNpub abbreviates the encoded npub', () => {
    const npub = nip19.npubEncode(PUBKEY);
    expect(shortNpub(PUBKEY)).toBe(`${npub.slice(0, 12)}...${npub.slice(-8)}`);
  });
  it('displayPubkey falls back to a hex slice on invalid input', () => {
    expect(displayPubkey('not-hex')).toBe('not-hex…');
  });
});

describe('displayIdentity', () => {
  it('is empty when signed out', () => {
    expect(displayIdentity({ pubkey: null } as AppState)).toBe('');
  });
  it('prefers the profile name, else the short npub', () => {
    expect(displayIdentity({ pubkey: PUBKEY, profileName: 'Alice' } as AppState)).toBe('Alice');
    expect(displayIdentity({ pubkey: PUBKEY, profileName: null } as AppState)).toBe(shortNpub(PUBKEY));
  });
});

describe('difficultyBadgeClass', () => {
  it('maps known difficulties and defaults to unknown', () => {
    expect(difficultyBadgeClass('Beginner')).toBe('diff-beginner');
    expect(difficultyBadgeClass('advanced')).toBe('diff-advanced');
    expect(difficultyBadgeClass('')).toBe('diff-unknown');
    expect(difficultyBadgeClass(undefined)).toBe('diff-unknown');
  });
});

describe('exerciseSourceLabel', () => {
  it('labels catalog sources as Workstr, ai as ai, else manual', () => {
    expect(exerciseSourceLabel(ex({ source_type: 'ai' }))).toBe('ai');
    for (const s of ['nostr', 'imported', 'bundle', 'premium'] as const) {
      expect(exerciseSourceLabel(ex({ source_type: s }))).toBe('Workstr');
    }
    expect(exerciseSourceLabel(ex({ source_type: 'manual' }))).toBe('manual');
  });
});

describe('exerciseCanonMuscleSet', () => {
  it('canonicalizes the primary group plus every listed muscle, dropping unknowns', () => {
    const set = exerciseCanonMuscleSet(ex({ muscle_group: 'lats', muscles: ['biceps', 'nonsense'] }));
    expect([...set].sort()).toEqual(['Back', 'Biceps']);
  });
});

describe('exerciseFilterValues', () => {
  it('collects sorted unique categories, canonical muscles, and difficulties', () => {
    const values = exerciseFilterValues([
      ex({ category: 'Strength', difficulty: 'beginner', muscle_group: 'chest' }),
      ex({ category: 'Cardio', difficulty: 'advanced', muscle_group: 'lats', muscles: ['chest'] })
    ]);
    expect(values.categories).toEqual(['Cardio', 'Strength']);
    expect(values.difficulties).toEqual(['advanced', 'beginner']);
    expect(values.muscles).toEqual(['Back', 'Chest']);
  });
});

describe('filterExercises', () => {
  const list = [
    ex({ name: 'Barbell Bench Press', muscle_group: 'chest', category: 'Strength', difficulty: 'beginner' }),
    ex({ name: 'Pull Up', muscle_group: 'lats', category: 'Bodyweight', difficulty: 'advanced' })
  ];
  it('matches query against name or muscle group, case-insensitively', () => {
    expect(filterExercises(list, 'bench', '', '', '').map((e) => e.name)).toEqual(['Barbell Bench Press']);
    expect(filterExercises(list, 'LATS', '', '', '').map((e) => e.name)).toEqual(['Pull Up']);
  });
  it('filters by category, canonical muscle, and difficulty', () => {
    expect(filterExercises(list, '', 'Strength', '', '').map((e) => e.name)).toEqual(['Barbell Bench Press']);
    expect(filterExercises(list, '', '', 'Back', '').map((e) => e.name)).toEqual(['Pull Up']);
    expect(filterExercises(list, '', '', '', 'advanced').map((e) => e.name)).toEqual(['Pull Up']);
  });
  it('returns everything when no filters are set', () => {
    expect(filterExercises(list, '', '', '', '')).toHaveLength(2);
  });
});

describe('fillSelectHtml', () => {
  it('renders an all-option plus one option per value, marking the current selection', () => {
    const out = fillSelectHtml('cat', ['A', 'B'], 'All', 'B');
    expect(out).toContain('<select id="cat">');
    expect(out).toContain('<option value="">All</option>');
    expect(out).toContain('<option value="B" selected>B</option>');
    expect(out).toContain('<option value="A" >A</option>');
  });
});

describe('formatSessionDate', () => {
  it('formats a valid ISO date and passes through invalid input', () => {
    expect(formatSessionDate('2026-07-20T10:00:00Z')).toMatch(/2026/);
    expect(formatSessionDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatMinutes', () => {
  it('renders minutes and hours, and empty for zero', () => {
    expect(formatMinutes(0)).toBe('');
    expect(formatMinutes(90)).toBe('2 min');
    expect(formatMinutes(1800)).toBe('30 min');
    expect(formatMinutes(3600)).toBe('1h');
    expect(formatMinutes(5400)).toBe('1h 30m');
  });
});

describe('exerciseImage', () => {
  it('renders an img for a src and a placeholder otherwise', () => {
    expect(exerciseImage('https://x/y.png')).toContain('<img class="wk-ex-img" src="https://x/y.png"');
    expect(exerciseImage()).toContain('placeholder');
    expect(exerciseImage()).not.toContain('<img');
  });
  it('escapes the src attribute', () => {
    expect(exerciseImage('"><script>')).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('programMuscleLabel', () => {
  it('folds arm and shoulder synonyms, passes other values through', () => {
    expect(programMuscleLabel('biceps')).toBe('Arms');
    expect(programMuscleLabel('Lateral Deltoid')).toBe('Shoulders');
    expect(programMuscleLabel('Chest')).toBe('Chest');
    expect(programMuscleLabel('')).toBe('');
  });
});
