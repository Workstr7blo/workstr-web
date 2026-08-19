import {
  addDays, addMonths, dateKeyFromDate, daysBetween, monthKeyOf, monthLabel,
  parseDateKey, sessionDayKey, startOfWeek, type DateKey, type MonthKey
} from '../../core/dates';
import type { ActiveSession } from '../../app/state';

// Pure history aggregation. Everything here takes an explicit `now`, so tests can pin a
// date and no rendering path depends on when it happens to run.

export interface HistoryDay {
  key: DateKey;
  sessionIds: number[];
  sessionCount: number;
  setCount: number;
  // 0 = no work. 1-3 grade completed working sets, not lifted volume: volume would make a
  // heavy-single day look empty next to a light high-rep one.
  intensity: 0 | 1 | 2 | 3;
}

export interface HistoryCell {
  key: DateKey;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  day: HistoryDay | null;
}

export interface HistorySummary {
  workoutsInMonth: number;
  activeWeekStreak: number;
  daysSinceLatest: number | null;
  latestKey: DateKey | null;
}

export interface HistoryModel {
  monthKey: MonthKey;
  monthLabel: string;
  todayKey: DateKey;
  weeks: HistoryCell[][];
  days: Map<DateKey, HistoryDay>;
  summary: HistorySummary;
}

export const INTENSITY_THRESHOLDS = { moderate: 8, heavy: 16 } as const;

export function setCountIntensity(setCount: number): 0 | 1 | 2 | 3 {
  if (setCount <= 0) return 0;
  if (setCount < INTENSITY_THRESHOLDS.moderate) return 1;
  return setCount < INTENSITY_THRESHOLDS.heavy ? 2 : 3;
}

export function sessionDateKey(session: ActiveSession): DateKey | null {
  return sessionDayKey(session.finishedAt, session.startedAt);
}

export function groupSessionsByDay(sessions: ActiveSession[]): Map<DateKey, HistoryDay> {
  const days = new Map<DateKey, HistoryDay>();
  for (const session of sessions) {
    if (!session.finishedAt) continue;
    const key = sessionDateKey(session);
    if (!key) continue;
    const setCount = session.sets.filter((set) => set.done).length;
    const existing = days.get(key);
    if (existing) {
      existing.sessionIds.push(session.id);
      existing.sessionCount += 1;
      existing.setCount += setCount;
      existing.intensity = setCountIntensity(existing.setCount);
    } else {
      days.set(key, { key, sessionIds: [session.id], sessionCount: 1, setCount, intensity: setCountIntensity(setCount) });
    }
  }
  return days;
}

// Consecutive Monday-based weeks holding at least one completed session, counting back
// from the current week. A current week with no workout yet does not break the streak —
// it has not failed until it is over — so counting starts from last week instead.
export function activeWeekStreak(days: Map<DateKey, HistoryDay>, todayKey: DateKey): number {
  if (!days.size) return 0;
  const activeWeeks = new Set([...days.keys()].map(startOfWeek));
  const thisWeek = startOfWeek(todayKey);
  let cursor = activeWeeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let streak = 0;
  while (activeWeeks.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

export function latestSessionKey(days: Map<DateKey, HistoryDay>): DateKey | null {
  let latest: DateKey | null = null;
  for (const key of days.keys()) if (!latest || key > latest) latest = key;
  return latest;
}

// Monday-first grid covering the whole month, padded with the neighbouring months' days so
// every row holds seven cells and the calendar never changes height between months.
export function monthGrid(month: MonthKey, days: Map<DateKey, HistoryDay>, todayKey: DateKey): HistoryCell[][] {
  const first = parseDateKey(`${month}-01`);
  if (!first) return [];
  const gridStart = startOfWeek(dateKeyFromDate(first));
  const lastOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const gridEnd = addDays(startOfWeek(dateKeyFromDate(lastOfMonth)), 6);
  const weeks: HistoryCell[][] = [];
  let cursor = gridStart;
  while (true) {
    const week: HistoryCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const date = parseDateKey(cursor);
      week.push({
        key: cursor,
        dayOfMonth: date ? date.getDate() : 0,
        inMonth: monthKeyOf(cursor) === month,
        isToday: cursor === todayKey,
        isFuture: cursor > todayKey,
        day: days.get(cursor) || null
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (week[6].key >= gridEnd) break;
  }
  return weeks;
}

export interface HistoryModelOptions {
  now?: Date;
  monthKey?: MonthKey | null;
  locale?: string;
}

export function buildHistoryModel(sessions: ActiveSession[], options: HistoryModelOptions = {}): HistoryModel {
  const todayKey = dateKeyFromDate(options.now || new Date());
  const days = groupSessionsByDay(sessions);
  const month = options.monthKey && parseDateKey(`${options.monthKey}-01`) ? options.monthKey : monthKeyOf(todayKey);
  const latestKey = latestSessionKey(days);
  let workoutsInMonth = 0;
  for (const [key, day] of days) if (monthKeyOf(key) === month) workoutsInMonth += day.sessionCount;
  return {
    monthKey: month,
    monthLabel: monthLabel(month, options.locale),
    todayKey,
    weeks: monthGrid(month, days, todayKey),
    days,
    summary: {
      workoutsInMonth,
      activeWeekStreak: activeWeekStreak(days, todayKey),
      daysSinceLatest: latestKey ? Math.max(0, daysBetween(latestKey, todayKey)) : null,
      latestKey
    }
  };
}

// Sessions on one local day, newest first. Ties break on id so the order is deterministic
// when two sessions share a finish timestamp.
export function sessionsOnDay(sessions: ActiveSession[], key: DateKey): ActiveSession[] {
  return sessions
    .filter((session) => session.finishedAt && sessionDateKey(session) === key)
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '') || b.id - a.id);
}

export interface HistoryDayGroup {
  key: DateKey;
  sessions: ActiveSession[];
}

// Newest-first day groups for the timeline. Undated sessions are dropped rather than
// bucketed under a guessed heading.
export function groupSessionsForTimeline(sessions: ActiveSession[]): HistoryDayGroup[] {
  const keys = new Set<DateKey>();
  for (const session of sessions) {
    if (!session.finishedAt) continue;
    const key = sessionDateKey(session);
    if (key) keys.add(key);
  }
  return [...keys].sort().reverse().map((key) => ({ key, sessions: sessionsOnDay(sessions, key) }));
}

export { addMonths };
