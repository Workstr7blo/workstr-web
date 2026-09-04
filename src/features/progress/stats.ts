import type { Exercise } from '../../core/types';
import { addDays, dateKeyFromDate, daysBetween, monthKeyOf, sessionDayKey, type DateKey } from '../../core/dates';
import { completedSets, sessionExercises, type ActiveSession } from '../../app/state';

// SQLite strftime('%Y-%W') equivalent: week of year 00-53, Monday-based,
// computed on the UTC date like self-hosted datetime strings.
export function sqliteWeek(iso: string): string {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  const yday = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const wdayMon = (date.getUTCDay() + 6) % 7;
  const week = Math.floor((yday + 6 - wdayMon) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

// Consecutive local calendar days of training, ending today or yesterday.
//
// Ported from self-hosted Workstr src/app/store.js computeStreak(), now on the shared
// local-date vocabulary in core/dates. The original sliced the day out of an ISO string in
// UTC and then compared it against local midnights, so a late-evening or early-morning
// workout could count against the wrong day, in either direction, depending on the device's
// offset. History and Statistics now answer "which day was that?" the same way.
export function computeStreak(sessions: ActiveSession[], now = new Date()): number {
  const keys = [...new Set(sessions
    .filter((session) => session.finishedAt)
    .map((session) => sessionDayKey(session.finishedAt, session.startedAt))
    .filter((key): key is string => key !== null))].sort().reverse();
  if (!keys.length) return 0;
  // allow today or yesterday to start the streak
  if (daysBetween(keys[0], dateKeyFromDate(now)) > 1) return 0;
  let expected = keys[0];
  let streak = 0;
  for (const key of keys) {
    if (key === expected) { streak += 1; expected = addDays(expected, -1); }
    else if (key < expected) break;
  }
  return streak;
}

export const STATS_RANGES = ['4w', '3m', '1y', 'all'] as const;
export type StatsRange = typeof STATS_RANGES[number];

// Two vocabularies on purpose: the buttons have to fit four across a 375px phone without
// scrolling, since an option you cannot see is one you will not pick. The longer form reads
// as prose in the headings that say which window is on screen.
export const STATS_RANGE_LABELS: Record<StatsRange, string> = {
  '4w': '4 weeks', '3m': '3 months', '1y': '1 year', all: 'All time'
};

export const STATS_RANGE_SHORT: Record<StatsRange, string> = {
  '4w': '4W', '3m': '3M', '1y': '1Y', all: 'All'
};

export function normalizeStatsRange(value: unknown): StatsRange {
  return STATS_RANGES.includes(value as StatsRange) ? value as StatsRange : 'all';
}

/**
 * The first day the range includes, or null for all time.
 *
 * Ranges are counted in days off the local calendar rather than by subtracting milliseconds,
 * so a range boundary lands on a day rather than mid-afternoon, and a session logged at
 * 23:55 belongs to the day it was logged. That is the same rule History, the streak and the
 * calendar already answer "which day was that?" with.
 */
export function statsRangeStart(range: StatsRange, now = new Date()): DateKey | null {
  const today = dateKeyFromDate(now);
  if (range === '4w') return addDays(today, -27);
  if (range === '3m') return addDays(today, -90);
  if (range === '1y') return addDays(today, -364);
  return null;
}

export function sessionsInRange(sessions: ActiveSession[], range: StatsRange, now = new Date()): ActiveSession[] {
  const start = statsRangeStart(range, now);
  if (!start) return sessions;
  return sessions.filter((session) => {
    const key = sessionDayKey(session.finishedAt, session.startedAt);
    return key !== null && key >= start;
  });
}

export interface WorkstrStats {
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  weekly: { week: string; volume: number }[];
  // Weekly for short ranges, monthly for a year and all time: 52 weekly bars is unreadable
  // on a phone. The view says which unit is on screen.
  bucket: 'week' | 'month';
  muscle: { muscle: string; sets: number }[];
  prs: { slug: string; name: string; e1rm: number; topWeight: number }[];
  streak: number;
  range: StatsRange;
}

// Ported verbatim from self-hosted Workstr src/app/store.js getStats().
export function getStats(sessions: ActiveSession[], exercises: Exercise[], now = new Date(), rangeInput: StatsRange = 'all'): WorkstrStats {
  const range = normalizeStatsRange(rangeInput);
  // Two populations on purpose. Volume, muscle distribution and the session/volume totals
  // answer "what have I been doing lately" and follow the range. The streak is a fact about
  // right now, and a record is a record: scoping either to a window would report a lower
  // number under a label that claims otherwise.
  const scoped = sessionsInRange(sessions, range, now);
  const sets = completedSets(scoped);
  const totalSessions = scoped.length;
  const totalSets = sets.length;
  const totalVolume = Math.round(sets.reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));

  // Weekly bars for short ranges, monthly past three months: a year is 52 bars, which no
  // phone can render legibly.
  const bucket: 'week' | 'month' = range === '4w' || range === '3m' ? 'week' : 'month';
  const bucketOf = (session: ActiveSession) => bucket === 'week'
    ? sqliteWeek(session.startedAt)
    : monthKeyOf(sessionDayKey(session.finishedAt, session.startedAt) || dateKeyFromDate(new Date(session.startedAt)));
  const bucketCap = bucket === 'week' ? (range === '4w' ? 4 : 13) : 12;
  const weekTotals: Record<string, number> = {};
  for (const session of scoped) {
    const key = bucketOf(session);
    for (const set of session.sets) {
      if (set.done) weekTotals[key] = (weekTotals[key] || 0) + (Number(set.reps) || 0) * (Number(set.weight) || 0);
    }
  }
  const weekly = Object.entries(weekTotals).sort((a, b) => b[0].localeCompare(a[0])).slice(0, bucketCap).reverse()
    .map(([week, volume]) => ({ week, volume: Math.round(volume) }));

  // Muscle distribution by sets
  const lookup = (session: ActiveSession, slug: string) =>
    exercises.find((exercise) => exercise.slug === slug)?.muscle_group
    || sessionExercises(session).find((member) => member.exerciseSlug === slug)?.muscleGroup
    || 'Other';
  const muscleTotals: Record<string, number> = {};
  for (const session of scoped) {
    for (const set of session.sets.filter((item) => item.done)) {
      const muscle = lookup(session, set.exerciseSlug) || 'Other';
      muscleTotals[muscle] = (muscleTotals[muscle] || 0) + 1;
    }
  }
  const muscle = Object.entries(muscleTotals).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ muscle: name, sets: count }));

  // Personal records: best estimated 1RM (Epley) per exercise
  const prMap = new Map<string, { name: string; e1rm: number; topWeight: number }>();
  for (const session of sessions) {
    for (const set of session.sets.filter((item) => item.done && item.weight != null && item.reps != null && Number(item.weight) > 0)) {
      const e1rm = Number(set.weight) * (1 + Number(set.reps) / 30);
      const name = exercises.find((exercise) => exercise.slug === set.exerciseSlug)?.name
        || sessionExercises(session).find((member) => member.exerciseSlug === set.exerciseSlug)?.exerciseName
        || set.exerciseSlug;
      const existing = prMap.get(set.exerciseSlug);
      if (!existing) prMap.set(set.exerciseSlug, { name, e1rm, topWeight: Number(set.weight) });
      else {
        existing.e1rm = Math.max(existing.e1rm, e1rm);
        existing.topWeight = Math.max(existing.topWeight, Number(set.weight));
      }
    }
  }
  const prs = [...prMap.entries()]
    .map(([slug, record]) => ({ slug, name: record.name, e1rm: Math.round(record.e1rm * 10) / 10, topWeight: record.topWeight }))
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, 12);

  return { totalSessions, totalSets, totalVolume, weekly, bucket, muscle, prs, streak: computeStreak(sessions, now), range };
}
