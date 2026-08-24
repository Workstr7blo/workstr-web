// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { historyCalendar, historyCalendarPanel } from '../src/features/train/history-calendar';
import { buildHistoryModel } from '../src/features/train/history-model';
import type { ActiveSession, AppState } from '../src/app/state';

const now = new Date(2026, 7, 19, 10, 0, 0); // Wednesday 19 August 2026

function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function session(id: number, finished: string, setCount = 3): ActiveSession {
  return {
    id,
    sheetName: `Session ${id}`,
    startedAt: finished,
    finishedAt: finished,
    exercises: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', sets: setCount, reps: '8', restSec: 60 }],
    sets: Array.from({ length: setCount }, (_item, index) => ({
      exerciseSlug: 'bench-press', setNumber: index + 1, reps: 8, weight: 60, done: true, completedAt: finished
    }))
  };
}

function render(sessions: ActiveSession[], selected: string | null = null, monthKey?: string): string {
  const model = buildHistoryModel(sessions, { now, monthKey, locale: 'en-US' });
  return historyCalendar(model, selected, sessions.length > 0);
}

function parse(markup: string): Document {
  return new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
}

describe('history calendar markup', () => {
  it('renders whole Monday-first weeks with weekday headers', () => {
    const doc = parse(render([]));
    const weekdays = [...doc.querySelectorAll('.history-cal-weekdays span')].map((node) => node.textContent);
    expect(weekdays).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    // Header row plus the month's week rows, every one exactly seven cells wide.
    const rows = [...doc.querySelectorAll('.history-cal-week:not(.history-cal-weekdays)')];
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((row) => expect(row.children).toHaveLength(7));
  });

  it('pads the leading and trailing cells so the grid never shifts', () => {
    const doc = parse(render([]));
    const pads = doc.querySelectorAll('.history-cal-day.pad');
    // August 2026 starts on a Saturday, so Monday-Friday lead in as padding.
    expect(pads.length).toBeGreaterThan(0);
    pads.forEach((pad) => expect(pad.getAttribute('aria-hidden')).toBe('true'));
    expect(doc.querySelectorAll('[data-history-date]')).toHaveLength(31);
  });

  it('titles the month and offers previous, next and today controls', () => {
    const doc = parse(render([]));
    expect(doc.querySelector('.history-cal-title')?.textContent).toBe('August 2026');
    expect(doc.querySelector('[data-history-month="prev"]')?.getAttribute('aria-label')).toBe('Previous month');
    expect(doc.querySelector('[data-history-month="next"]')?.getAttribute('aria-label')).toBe('Next month');
    expect(doc.querySelector('[data-history-month="today"]')?.getAttribute('aria-label')).toBe('Go to the current month');
  });

  it('marks completed days with an intensity that follows set count', () => {
    const doc = parse(render([session(1, at(2026, 8, 3), 4), session(2, at(2026, 8, 5), 10), session(3, at(2026, 8, 7), 20)]));
    const day = (key: string) => doc.querySelector(`[data-history-date="${key}"]`)!;
    expect(day('2026-08-03').getAttribute('data-intensity')).toBe('1');
    expect(day('2026-08-05').getAttribute('data-intensity')).toBe('2');
    expect(day('2026-08-07').getAttribute('data-intensity')).toBe('3');
    // Intensity is legible without colour: one dot per level.
    expect(day('2026-08-03').querySelectorAll('.history-cal-dots i')).toHaveLength(1);
    expect(day('2026-08-07').querySelectorAll('.history-cal-dots i')).toHaveLength(3);
    expect(day('2026-08-04').getAttribute('data-intensity')).toBe('0');
    expect(day('2026-08-04').querySelector('.history-cal-dots')).toBeNull();
  });

  it('counts multiple sessions on one day and stays silent for one', () => {
    const doc = parse(render([session(1, at(2026, 8, 10, 7)), session(2, at(2026, 8, 10, 18)), session(3, at(2026, 8, 12))]));
    expect(doc.querySelector('[data-history-date="2026-08-10"] .history-cal-count')?.textContent).toBe('×2');
    expect(doc.querySelector('[data-history-date="2026-08-12"] .history-cal-count')).toBeNull();
  });

  it('separates today, completed, selected and future days semantically', () => {
    const doc = parse(render([session(1, at(2026, 8, 18))], '2026-08-18'));
    const today = doc.querySelector('[data-history-date="2026-08-19"]')!;
    const done = doc.querySelector('[data-history-date="2026-08-18"]')!;
    const future = doc.querySelector('[data-history-date="2026-08-25"]')!;
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(done.className).toContain('done');
    expect(done.className).toContain('selected');
    expect(done.getAttribute('aria-pressed')).toBe('true');
    expect(future.className).toContain('future');
    expect(future.hasAttribute('disabled')).toBe(true);
    expect(today.hasAttribute('aria-pressed')).toBe(false); // nothing logged today
  });

  it('keeps days with nothing to open out of the tab order', () => {
    const doc = parse(render([session(1, at(2026, 8, 18))]));
    const enabled = [...doc.querySelectorAll('[data-history-date]')].filter((node) => !node.hasAttribute('disabled'));
    expect(enabled.map((node) => node.getAttribute('data-history-date'))).toEqual(['2026-08-18']);
  });

  it('names every day in full for assistive technology', () => {
    const doc = parse(render([session(1, at(2026, 8, 18, 7), 4), session(2, at(2026, 8, 18, 19), 4)], '2026-08-18'));
    expect(doc.querySelector('[data-history-date="2026-08-18"]')?.getAttribute('aria-label'))
      .toBe('Tuesday, August 18, 2026, 2 workouts, 8 sets, selected');
    expect(doc.querySelector('[data-history-date="2026-08-19"]')?.getAttribute('aria-label'))
      .toBe('Wednesday, August 19, 2026, no workout, today');
    expect(doc.querySelector('[data-history-date="2026-08-20"]')?.getAttribute('aria-label'))
      .toBe('Thursday, August 20, 2026, no workout');
  });

  it('singularises one workout and one set', () => {
    const doc = parse(render([session(1, at(2026, 8, 18), 1)]));
    expect(doc.querySelector('[data-history-date="2026-08-18"]')?.getAttribute('aria-label'))
      .toBe('Tuesday, August 18, 2026, 1 workout, 1 set');
  });
});

