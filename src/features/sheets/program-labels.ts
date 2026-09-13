import { canonMuscle } from '../../core/muscles';
import { EQUIPMENT_KEYS, equipmentKey } from '../../core/equipment';
import { normalizeTrainingLevel } from '../../core/training-taxonomy';
import type { Exercise } from '../../core/types';
import type { RelayProgram } from '../../nostr/canon';
import { estimateProgramMin, inferProgramMuscle, programExerciseName, resolveProgramExercise } from './views';

export const PROGRAM_GOALS = ['strength', 'hypertrophy', 'conditioning', 'mobility', 'endurance', 'recovery'];
export const PROGRAM_FOCUS_LABELS = ['full-body', 'upper-body', 'lower-body', 'push', 'pull', 'legs', 'core'];
export const PROGRAM_FORMAT_LABELS = ['normal', 'emom', 'superset', 'circuit'];

// Equipment a program can be called low-kit on without owning a rack.
const MINIMAL_EQUIPMENT = ['body weight', 'dumbbell', 'bands'];

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

// Each program filter reads its own source, so a value from one can never satisfy another:
// Goal only from what the author chose, Level only from the stated difficulty, and Focus,
// Format and Equipment from the program's exercises and blocks. An exercise's movement type
// is never read here, which is what keeps a Cardio exercise from making a program Endurance.
export interface ProgramTaxonomy {
  goals: string[];
  focus: string[];
  format: string[];
  level: string;
  // Canonical keys, the same ones the exercise Equipment facet and a saved kit use.
  equipment: string[];
}

export function programTaxonomy(program: RelayProgram, exercises: Exercise[]): ProgramTaxonomy {
  const emomBlocks = program.blocks?.filter((block) => block.type === 'emom') || [];
  const straightBlocks = program.blocks?.filter((block) => block.type === 'straight') || [];
  const format = [emomBlocks.length ? 'emom' : 'normal'];
  if (straightBlocks.some((block) => block.steps.length > 1)) format.push('superset');
  if (emomBlocks.some((block) => block.intervals.some((interval) => interval.steps.length > 1))) format.push('circuit');

  const muscles = new Set<string>();
  const equipment = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const muscle = canonMuscle(member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full)));
    if (muscle) muscles.add(muscle);
    for (const item of full?.equipment || []) {
      const key = equipmentKey(item);
      if (key) equipment.add(key);
    }
  }
  const has = (items: string[]) => items.some((item) => muscles.has(item));
  const upper = has(['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps']);
  const lower = has(['Quadriceps', 'Hamstrings', 'Glutes', 'Calves']);
  const focus: string[] = [];
  if (upper && lower) focus.push('full-body');
  else if (upper) focus.push('upper-body');
  else if (lower) focus.push('lower-body');
  if (has(['Chest', 'Shoulders', 'Triceps'])) focus.push('push');
  if (has(['Back', 'Biceps'])) focus.push('pull');
  if (lower) focus.push('legs');
  if (muscles.has('Core')) focus.push('core');

  return {
    goals: selectedProgramGoals(program.tags || []),
    focus,
    format,
    level: normalizeTrainingLevel(program.difficulty),
    equipment: [...equipment]
  };
}

export function inferProgramLabels(program: RelayProgram, exercises: Exercise[]): string[] {
  const { focus, format, equipment } = programTaxonomy(program, exercises);
  const labels = [...format, ...focus, ...equipment];
  if (!equipment.length || equipment.every((item) => MINIMAL_EQUIPMENT.includes(item))) labels.push('minimal-equipment');
  if (estimateProgramMin(program.exercises, program.blocks) <= 1800) labels.push('quick');
  return uniqueTags(labels);
}

export function programDisplayTags(program: RelayProgram, exercises: Exercise[]): string[] {
  const { goals, focus, format, equipment } = programTaxonomy(program, exercises);
  const structure = format.find((tag) => tag !== 'normal');
  const kit = equipment.find((item) => EQUIPMENT_KEYS.includes(item));
  return uniqueTags([...goals, structure || '', focus[0] || '', kit || '']).slice(0, 4);
}

export function programSearchTags(program: RelayProgram, exercises: Exercise[]): string[] {
  return uniqueTags([...selectedProgramGoals(program.tags || []), ...inferProgramLabels(program, exercises)]);
}
