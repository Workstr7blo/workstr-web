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
  it('shows the empty state with no entries', () => {
    const out = bodyView(bodyState([]));
    expect(out).toContain('No entries yet');
    expect(out).toContain('id="body-empty" class="empty" style="display:"');
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
  it('renders the hero cards and empty states without throwing', () => {
    const out = trainingStatsView(state);
    expect(out).toContain('Day streak');
    expect(out).toContain('Total sessions');
    expect(out).toContain('Total volume');
    expect(out).toContain('No volume logged yet.');
  });
});
