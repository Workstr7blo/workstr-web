import { describe, expect, it } from 'vitest';
import { workoutHistory } from '../src/features/train/history-timeline';
import { sessionDetail } from '../src/features/train/views';
import type { ActiveSession, AppState } from '../src/app/state';

const now = new Date(2026, 7, 19, 10, 0, 0); // Wednesday 19 August 2026

function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function session(id: number, finished: string, name = `Session ${id}`, setCount = 3): ActiveSession {
  return {
    id,
    sheetName: name,
    startedAt: finished,
    finishedAt: finished,
    exercises: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', muscleGroup: 'Chest', sets: setCount, reps: '8', restSec: 60 }],
    sets: Array.from({ length: setCount }, (_item, index) => ({
      exerciseSlug: 'bench-press', setNumber: index + 1, reps: 8, weight: 60, done: true, completedAt: finished
    }))
  };
}

function state(sessions: ActiveSession[], overrides: Partial<AppState> = {}): AppState {
  return {
    finishedSessions: sessions,
    exercises: [],
    settings: { unit: 'kg', publicRelays: [] },
    expandedSessionId: null,
    publishingSessionId: null,
    publishingStatus: null,
    pubkey: null,
    history: { monthKey: null, selectedDate: null },
    ...overrides
  } as AppState;
}

function parse(markup: string): Document {
  return new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
}

const headings = (doc: Document): (string | null)[] =>
  [...doc.querySelectorAll('.history-group-head h4')].map((node) => node.textContent);

describe('grouped timeline', () => {
  it('keeps the empty state when nothing has been completed', () => {
    const doc = parse(workoutHistory(state([]), now));
    expect(doc.querySelector('.list.empty')?.textContent).toContain('No completed sessions yet');
  });

  it('groups newest day first under relative headings', () => {
    const doc = parse(workoutHistory(state([
      session(1, at(2026, 8, 12)),
      session(2, at(2026, 8, 18)),
      session(3, at(2026, 8, 19))
    ]), now));
    expect(headings(doc)).toEqual(['Today', 'Yesterday', 'Wed, Aug 12']);
    expect([...doc.querySelectorAll('.history-group')].map((node) => node.getAttribute('data-history-group')))
      .toEqual(['2026-08-19', '2026-08-18', '2026-08-12']);
  });

  it('puts several workouts from one day under one heading, newest first', () => {
    const doc = parse(workoutHistory(state([
      session(1, at(2026, 8, 19, 7), 'Morning'),
      session(2, at(2026, 8, 19, 19), 'Evening')
    ]), now));
    expect(headings(doc)).toEqual(['Today']);
    expect(doc.querySelector('.history-group-count')?.textContent).toBe('2 workouts');
    expect([...doc.querySelectorAll('.workout-card-name')].map((node) => node.textContent)).toEqual(['Evening', 'Morning']);
  });

  it('omits the count when a day holds one workout', () => {
    const doc = parse(workoutHistory(state([session(1, at(2026, 8, 19))]), now));
    expect(doc.querySelector('.history-group-count')).toBeNull();
  });

  it('summarises how much history there is', () => {
    const doc = parse(workoutHistory(state([
      session(1, at(2026, 8, 19)), session(2, at(2026, 8, 19, 18)), session(3, at(2026, 8, 12))
    ]), now));
    expect(doc.querySelector('.history-count')?.textContent).toBe('3 workouts logged across 2 days');
  });

  it('groups a workout finished late at night under the day it was trained', () => {
    const doc = parse(workoutHistory(state([session(1, at(2026, 8, 19, 23, ))]), now));
    expect(headings(doc)).toEqual(['Today']);
  });
});

