import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import type { RelayProgram } from '../../nostr/canon';
import { estimateProgramMin, inferProgramMuscle, programExerciseName, resolveProgramExercise } from './views';

export const PROGRAM_GOALS = ['strength', 'hypertrophy', 'conditioning', 'mobility', 'endurance', 'recovery'];
export const PROGRAM_FOCUS_LABELS = ['full-body', 'upper-body', 'lower-body', 'push', 'pull', 'legs', 'core'];
export const PROGRAM_FORMAT_LABELS = ['normal', 'emom', 'superset', 'circuit'];
export const PROGRAM_EQUIPMENT_LABELS = ['bodyweight', 'dumbbell', 'barbell', 'kettlebell', 'bands', 'machine', 'minimal-equipment'];

function tagSlug(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function uniqueTags(values: string[]): string[] {
  return [...new Set(values.map(tagSlug).filter(Boolean))];
}

export function selectedProgramGoals(tags: string[] = []): string[] {
  const set = new Set(tags.map(tagSlug));
  return PROGRAM_GOALS.filter((goal) => set.has(goal));
}

function equipmentLabel(equipment: string): string {
  const key = tagSlug(equipment);
  if (/body-?weight|body-only|none|no-equipment/.test(key)) return 'bodyweight';
  if (/dumbbell/.test(key)) return 'dumbbell';
  if (/barbell/.test(key)) return 'barbell';
  if (/kettlebell/.test(key)) return 'kettlebell';
  if (/band/.test(key)) return 'bands';
  if (/machine|cable/.test(key)) return 'machine';
  return key;
}

export function inferProgramLabels(program: RelayProgram, exercises: Exercise[]): string[] {
  const labels: string[] = [];
  const emomBlocks = program.blocks?.filter((block) => block.type === 'emom') || [];
  const straightBlocks = program.blocks?.filter((block) => block.type === 'straight') || [];
  if (emomBlocks.length) labels.push('emom');
  else labels.push('normal');
  if (straightBlocks.some((block) => block.steps.length > 1)) labels.push('superset');
  if (emomBlocks.some((block) => block.intervals.some((interval) => interval.steps.length > 1))) labels.push('circuit');

  const muscles = new Set<string>();
  const equipment = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const muscle = canonMuscle(member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full)));
    if (muscle) muscles.add(muscle);
    for (const item of full?.equipment || []) equipment.add(equipmentLabel(item));
  }
  const has = (items: string[]) => items.some((item) => muscles.has(item));
  const upper = has(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps']);
  const lower = has(['Quadriceps', 'Hamstrings', 'Glutes', 'Calves']);
  const core = muscles.has('Core');
  if (upper && lower) labels.push('full-body');
  else if (upper) labels.push('upper-body');
  else if (lower) labels.push('lower-body');
  if (has(['Chest', 'Shoulders', 'Triceps'])) labels.push('push');
  if (has(['Back', 'Biceps'])) labels.push('pull');
  if (lower) labels.push('legs');
  if (core) labels.push('core');

  const eq = [...equipment].filter(Boolean);
  labels.push(...eq);
  if (!eq.length || eq.every((item) => ['bodyweight', 'dumbbell', 'bands'].includes(item))) labels.push('minimal-equipment');
  if (estimateProgramMin(program.exercises, program.blocks) <= 1800) labels.push('quick');
  return uniqueTags(labels);
}

export function programDisplayTags(program: RelayProgram, exercises: Exercise[]): string[] {
  const labels = inferProgramLabels(program, exercises);
  const goals = selectedProgramGoals(program.tags || []);
  const format = labels.find((tag) => ['emom', 'superset', 'circuit'].includes(tag));
  const focus = labels.find((tag) => ['full-body', 'upper-body', 'lower-body', 'push', 'pull', 'legs', 'core'].includes(tag));
  const equipment = labels.find((tag) => ['dumbbell', 'barbell', 'kettlebell', 'bands', 'machine', 'bodyweight'].includes(tag));
  return uniqueTags([...goals, format || '', focus || '', equipment || '']).slice(0, 4);
}

export function programSearchTags(program: RelayProgram, exercises: Exercise[]): string[] {
  return uniqueTags([...selectedProgramGoals(program.tags || []), ...inferProgramLabels(program, exercises)]);
}
