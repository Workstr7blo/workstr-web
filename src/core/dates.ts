// Local calendar dates, shared by History and Statistics so the app keeps one date
// vocabulary. The user-facing unit is the day the user experienced: a workout finished at
// 23:30 belongs to that day, never the next one. That rules out `toISOString().slice(0,10)`,
// which slices in UTC and moves late-night sessions for anyone east or west of Greenwich.
//
// Day arithmetic goes through calendar fields (year, month, day) rather than millisecond
// offsets, so a DST boundary cannot shift a date by one.

export type DateKey = string; // YYYY-MM-DD, local
export type MonthKey = string; // YYYY-MM, local

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateKeyFromDate(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Null for anything unparseable, so one corrupt timestamp cannot break a whole render.
export function localDateKey(value: string | number | Date | null | undefined): DateKey | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateKeyFromDate(date);
}

// The one rule for which day a completed session belongs to: the day it finished, with
// `startedAt` as the fallback for rows that predate finish timestamps. History and
// Statistics both call this so they cannot drift apart.
export function sessionDayKey(finishedAt?: string | null, startedAt?: string | null): DateKey | null {
  return localDateKey(finishedAt) || localDateKey(startedAt);
}

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateKey(value) !== null;
}

// Local midnight for a key. Returns null rather than an Invalid Date so callers can branch.
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // Rejects impossible dates that would otherwise roll over (2026-02-30 becoming March).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  if (!date) return key;
  return dateKeyFromDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

// Whole calendar days between two keys, positive when `to` is later. Compared as UTC
// midnights purely to get exact arithmetic — the keys themselves stay local.
export function daysBetween(from: DateKey, to: DateKey): number {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (!start || !end) return 0;
  const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endMs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endMs - startMs) / 86400000);
}

// The week starts on Monday. Defined once here; v1.3 deliberately ships no setting for it.
export const WEEK_STARTS_ON_MONDAY = true;

export function startOfWeek(key: DateKey): DateKey {
  const date = parseDateKey(key);
  if (!date) return key;
  return addDays(key, -((date.getDay() + 6) % 7));
}

export function monthKeyOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthLabel(month: MonthKey, locale?: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return month;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
    .toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function dateLabel(key: DateKey, locale?: string): string {
  const date = parseDateKey(key);
  return date ? date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : key;
}

// Today, Yesterday, then a plain date. Used for timeline headings and calendar labels.
export function relativeDayLabel(key: DateKey, today: DateKey, locale?: string): string {
  const distance = daysBetween(key, today);
  if (distance === 0) return 'Today';
  if (distance === 1) return 'Yesterday';
  const date = parseDateKey(key);
  if (!date) return key;
  const sameYear = date.getFullYear() === parseDateKey(today)?.getFullYear();
  return date.toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
