import { describe, expect, it } from 'vitest';
import {
  activeWeekStreak, buildHistoryModel, groupSessionsByDay, groupSessionsForTimeline,
  latestSessionKey, monthGrid, sessionDateKey, sessionsOnDay, setCountIntensity
} from '../src/features/train/history-model';
import type { ActiveSession } from '../src/app/state';

// Local wall-clock timestamps: the whole point of the model is that a day is the day the
// user lived, so fixtures are built the way a device would record them.
function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function session(id: number, finished: string, setCount = 3, started = finished): ActiveSession {
  return {
    id,
    sheetName: `Session ${id}`,
    startedAt: started,
    finishedAt: finished,
    exercises: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', sets: setCount, reps: '8', restSec: 60 }],
    sets: Array.from({ length: setCount }, (_item, index) => ({
      exerciseSlug: 'bench-press', setNumber: index + 1, reps: 8, weight: 60, done: true, completedAt: finished
    }))
  };
}

describe('sessionDateKey', () => {
  it('keys a late-night workout to the day it was trained', () => {
    expect(sessionDateKey(session(1, at(2026, 8, 19, 23, 45)))).toBe('2026-08-19');
    expect(sessionDateKey(session(2, at(2026, 8, 19, 0, 5)))).toBe('2026-08-19');
  });

  it('falls back to the start day when a session has no finish timestamp', () => {
    const unfinished = { ...session(3, at(2026, 8, 19)), finishedAt: undefined };
    expect(sessionDateKey(unfinished)).toBe('2026-08-19');
  });
});

describe('groupSessionsByDay', () => {
  it('returns an empty map for no history', () => {
    expect(groupSessionsByDay([]).size).toBe(0);
  });

  it('merges several sessions trained on one day', () => {
    const days = groupSessionsByDay([
      session(1, at(2026, 8, 19, 7), 4),
      session(2, at(2026, 8, 19, 18), 6),
      session(3, at(2026, 8, 17), 5)
    ]);
    expect(days.size).toBe(2);
    expect(days.get('2026-08-19')).toMatchObject({ sessionCount: 2, setCount: 10 });
    expect(days.get('2026-08-19')?.sessionIds).toEqual([1, 2]);
    expect(days.get('2026-08-17')).toMatchObject({ sessionCount: 1, setCount: 5 });
  });

  it('ignores unfinished sessions and unparseable timestamps', () => {
    const days = groupSessionsByDay([
      { ...session(1, at(2026, 8, 19)), finishedAt: undefined },
      { ...session(2, 'not a date'), startedAt: 'not a date' },
      session(3, at(2026, 8, 19))
    ]);
    expect(days.size).toBe(1);
    expect(days.get('2026-08-19')?.sessionCount).toBe(1);
  });

  it('accepts sessions in any order', () => {
    const ordered = groupSessionsByDay([session(1, at(2026, 8, 1)), session(2, at(2026, 8, 20))]);
    const shuffled = groupSessionsByDay([session(2, at(2026, 8, 20)), session(1, at(2026, 8, 1))]);
    expect([...shuffled.keys()].sort()).toEqual([...ordered.keys()].sort());
  });
});

describe('setCountIntensity', () => {
  it('grades on completed sets with deterministic thresholds', () => {
    expect(setCountIntensity(0)).toBe(0);
    expect(setCountIntensity(1)).toBe(1);
    expect(setCountIntensity(7)).toBe(1);
    expect(setCountIntensity(8)).toBe(2);
    expect(setCountIntensity(15)).toBe(2);
    expect(setCountIntensity(16)).toBe(3);
    expect(setCountIntensity(40)).toBe(3);
  });
});

describe('activeWeekStreak', () => {
  const streakFor = (finishes: string[], today: string): number =>
    activeWeekStreak(groupSessionsByDay(finishes.map((finish, index) => session(index + 1, finish))), today);

  it('is zero without history', () => {
    expect(activeWeekStreak(new Map(), '2026-08-19')).toBe(0);
  });

  it('counts consecutive Monday-based weeks', () => {
    // Weeks of Aug 17, Aug 10 and Aug 3, with today inside the Aug 17 week.
    expect(streakFor([at(2026, 8, 19), at(2026, 8, 12), at(2026, 8, 5)], '2026-08-19')).toBe(3);
  });

  it('does not break the streak when the current week has no workout yet', () => {
    // Today is Monday Aug 17 with nothing logged; the two previous weeks still count.
    expect(streakFor([at(2026, 8, 12), at(2026, 8, 5)], '2026-08-17')).toBe(2);
  });

  it('counts the current week once it has a workout', () => {
    expect(streakFor([at(2026, 8, 17), at(2026, 8, 12)], '2026-08-17')).toBe(2);
  });

  it('stops at a missed week', () => {
    // Nothing in the week of Aug 10, so the run ends after the current week.
    expect(streakFor([at(2026, 8, 19), at(2026, 8, 5)], '2026-08-19')).toBe(1);
  });

  it('is zero when the most recent week is two weeks back', () => {
    expect(streakFor([at(2026, 8, 5)], '2026-08-19')).toBe(0);
  });

  it('treats several workouts in one week as one active week', () => {
    expect(streakFor([at(2026, 8, 17), at(2026, 8, 18), at(2026, 8, 19)], '2026-08-19')).toBe(1);
  });
});

