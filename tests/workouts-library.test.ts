import { describe, expect, it } from 'vitest';
import { programLibraryHero, subTabs } from '../src/app/layout';
import type { AppState } from '../src/app/state';

const ME = 'f'.repeat(64);

describe('Workouts Library', () => {
  it('labels the tab Library while keeping the stored sub-view key', () => {
    const tabs = subTabs('workouts', 'programs', [{ label: 'Library', value: 'programs' }, 'Discover']);
    expect(tabs).toContain('class="sub-tab active" data-parent="workouts" data-subtab="programs">Library<');
    expect(tabs).toContain('data-subtab="discover">Discover<');
  });

  it('heads the list like the Exercise library, with whole-library counts', () => {
    const state = {
      pubkey: ME,
      sheets: [
        { id: 1, name: 'A', nostr_pubkey: ME, nostr_address: `33402:${ME}:a`, exercises: [{ exercise_slug: 'squat' }, { exercise_slug: 'row' }] },
        { id: 2, name: 'B', exercises: [{ exercise_slug: 'squat' }] }
      ]
    } as unknown as AppState;
    const hero = programLibraryHero(state);
    expect(hero).toContain('class="exercise-hero"');
    expect(hero).toContain('Program library');
    expect(hero).toContain('<strong>2</strong> programs');
    expect(hero).toContain('<strong>1</strong> published');
    expect(hero).toContain('<strong>2</strong> exercises');
  });
});
