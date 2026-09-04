// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { libraryPanel } from '../src/features/library/views';
import { discoverPanel } from '../src/features/discover/views';
import { shellMarkup } from '../src/app/layout';
import { exerciseFilterSheet } from '../src/app/exercise-browser';
import { MY_EQUIPMENT } from '../src/core/equipment';
import type { Exercise, WorkstrSettings } from '../src/core/types';
import type { AppState } from '../src/app/state';

function ex(partial: Partial<Exercise>): Exercise {
  return {
    slug: 'x', name: 'X', muscles: [], equipment: [], tags: [], instructions: [],
    favourite: false, source_type: 'manual', status: 'active', ...partial
  } as Exercise;
}

const library = [
  ex({ slug: 'push-up', name: 'Push Up', equipment: ['Body Weight'] }),
  ex({ slug: 'curl', name: 'Curl', equipment: ['Dumbbell'] }),
  ex({ slug: 'snatch', name: 'Snatch', equipment: ['Barbell'] })
];

function state(partial: Partial<AppState> = {}, settings: Partial<WorkstrSettings> = {}): AppState {
  return {
    pubkey: null, npub: null, profileName: null, profileNames: {}, authorProfiles: {}, store: null,
    settings: { unit: 'kg', publicRelays: [], ...settings } as WorkstrSettings,
    signerType: null, view: 'exercises',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [], programs: [], activeSession: null, finishedSessions: [],
    publishingSessionId: null, publishingStatus: null, editingId: null, filter: '',
    programFilter: '', expandedProgramAddress: null, exerciseStatus: '', programStatus: '',
    signInStatus: null, expandedSessionId: null, history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [], sheets: [], library,
    librarySelect: { active: false, slugs: new Set() },
    discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [],
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    ...partial
  } as AppState;
}

describe('equipment filter in the grids', () => {
  // The permanent selects became a filter sheet, so the equipment control is asserted where
  // it lives now. What is guaranteed has not changed: both views offer it, it lists what the
  // grid actually holds, and "My equipment" appears only once a kit exists.
  it('gives both grids a compact toolbar instead of a panel of selects', () => {
    const html = libraryPanel(state());
    const discover = discoverPanel(state({ discoverExercises: library }));
    expect(html).toContain('class="program-toolbar"');
    expect(html).toContain('id="ex-grid" class="ex-grid exercise-library-grid"');
    expect(html).not.toContain('library-filter-chips');
    expect(html).not.toContain('<select');
    expect(discover).toContain('class="program-toolbar"');
    expect(discover).toContain('id="discover-grid" class="ex-grid discover-exercise-grid"');
    expect(discover).not.toContain('discover-filter-chips');
    expect(discover).not.toContain('<select');
  });

  it('offers an equipment group in each view\'s filter sheet', () => {
    const library = exerciseFilterSheet(state({ exerciseFilterSheet: 'library' }));
    const discover = exerciseFilterSheet(state({ exerciseFilterSheet: 'discover', discoverExercises: [] }));
    expect(library).toContain('id="exercise-filter-group-equip"');
    expect(discover).toContain('id="exercise-filter-group-equip"');
  });

  it('lists each equipment value found in the grid', () => {
    const html = exerciseFilterSheet(state({ exerciseFilterSheet: 'library' }));
    expect(html).toContain('>Body Weight<');
    expect(html).toContain('>Dumbbell<');
    expect(html).toContain('>Barbell<');
  });

  it('offers My equipment only once a kit is saved', () => {
    expect(exerciseFilterSheet(state({ exerciseFilterSheet: 'library' }))).not.toContain('My equipment');
    expect(exerciseFilterSheet(state({ exerciseFilterSheet: 'library' }, { ownedEquipment: ['dumbbell'] }))).toContain('My equipment');
  });

  it('narrows the grid to the kit and keeps the empty state honest', () => {
    const html = libraryPanel(state(
      { exFilter: { cat: '', muscle: '', diff: '', equip: MY_EQUIPMENT } },
      { ownedEquipment: ['dumbbell'] }
    ));
    expect(html).toContain('data-slug="curl"');
    expect(html).not.toContain('data-slug="snatch"');
    // A filtered-away grid must say so rather than offering the first-run copy.
    const none = libraryPanel(state(
      { exFilter: { cat: '', muscle: '', diff: '', equip: 'kettlebell' } },
      { ownedEquipment: ['dumbbell'] }
    ));
    expect(none).toContain('No exercises match.');
  });
});

describe('My equipment settings panel', () => {
  const settingsState = (partial: Partial<WorkstrSettings> = {}) =>
    shellMarkup(state({ view: 'settings' }, partial));

  it('renders one checkbox per equipment value, ticking the saved kit', () => {
    const html = settingsState({ ownedEquipment: ['dumbbell'] });
    expect(html).toContain('value="dumbbell" checked');
    expect(html).toContain('value="barbell"');
    expect(html).not.toContain('value="barbell" checked');
  });

  it('offers no checkbox for bodyweight, which is not something you own', () => {
    expect(settingsState({ ownedEquipment: ['dumbbell'] })).not.toContain('value="body weight"');
  });

  it('summarises how many are selected, ignoring bodyweight', () => {
    expect(settingsState({ ownedEquipment: ['dumbbell', 'barbell'] })).toContain('2 selected');
    expect(settingsState({ ownedEquipment: ['dumbbell', 'body weight'] })).toContain('1 selected');
    expect(settingsState()).toContain('0 selected');
  });

  it('explains itself when nothing in the library lists equipment', () => {
    const html = shellMarkup(state({ view: 'settings', library: [ex({})], discoverExercises: [] }));
    expect(html).toContain('No equipment listed yet');
  });

  it('offers catalog equipment before it has been imported', () => {
    const html = shellMarkup(state({
      view: 'settings',
      library: [],
      discoverExercises: [ex({ equipment: ['Kettlebell'] })]
    }));
    expect(html).toContain('value="kettlebell"');
  });
});
