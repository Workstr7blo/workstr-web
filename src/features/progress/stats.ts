import type { Exercise } from '../../core/types';
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

// Ported verbatim from self-hosted Workstr src/app/store.js computeStreak().
export function computeStreak(sessions: ActiveSession[]): number {
  const dates = [...new Set(sessions.filter((session) => session.finishedAt).map((session) => new Date(session.startedAt).toISOString().slice(0, 10)))].sort().reverse();
  if (!dates.length) return 0;
  const dayMs = 86400000;
  const stripTime = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // allow today or yesterday to start the streak
  if (Math.round((stripTime(new Date()) - stripTime(new Date(dates[0]))) / dayMs) > 1) return 0;
  let expect = stripTime(new Date(dates[0]));
  let streak = 0;
  for (const value of dates) {
    const day = stripTime(new Date(value));
    if (day === expect) { streak += 1; expect -= dayMs; }
    else if (day < expect) break;
  }
  return streak;
}

export interface WorkstrStats {
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  weekly: { week: string; volume: number }[];
  muscle: { muscle: string; sets: number }[];
  prs: { slug: string; name: string; e1rm: number; topWeight: number }[];
  streak: number;
}

// Ported verbatim from self-hosted Workstr src/app/store.js getStats().
export function getStats(sessions: ActiveSession[], exercises: Exercise[]): WorkstrStats {
  const sets = completedSets(sessions);
  const totalSessions = sessions.length;
  const totalSets = sets.length;
  const totalVolume = Math.round(sets.reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));

  // Weekly volume (last 8 weeks)
  const weekTotals: Record<string, number> = {};
  for (const session of sessions) {
    const week = sqliteWeek(session.startedAt);
    for (const set of session.sets) {
      if (set.done) weekTotals[week] = (weekTotals[week] || 0) + (Number(set.reps) || 0) * (Number(set.weight) || 0);
    }
  }
  const weekly = Object.entries(weekTotals).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).reverse()
    .map(([week, volume]) => ({ week, volume: Math.round(volume) }));

  // Muscle distribution by sets
  const lookup = (session: ActiveSession, slug: string) =>
    exercises.find((exercise) => exercise.slug === slug)?.muscle_group
    || sessionExercises(session).find((member) => member.exerciseSlug === slug)?.muscleGroup
    || 'Other';
  const muscleTotals: Record<string, number> = {};
  for (const session of sessions) {
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

  return { totalSessions, totalSets, totalVolume, weekly, muscle, prs, streak: computeStreak(sessions) };
}
