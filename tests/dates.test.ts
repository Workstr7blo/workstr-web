import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, dateKeyFromDate, dateLabel, daysBetween, isDateKey, isMonthKey,
  localDateKey, monthKeyOf, monthLabel, parseDateKey, relativeDayLabel, sessionDayKey, startOfWeek
} from '../src/core/dates';

describe('localDateKey', () => {
  it('keys a timestamp by its local day, not its UTC day', () => {
    // 23:30 local on the 19th. A UTC slice would call this the 20th anywhere east of
    // Greenwich, which is exactly the bug this vocabulary exists to prevent.
    const lateNight = new Date(2026, 7, 19, 23, 30, 0);
    expect(localDateKey(lateNight)).toBe('2026-08-19');
    const earlyMorning = new Date(2026, 7, 19, 0, 15, 0);
    expect(localDateKey(earlyMorning)).toBe('2026-08-19');
  });

  it('accepts ISO strings, epoch numbers and Date objects', () => {
    const date = new Date(2026, 0, 2, 12, 0, 0);
    expect(localDateKey(date.toISOString())).toBe('2026-01-02');
    expect(localDateKey(date.getTime())).toBe('2026-01-02');
    expect(localDateKey(date)).toBe('2026-01-02');
  });

  it('returns null for missing or unparseable values instead of throwing', () => {
    expect(localDateKey(null)).toBeNull();
    expect(localDateKey(undefined)).toBeNull();
    expect(localDateKey('')).toBeNull();
    expect(localDateKey('not a date')).toBeNull();
  });
});

describe('sessionDayKey', () => {
  it('prefers the finish day and falls back to the start day', () => {
    const started = new Date(2026, 4, 1, 22, 0, 0).toISOString();
    const finished = new Date(2026, 4, 1, 23, 40, 0).toISOString();
    expect(sessionDayKey(finished, started)).toBe('2026-05-01');
    expect(sessionDayKey(undefined, started)).toBe('2026-05-01');
    expect(sessionDayKey(null, null)).toBeNull();
  });
});

describe('parseDateKey', () => {
  it('produces local midnight and rejects impossible dates', () => {
    const date = parseDateKey('2026-03-09');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(9);
    expect(date?.getHours()).toBe(0);
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('nonsense')).toBeNull();
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(parseDateKey('2028-02-29')).not.toBeNull();
    expect(parseDateKey('2026-02-29')).toBeNull();
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
  });
});

describe('addDays and daysBetween', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('counts whole calendar days across a DST transition', () => {
    // Late March and late October carry the European transitions; US transitions fall in
    // March and November. Whichever the runner uses, a day is still a day.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysBetween('2026-03-02', '2026-03-01')).toBe(-1);
  });

  it('survives a full year of round-tripping', () => {
    let key = '2026-01-01';
    for (let index = 0; index < 365; index += 1) key = addDays(key, 1);
    expect(key).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', key)).toBe(365);
  });
});

describe('startOfWeek', () => {
  it('always lands on the preceding Monday', () => {
    // 2026-08-19 is a Wednesday.
    expect(startOfWeek('2026-08-19')).toBe('2026-08-17');
    expect(startOfWeek('2026-08-17')).toBe('2026-08-17');
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(startOfWeek('2026-08-23')).toBe('2026-08-17');
    expect(startOfWeek('2026-08-24')).toBe('2026-08-24');
  });

  it('crosses a month boundary backwards', () => {
    expect(startOfWeek('2026-09-01')).toBe('2026-08-31');
  });
});

describe('month helpers', () => {
  it('moves months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-08', 6)).toBe('2027-02');
    expect(monthKeyOf('2026-08-19')).toBe('2026-08');
    expect(isMonthKey('2026-08')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-8')).toBe(false);
  });

  it('labels months and dates for a fixed locale', () => {
    expect(monthLabel('2026-08', 'en-US')).toBe('August 2026');
    expect(dateLabel('2026-08-19', 'en-US')).toBe('Wednesday, August 19, 2026');
  });
});

describe('relativeDayLabel', () => {
  it('names today and yesterday, then falls back to a date', () => {
    expect(relativeDayLabel('2026-08-19', '2026-08-19', 'en-US')).toBe('Today');
    expect(relativeDayLabel('2026-08-18', '2026-08-19', 'en-US')).toBe('Yesterday');
    expect(relativeDayLabel('2026-08-15', '2026-08-19', 'en-US')).toBe('Sat, Aug 15');
    expect(relativeDayLabel('2025-08-15', '2026-08-19', 'en-US')).toBe('Fri, Aug 15, 2025');
  });
});

describe('dateKeyFromDate', () => {
  it('zero-pads single-digit months and days', () => {
    expect(dateKeyFromDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateKeyFromDate(new Date(2026, 10, 30))).toBe('2026-11-30');
  });
});