describe('history summary cards', () => {
  it('reports workouts this month, active weeks and rest days', () => {
    const doc = parse(render([session(1, at(2026, 8, 19)), session(2, at(2026, 8, 12)), session(3, at(2026, 7, 30))]));
    const values = [...doc.querySelectorAll('.history-card-value')].map((node) => node.textContent);
    const labels = [...doc.querySelectorAll('.history-card-label')].map((node) => node.textContent);
    expect(values).toEqual(['2', '2', '0']);
    expect(labels[0]).toBe('workouts in August');
    expect(labels[1]).toBe('active weeks in a row');
    expect(labels[2]).toBe('you trained today');
  });

  it('handles an empty history without pretending there is a streak', () => {
    const doc = parse(render([]));
    expect([...doc.querySelectorAll('.history-card-value')].map((node) => node.textContent)).toEqual(['0', '0', '—']);
    expect(doc.querySelectorAll('.history-card-label')[2].textContent).toBe('no workout logged yet');
    expect(doc.querySelector('.history-cal-empty')?.textContent).toContain('No workouts yet');
  });

  it('singularises a single workout, week and rest day', () => {
    const doc = parse(render([session(1, at(2026, 8, 18))]));
    const labels = [...doc.querySelectorAll('.history-card-label')].map((node) => node.textContent);
    expect(labels[0]).toBe('workout in August');
    expect(labels[1]).toBe('active week in a row');
    expect(labels[2]).toBe('day since your last workout');
  });

  it('drops the empty-state line once history exists', () => {
    expect(parse(render([session(1, at(2026, 8, 18))])).querySelector('.history-cal-empty')).toBeNull();
  });
});

describe('month navigation', () => {
  it('renders a requested month, including across a year boundary', () => {
    const december = parse(render([session(1, at(2025, 12, 24))], null, '2025-12'));
    expect(december.querySelector('.history-cal-title')?.textContent).toBe('December 2025');
    expect(december.querySelector('[data-history-date="2025-12-24"]')?.className).toContain('done');
    // Nothing in a past month is "future", so December's days stay selectable.
    expect(december.querySelector('[data-history-date="2025-12-24"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('treats every day of a future month as inactive', () => {
    const doc = parse(render([], null, '2026-09'));
    const days = [...doc.querySelectorAll('[data-history-date]')];
    expect(days.length).toBe(30);
    expect(days.every((day) => day.hasAttribute('disabled'))).toBe(true);
  });
});

describe('historyCalendarPanel', () => {
  const state = (overrides: Partial<AppState>): AppState => ({
    finishedSessions: [], history: { monthKey: null, selectedDate: null }, ...overrides
  } as AppState);

  it('reads month and selection from app state', () => {
    const markup = historyCalendarPanel(state({
      finishedSessions: [session(1, at(2026, 8, 18))],
      history: { monthKey: null, selectedDate: '2026-08-18' }
    }), now);
    expect(parse(markup).querySelector('[data-history-date="2026-08-18"]')?.className).toContain('selected');
  });

  it('ignores a malformed stored selection rather than rendering it', () => {
    const markup = historyCalendarPanel(state({
      finishedSessions: [session(1, at(2026, 8, 18))],
      history: { monthKey: null, selectedDate: '2026-02-30' }
    }), now);
    expect(parse(markup).querySelector('.history-cal-day.selected')).toBeNull();
  });
});