describe('monthGrid', () => {
  it('starts every week on Monday and pads both ends', () => {
    const weeks = monthGrid('2026-08', new Map(), '2026-08-19');
    expect(weeks[0][0].key).toBe('2026-07-27'); // Monday before Aug 1 (a Saturday)
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    const inMonth = weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].key).toBe('2026-08-01');
    expect(inMonth[30].key).toBe('2026-08-31');
  });

  it('marks today, future days and the days carrying work', () => {
    const days = groupSessionsByDay([session(1, at(2026, 8, 18), 20)]);
    const cells = monthGrid('2026-08', days, '2026-08-19').flat();
    const find = (key: string) => cells.find((cell) => cell.key === key)!;
    expect(find('2026-08-19').isToday).toBe(true);
    expect(find('2026-08-19').isFuture).toBe(false);
    expect(find('2026-08-20').isFuture).toBe(true);
    expect(find('2026-08-18').isFuture).toBe(false);
    expect(find('2026-08-18').day?.intensity).toBe(3);
    expect(find('2026-08-17').day).toBeNull();
  });

  it('handles a month that starts on a Monday and one that ends on a Sunday', () => {
    const june = monthGrid('2026-06', new Map(), '2026-06-15');
    expect(june[0][0].key).toBe('2026-06-01'); // June 1 2026 is a Monday
    expect(june.flat().filter((cell) => cell.inMonth)).toHaveLength(30);
    const february = monthGrid('2028-02', new Map(), '2028-02-10');
    expect(february.flat().filter((cell) => cell.inMonth)).toHaveLength(29); // leap year
  });

  it('returns nothing for an unparseable month', () => {
    expect(monthGrid('nope', new Map(), '2026-08-19')).toEqual([]);
  });
});

describe('buildHistoryModel', () => {
  const now = new Date(2026, 7, 19, 10, 0, 0); // Wednesday 19 August 2026

  it('describes an empty history without collapsing the calendar', () => {
    const model = buildHistoryModel([], { now, locale: 'en-US' });
    expect(model.monthKey).toBe('2026-08');
    expect(model.monthLabel).toBe('August 2026');
    expect(model.todayKey).toBe('2026-08-19');
    expect(model.weeks.length).toBeGreaterThan(0);
    expect(model.summary).toMatchObject({ workoutsInMonth: 0, activeWeekStreak: 0, daysSinceLatest: null, latestKey: null });
  });

  it('summarises the current month', () => {
    const model = buildHistoryModel([
      session(1, at(2026, 8, 19), 5),
      session(2, at(2026, 8, 18), 5),
      session(3, at(2026, 8, 18), 5),
      session(4, at(2026, 7, 30), 5)
    ], { now });
    expect(model.summary.workoutsInMonth).toBe(3); // July's session is not counted
    expect(model.summary.daysSinceLatest).toBe(0);
    expect(model.summary.latestKey).toBe('2026-08-19');
    expect(model.days.get('2026-08-18')?.sessionCount).toBe(2);
  });

  it('counts rest days in calendar days, not elapsed hours', () => {
    // Finished late on the 17th, asked early on the 19th: two calendar days, not one.
    const model = buildHistoryModel([session(1, at(2026, 8, 17, 23, 30))], { now: new Date(2026, 7, 19, 6, 0, 0) });
    expect(model.summary.daysSinceLatest).toBe(2);
  });

  it('honours a requested month and ignores a malformed one', () => {
    const sessions = [session(1, at(2026, 6, 10), 5)];
    expect(buildHistoryModel(sessions, { now, monthKey: '2026-06' }).summary.workoutsInMonth).toBe(1);
    expect(buildHistoryModel(sessions, { now, monthKey: '2026-06' }).monthKey).toBe('2026-06');
    expect(buildHistoryModel(sessions, { now, monthKey: 'garbage' }).monthKey).toBe('2026-08');
  });

  it('spans months and years without losing sessions', () => {
    const model = buildHistoryModel([
      session(1, at(2024, 12, 31), 5),
      session(2, at(2025, 1, 1), 5),
      session(3, at(2026, 8, 19), 5)
    ], { now });
    expect(model.days.size).toBe(3);
    expect(latestSessionKey(model.days)).toBe('2026-08-19');
  });
});

describe('timeline grouping', () => {
  it('groups newest day first and orders same-day sessions newest first', () => {
    const groups = groupSessionsForTimeline([
      session(1, at(2026, 8, 17)),
      session(2, at(2026, 8, 19, 7)),
      session(3, at(2026, 8, 19, 19))
    ]);
    expect(groups.map((group) => group.key)).toEqual(['2026-08-19', '2026-08-17']);
    expect(groups[0].sessions.map((item) => item.id)).toEqual([3, 2]);
  });

  it('breaks ties on id so the order never wobbles between renders', () => {
    const finish = at(2026, 8, 19, 9);
    const groups = groupSessionsForTimeline([session(5, finish), session(9, finish)]);
    expect(groups[0].sessions.map((item) => item.id)).toEqual([9, 5]);
  });

  it('drops sessions that were never finished', () => {
    const groups = groupSessionsForTimeline([{ ...session(1, at(2026, 8, 19)), finishedAt: undefined }]);
    expect(groups).toEqual([]);
  });

  it('selects a single day', () => {
    const sessions = [session(1, at(2026, 8, 19)), session(2, at(2026, 8, 17))];
    expect(sessionsOnDay(sessions, '2026-08-19').map((item) => item.id)).toEqual([1]);
    expect(sessionsOnDay(sessions, '2026-08-18')).toEqual([]);
  });
});
