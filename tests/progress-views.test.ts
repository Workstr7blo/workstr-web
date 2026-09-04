import { describe, expect, it } from 'vitest';
import { bmiMarkup, bodyChartMarkup, bodyView, trainingStatsView } from '../src/features/progress/views';
import type { AppState } from '../src/app/state';
import type { BodyWeightEntry } from '../src/core/types';

function bodyState(entries: BodyWeightEntry[], extra: Partial<AppState['settings']> = {}): AppState {
  return {
    settings: { unit: 'kg', publicRelays: [], ...extra }, bodyEntries: entries
  } as unknown as AppState;
}

describe('bmiMarkup', () => {
  it('labels each BMI zone by threshold', () => {
    expect(bmiMarkup(17)).toContain('Underweight');
    expect(bmiMarkup(22)).toContain('22.0 · Normal');
    expect(bmiMarkup(27)).toContain('Overweight');
    expect(bmiMarkup(32)).toContain('Obese');
  });
  it('clamps the marker position to the 15–40 bar range', () => {
    expect(bmiMarkup(10)).toContain('left:0.0%');
    expect(bmiMarkup(50)).toContain('left:100.0%');
  });
});

describe('bodyChartMarkup', () => {
  const entry = (date: string, weight_kg: number): BodyWeightEntry => ({ date, weight_kg });
  it('renders nothing with fewer than two points', () => {
    expect(bodyChartMarkup([], 'kg')).toBe('');
    expect(bodyChartMarkup([entry('2026-01-01', 70)], 'kg')).toBe('');
  });
  it('renders an svg trend with a polyline and entry count for two or more points', () => {
    const out = bodyChartMarkup([entry('2026-01-01', 70), entry('2026-01-08', 72)], 'kg');
    expect(out).toContain('<svg');
    expect(out).toContain('<polyline');
    expect(out).toContain('2 entries');
  });
});

describe('bodyView', () => {
  it('shows the empty state with no entries, and shows it once', () => {
    const out = bodyView(bodyState([]));
    expect(out).toContain('id="body-empty" class="empty" style="display:"');
    // The list used to carry a second "No entries yet." of its own, about 400px below the
    // first one, so an empty Body said it twice.
    expect(out.match(/No entries yet/g)).toHaveLength(1);
    expect(out).toContain('Log your weight below');
  });

  it('keeps the list node present but empty so the shell can patch it', () => {
    const out = bodyView(bodyState([]));
    expect(out).toContain('id="body-list"');
    expect(out).toContain('<div id="body-list" class="list" hidden></div>');
  });

  it('puts the entry list with its own data, not between the two forms', () => {
    const out = bodyView(bodyState([
      { date: '2026-01-10', weight_kg: 72 },
      { date: '2026-01-01', weight_kg: 70 }
    ]));
    expect(out).toContain('<span>Entries</span>');
    // chart -> list -> log form -> profile form
    expect(out.indexOf('id="body-list"')).toBeLessThan(out.indexOf('id="body-form"'));
    expect(out.indexOf('id="body-form"')).toBeLessThan(out.indexOf('id="body-profile-form"'));
  });

  it('heads the list only when there is something in it', () => {
    expect(bodyView(bodyState([]))).not.toContain('<span>Entries</span>');
  });

  it('computes current, 7-day average, and total change (newest-first input)', () => {
    const out = bodyView(bodyState([
      { date: '2026-01-10', weight_kg: 72 },
      { date: '2026-01-01', weight_kg: 70 }
    ]));
    expect(out).toContain('<div class="body-card-val">72.0</div>'); // current = latest by date
    expect(out).toContain('<div class="body-card-val">71.0</div>'); // 7-day avg = (70+72)/2
    expect(out).toContain('+2.0'); // total change since first
  });

  it('renders BMI when height is set and goal progress when a target is set', () => {
    const out = bodyView(bodyState([
      { date: '2026-01-10', weight_kg: 72 },
      { date: '2026-01-01', weight_kg: 70 }
    ], { heightCm: 180, targetWeightKg: 75 }));
    expect(out).toContain('<span>BMI</span>');
    expect(out).toContain('22.2'); // 72 / 1.8^2
    expect(out).toContain('Goal progress');
    expect(out).toContain('width:40%'); // (72-70)/(75-70) = 40%
    expect(out).toContain('+3.0'); // remaining to target
  });
});

