import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/app/state';
import { exerciseMetaLine } from '../src/app/exercise-card';
import type { Exercise } from '../src/core/types';
import { discoverCardHtml } from '../src/features/discover/views';
import { exerciseCardHtml } from '../src/features/library/views';

const exercise = (extra: Partial<Exercise> = {}): Exercise => ({
  slug: 'air-bike', name: 'Air Bike', muscle_group: 'Core', difficulty: 'beginner', category: 'strength',
  image_url: 'https://i.nostr.build/air.png', muscles: ['Core', 'Obliques'], equipment: ['Body Weight'], tags: [], instructions: [],
  favourite: false, source_type: 'imported', status: 'active', nostr_address: '33401:op:workstr:exercise:air-bike', nostr_pubkey: 'op',
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...extra
});
const discoverState = { library: [], discoverSelect: { active: false, addresses: new Set() }, authorProfiles: {} } as unknown as AppState;

// What a compact card must never carry any more, in either view.
function expectNoRetiredLabels(card: string): void {
  expect(card).not.toContain('source-badge');
  expect(card).not.toContain('Workstr');
  expect(card).not.toContain('diff-badge');
  expect(card).not.toContain('card-tag');
  expect(card).not.toContain('Strength');
  expect(card).not.toContain('author-pill');
}

describe('Library exercise card', () => {
  it('shows the photo, the name, the muscle and level, and a labelled star', () => {
    const card = exerciseCardHtml(exercise());
    expect(card).toContain('class="card-photo"');
    expect(card).toContain('>Air Bike</span>');
    expect(card).toContain('<span class="muscle">Core</span><span class="card-level level-beginner">Beginner</span>');
    expect(card).toContain('data-fav="air-bike" aria-pressed="false" aria-label="Add Air Bike to favorites"');
    expect(card).toContain('>☆</button>');
    expectNoRetiredLabels(card);
  });

  it('says a favorite can be removed, in words as well as the filled star', () => {
    const card = exerciseCardHtml(exercise({ favourite: true }));
    expect(card).toContain('class="fav on"');
    expect(card).toContain('aria-pressed="true" aria-label="Remove Air Bike from favorites"');
    expect(card).toContain('>★</button>');
  });

  it('keeps the selection tick while selecting', () => {
    expect(exerciseCardHtml(exercise(), true, true)).toContain('class="sel-check"');
    expect(exerciseCardHtml(exercise())).not.toContain('sel-check');
  });
});

describe('Discover exercise card', () => {
  it('uses the same card with the import action and no star', () => {
    const card = discoverCardHtml(exercise(), discoverState);
    expect(card).toContain('>Air Bike</span>');
    expect(card).toContain('<span class="card-level level-beginner">Beginner</span>');
    expect(card).toContain('data-import-address="33401:op:workstr:exercise:air-bike"');
    expect(card).not.toContain('data-fav');
    expect(card).not.toContain('★');
    expectNoRetiredLabels(card);
  });

  it('draws the Library and Discover card bodies from one template', () => {
    const body = (card: string) => card.slice(card.indexOf('<div class="card-body">'), card.indexOf('</div>', card.indexOf('card-meta')));
    const library = body(exerciseCardHtml(exercise())).replace(/<button class="fav[^]*?<\/button>/, '');
    expect(body(discoverCardHtml(exercise(), discoverState))).toBe(library);
  });
});

describe('exerciseMetaLine', () => {
  it('shows only the muscle, or only the level, and never a text separator that could dangle', () => {
    expect(exerciseMetaLine(exercise())).not.toContain('·');
    expect(exerciseMetaLine(exercise({ difficulty: undefined }))).toBe('<div class="card-meta"><span class="muscle">Core</span></div>');
    expect(exerciseMetaLine(exercise({ muscle_group: undefined }))).toBe('<div class="card-meta"><span class="card-level level-beginner">Beginner</span></div>');
  });

  it('omits the line when both are missing', () => {
    expect(exerciseMetaLine(exercise({ muscle_group: '', difficulty: '' }))).toBe('');
    expect(exerciseCardHtml(exercise({ muscle_group: '', difficulty: '' }))).not.toContain('card-meta');
  });

  it('shows an unrecognised level in words with no colour of its own', () => {
    expect(exerciseMetaLine(exercise({ difficulty: 'Beast Mode' }))).toContain('<span class="card-level">Beast Mode</span>');
    expect(exerciseMetaLine(exercise({ difficulty: 'Advanced' }))).toContain('level-advanced');
  });
});