describe('calendar selection', () => {
  const sessions = [
    session(1, at(2026, 8, 19), 'Today Push'),
    session(2, at(2026, 8, 18, 7), 'Yesterday AM'),
    session(3, at(2026, 8, 18, 19), 'Yesterday PM'),
    session(4, at(2026, 8, 12), 'Last week')
  ];

  it('renders only the selected day and offers a way back', () => {
    const doc = parse(workoutHistory(state(sessions, { history: { monthKey: null, selectedDate: '2026-08-18' } }), now));
    expect([...doc.querySelectorAll('.workout-card-name')].map((node) => node.textContent))
      .toEqual(['Yesterday PM', 'Yesterday AM']);
    expect(doc.querySelector('.history-filter-text b')?.textContent).toBe('Yesterday');
    expect(doc.querySelector('.history-filter-text span')?.textContent).toBe('2 workouts on Tuesday, August 18, 2026');
    expect(doc.querySelector('#history-clear-filter')?.textContent).toBe('Show all');
  });

  it('binds no cards for the days it is not showing', () => {
    const doc = parse(workoutHistory(state(sessions, { history: { monthKey: null, selectedDate: '2026-08-12' } }), now));
    expect(doc.querySelectorAll('.workout-card')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-toggle-session]')).toHaveLength(1);
    expect(doc.querySelector('.history-filter-text span')?.textContent).toBe('1 workout on Wednesday, August 12, 2026');
  });

  it('restores the full grouped timeline when the selection is cleared', () => {
    const doc = parse(workoutHistory(state(sessions), now));
    expect(doc.querySelector('.history-filter')).toBeNull();
    expect(headings(doc)).toEqual(['Today', 'Yesterday', 'Wed, Aug 12']);
    expect(doc.querySelectorAll('.workout-card')).toHaveLength(4);
  });

  it('explains a selected day that has nothing on it rather than looking broken', () => {
    const doc = parse(workoutHistory(state(sessions, { history: { monthKey: null, selectedDate: '2026-08-15' } }), now));
    expect(doc.querySelector('.history-filter-text span')?.textContent).toBe('Nothing logged on Saturday, August 15, 2026');
    expect(doc.querySelector('.list.empty')?.textContent).toContain('No workouts on this day');
    expect(doc.querySelector('#history-clear-filter')).not.toBeNull();
  });

  it('ignores a malformed selection and shows everything', () => {
    const doc = parse(workoutHistory(state(sessions, { history: { monthKey: null, selectedDate: '2026-02-30' } }), now));
    expect(doc.querySelector('.history-filter')).toBeNull();
    expect(doc.querySelectorAll('.workout-card')).toHaveLength(4);
  });

  it('keeps the expanded session expanded inside a filtered day', () => {
    const doc = parse(workoutHistory(state(sessions, {
      expandedSessionId: 3,
      history: { monthKey: null, selectedDate: '2026-08-18' }
    }), now));
    const expanded = doc.querySelector('.workout-card.expanded');
    expect(expanded?.getAttribute('data-session')).toBe('3');
    expect(expanded?.querySelector('.session-detail')).not.toBeNull();
    expect(doc.querySelectorAll('.workout-card.expanded')).toHaveLength(1);
  });
});

describe('session card contents', () => {
  it('keeps name, date, duration, sets, volume and muscle labels', () => {
    const trained = session(1, at(2026, 8, 19, 12), 'Push Day', 3);
    trained.startedAt = at(2026, 8, 19, 11);
    const doc = parse(workoutHistory(state([trained]), now));
    expect(doc.querySelector('.workout-card-name')?.textContent).toBe('Push Day');
    const meta = doc.querySelector('.workout-card-meta')?.textContent || '';
    expect(meta).toContain('3 sets');
    expect(meta).toContain('1h 0m');
    expect(meta).toContain('1440 kg volume');
    expect(doc.querySelector('.workout-card-muscles')?.textContent).toBe('Chest');
    expect(doc.querySelector('[data-session-map="1"]')).not.toBeNull();
  });

  it('still exposes toggle, publish and delete for the right session', () => {
    const doc = parse(workoutHistory(state([session(7, at(2026, 8, 19))], { expandedSessionId: 7, pubkey: 'ab'.repeat(32) }), now));
    expect(doc.querySelector('[data-toggle-session="7"]')).not.toBeNull();
    expect(doc.querySelector('[data-publish-session="7"]')).not.toBeNull();
    expect(doc.querySelector('[data-delete-session="7"]')).not.toBeNull();
  });
});

describe('delete placement', () => {
  const detail = (): Document => parse(sessionDetail(session(4, at(2026, 8, 19)), 'kg', true));

  it('moves delete behind a closed disclosure, away from publish', () => {
    const doc = detail();
    const actions = doc.querySelector('.workout-card-actions')!;
    expect(actions.querySelector('[data-delete-session]')).toBeNull();
    expect(actions.querySelector('[data-publish-session]')).not.toBeNull();
    const details = doc.querySelector('details.session-danger')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('More actions');
    expect(details.querySelector('[data-delete-session="4"]')).not.toBeNull();
  });

  it('keeps the delete button wired to the same session id', () => {
    expect(detail().querySelector('[data-delete-session]')?.getAttribute('data-delete-session')).toBe('4');
  });
});