describe('trainingStatsView', () => {
  const state = { settings: { unit: 'kg' }, finishedSessions: [], exercises: [] } as unknown as AppState;

  it('renders the hero cards without throwing', () => {
    const out = trainingStatsView(state);
    expect(out).toContain('Day streak');
    expect(out).toContain('Total sessions');
    expect(out).toContain('Total volume');
  });

  it('says nothing is logged once, and says what to do about it', () => {
    const out = trainingStatsView(state);
    // Volume, distribution and records are empty for one reason. Three restatements of it
    // under three headings is what this replaced.
    expect(out).not.toContain('No volume logged yet.');
    expect(out).not.toContain('No logged sets yet.');
    expect(out).not.toContain('No records yet.');
    expect(out).toContain('Nothing logged yet');
    expect(out).toContain('data-view="workouts"');
    expect(out).not.toContain('Weekly volume');
  });

  it('keeps the hero tiles honest at zero rather than hiding them', () => {
    const out = trainingStatsView(state);
    expect(out).toContain('id="stat-streak">0<');
    expect(out).toContain('id="stat-sessions">0<');
  });

  it('keeps the ids the shell patches, even with nothing logged', () => {
    const out = trainingStatsView(state);
    for (const id of ['prog-bars', 'prog-dist', 'prog-prs', 'stat-streak', 'stat-sessions', 'stat-volume', 'stat-volume-unit']) {
      expect(out, `${id} is patched directly by the shell`).toContain(`id="${id}"`);
    }
  });

  it('renders the full breakdown once a session exists', () => {
    const session = {
      id: 1, date: '2026-01-05T10:00:00.000Z', name: 'Day', sets: [
        { exerciseSlug: 'squat', weightKg: 100, reps: 5, done: true }
      ], exercises: [{ slug: 'squat', name: 'Squat' }]
    };
    const out = trainingStatsView({
      settings: { unit: 'kg' },
      finishedSessions: [session],
      exercises: [{ slug: 'squat', name: 'Squat', muscles: ['Quadriceps'] }]
    } as unknown as AppState);
    expect(out).toContain('volume</span>');
    expect(out).toContain('Muscle distribution');
    expect(out).toContain('Personal records');
    expect(out).not.toContain('Nothing logged yet');
  });
});

describe('trainingStatsView date range', () => {
  const session = (daysAgo: number) => ({
    id: daysAgo, date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    finishedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    name: 'Day', exercises: [{ exerciseSlug: 'squat', exerciseName: 'Squat', muscleGroup: 'Quadriceps', sets: 1, reps: '5', restSec: 90 }],
    sets: [{ exerciseSlug: 'squat', setNumber: 1, weight: 100, reps: 5, done: true }]
  });
  const withRange = (range: string | undefined, days: number[] = [0, 60]) => trainingStatsView({
    settings: { unit: 'kg' },
    finishedSessions: days.map(session),
    exercises: [{ slug: 'squat', name: 'Squat', muscles: ['Quadriceps'] }],
    statsRange: range
  } as unknown as AppState);

  it('labels the buttons short enough to fit, keeping the full name for screen readers', () => {
    const out = withRange('all');
    expect(out).toContain('>4W</button>');
    expect(out).toContain('aria-label="4 weeks"');
    expect(out).toContain('aria-label="All time"');
  });

  it('offers every range and marks the active one', () => {
    const out = withRange('3m');
    for (const option of ['4w', '3m', '1y', 'all']) {
      expect(out).toContain(`data-stats-range="${option}"`);
    }
    expect(out).toContain('data-stats-range="3m" aria-pressed="true"');
    expect(out).toContain('data-stats-range="4w" aria-pressed="false"');
  });

  it('defaults to all time when nothing is selected', () => {
    expect(withRange(undefined)).toContain('data-stats-range="all" aria-pressed="true"');
    expect(withRange(undefined)).toContain('Total sessions');
  });

  it('says which window the totals describe, and drops "Total" when scoped', () => {
    const scoped = withRange('4w');
    expect(scoped).not.toContain('Total sessions');
    expect(scoped).toContain('>Sessions <small class="stat-scope">');
    expect(scoped).toContain('4 weeks');
  });

  it('names the bucket on the volume heading', () => {
    expect(withRange('4w')).toContain('Weekly volume');
    expect(withRange('1y')).toContain('Monthly volume');
  });

  it('keeps the records heading honest about being all-time', () => {
    expect(withRange('4w')).toContain('all time');
  });

  it('narrows the figures without touching the streak', () => {
    // One session today, one sixty days back.
    expect(withRange('4w')).toContain('id="stat-sessions">1<');
    expect(withRange('all')).toContain('id="stat-sessions">2<');
    expect(withRange('4w')).toContain('id="stat-streak">1<');
    expect(withRange('all')).toContain('id="stat-streak">1<');
  });
});
