import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import { completedSets, type ActiveSession, type QwExercise } from '../../app/state';
import { programMuscleLabel } from '../../app/format';
import { getRecovery } from './recovery';

export interface QuickWorkoutData { exercises: QwExercise[]; pool: Record<string, QwExercise[]>; targetMuscleGroups: string[]; estimatedDurationMin: number }

// Canonicalize a raw muscle group, folding granular names (e.g. "Lateral
// Deltoid") into their canonical group the same way the program cards do.
function qwCanonMuscle(raw: string | undefined): string {
  return canonMuscle(raw || '') || canonMuscle(programMuscleLabel(raw || '')) || '';
}

// Ported verbatim from self-hosted Workstr src/app/store.js getQuickWorkout().
// Untrained muscle groups report 100% recovery, so they are always in readySet.
export function getQuickWorkout(sessions: ActiveSession[], exercises: Exercise[], durationMinutes = 45, minRecovery = 80): QuickWorkoutData {
  const recovery = getRecovery(sessions, exercises);
  const readySet = new Set(recovery.muscleGroups.filter((group) => group.percent >= minRecovery).map((group) => group.name));
  if (!readySet.size) return { exercises: [], pool: {}, targetMuscleGroups: [], estimatedDurationMin: 0 };

  const rows = [...exercises]
    .filter((exercise) => exercise.muscle_group && readySet.has(qwCanonMuscle(exercise.muscle_group)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const loggedSlugs = new Set(completedSets(sessions).map((set) => set.exerciseSlug));

  // Score (logged-before + compound) and bucket exercises by canonical muscle group.
  const byMuscle: Record<string, QwExercise[]> = {};
  for (const row of rows) {
    const mg = qwCanonMuscle(row.muscle_group);
    const score = (loggedSlugs.has(row.slug) ? 1 : 0) + ((row.tags || []).map((tag) => String(tag).toLowerCase()).includes('compound') ? 1 : 0);
    (byMuscle[mg] ||= []).push({ slug: row.slug, name: row.name, muscleGroup: mg, sets: 3, reps: '8-12', restSec: 90, score });
  }
  for (const mg of Object.keys(byMuscle)) byMuscle[mg].sort((a, b) => (b.score || 0) - (a.score || 0));

  // Round-robin across muscle groups so the workout is balanced, up to the time budget.
  const minPerExercise = 9; // ~3 sets x 3 min
  const maxExercises = Math.max(1, Math.floor(durationMinutes / minPerExercise));
  const pools: Record<string, QwExercise[]> = {};
  for (const mg of Object.keys(byMuscle)) pools[mg] = [...byMuscle[mg]];
  const keys = Object.keys(pools);
  const selected: QwExercise[] = [];
  let idx = 0;
  while (selected.length < maxExercises) {
    if (!keys.some((key) => pools[key].length)) break;
    const mg = keys[idx % keys.length];
    if (pools[mg]?.length) selected.push(pools[mg].shift()!);
    idx++;
  }
  const poolOut: Record<string, QwExercise[]> = {};
  for (const mg of keys) if (pools[mg].length) poolOut[mg] = pools[mg];
  return {
    exercises: selected,
    pool: poolOut,
    targetMuscleGroups: [...new Set(selected.map((exercise) => exercise.muscleGroup))],
    estimatedDurationMin: selected.length * minPerExercise
  };
}
