import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import { sessionExercises, type ActiveSession } from '../../app/state';

// Base recovery hours per canonical muscle group (larger groups recover slower).
// Ported verbatim from self-hosted Workstr src/app/store.js getRecovery().
export const RECOVERY_CONFIG: Record<string, number> = {
  Chest: 72, Back: 72, Shoulders: 48, Biceps: 36, Triceps: 36,
  Core: 48, Quadriceps: 72, Hamstrings: 72, Glutes: 48, Calves: 36
};

export interface RecoveryGroup {
  name: string;
  percent: number;
  status: 'ready' | 'partial' | 'recovering' | 'untrained';
  lastTrained: string | null;
  hoursRemaining: number;
  totalSets: number;
}

export interface RecoveryData { muscleGroups: RecoveryGroup[]; overallReadiness: number; readyCount: number; totalCount: number }

// Muscles that only appear as a secondary mover in one compound shouldn't read
// as heavily fatigued as a directly-trained primary.
export function volumeMultiplier(sets: number): number {
  if (sets < 2) return 0.4;
  if (sets < 6) return 0.7;
  if (sets <= 12) return 1.0;
  return 1.2;
}

export function getRecovery(sessions: ActiveSession[], exercises: Exercise[]): RecoveryData {
  const now = Date.now();
  const cutoff = now - 10 * 24 * 3600000;
  // finishedAt -> { canonicalMuscle -> setCount (primary=1, secondary=0.5) }
  const sessionVolumes = new Map<string, Record<string, number>>();
  for (const session of sessions) {
    const finishedAt = session.finishedAt;
    if (!finishedAt || new Date(finishedAt).getTime() < cutoff) continue;
    if (!sessionVolumes.has(finishedAt)) sessionVolumes.set(finishedAt, {});
    const sv = sessionVolumes.get(finishedAt)!;
    for (const set of session.sets.filter((item) => item.done)) {
      const full = exercises.find((exercise) => exercise.slug === set.exerciseSlug);
      const member = sessionExercises(session).find((item) => item.exerciseSlug === set.exerciseSlug);
      const primary = canonMuscle(full?.muscle_group || member?.muscleGroup || '');
      if (primary) sv[primary] = (sv[primary] || 0) + 1;
      for (const raw of full?.muscles || []) {
        const canonical = canonMuscle(raw);
        if (canonical && canonical !== primary) sv[canonical] = (sv[canonical] || 0) + 0.5;
      }
    }
  }
  const sortedSessions = [...sessionVolumes.keys()].sort().reverse();
  const ms = (value: string) => new Date(value).getTime();

  const groups: RecoveryGroup[] = [];
  for (const [muscle, baseHours] of Object.entries(RECOVERY_CONFIG)) {
    let lastTrained: string | null = null;
    let totalSets = 0;
    for (const finishedAt of sortedSessions) {
      const sv = sessionVolumes.get(finishedAt)!;
      if (!(muscle in sv)) continue;
      if (lastTrained === null) { lastTrained = finishedAt; totalSets = sv[muscle]; }
      else if ((ms(lastTrained) - ms(finishedAt)) / 3600000 <= baseHours) totalSets += sv[muscle];
    }
    if (lastTrained === null) {
      groups.push({ name: muscle, percent: 100, status: 'untrained', lastTrained: null, hoursRemaining: 0, totalSets: 0 });
      continue;
    }
    const hoursElapsed = (now - ms(lastTrained)) / 3600000;
    const adjustedHours = baseHours * volumeMultiplier(totalSets);
    const percent = Math.min(100, Math.round((hoursElapsed / adjustedHours) * 100));
    const hoursRemaining = Math.max(0, Math.round((adjustedHours - hoursElapsed) * 10) / 10);
    const status = percent >= 80 ? 'ready' : percent >= 50 ? 'partial' : 'recovering';
    groups.push({ name: muscle, percent, status, lastTrained, hoursRemaining, totalSets: Math.round(totalSets) });
  }

  const trained = groups.filter((group) => group.status !== 'untrained');
  const overallReadiness = trained.length ? Math.round(trained.reduce((total, group) => total + group.percent, 0) / trained.length) : 100;
  const readyCount = groups.filter((group) => group.status === 'ready' || group.status === 'untrained').length;
  return { muscleGroups: groups, overallReadiness, readyCount, totalCount: groups.length };
}
