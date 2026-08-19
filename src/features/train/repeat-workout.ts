import type { TrainingBlock, TrainingStep } from '../../core/types';
import { sessionExercises, type ActiveSession, type SessionExercise } from '../../app/state';

// Repeating builds the next session out of the completed session's own denormalized
// snapshot — never the program it came from or the current exercise library. That is the
// whole point: the workout you did is repeatable even after the program was edited, the
// exercises renamed, or the whole thing deleted.

export interface RepeatSeed {
  name: string;
  exercises: SessionExercise[];
  blocks?: TrainingBlock[];
  summaryImageUrl: string;
}

function blockSteps(block: TrainingBlock): TrainingStep[] {
  return block.type === 'emom' ? block.intervals.flatMap((interval) => interval.steps) : block.steps;
}

// A step is runnable when the snapshot can still name the movement: either it matches a
// session exercise or it carries its own name. Anything else would put a blank card in
// front of someone mid-workout.
function stepIsResolvable(step: TrainingStep, slugs: Set<string>): boolean {
  return Boolean(step.exerciseSlug && slugs.has(step.exerciseSlug)) || Boolean(step.exerciseName);
}

// Null when the session can be repeated; otherwise the reason to show on the disabled
// action. Better a plain explanation than a session built out of a broken snapshot.
export function repeatBlockedReason(session: ActiveSession): string | null {
  const exercises = sessionExercises(session);
  if (!exercises.length) {
    return 'This workout was saved before Workstr stored what you trained, so there is nothing to rebuild it from.';
  }
  const slugs = new Set(exercises.map((exercise) => exercise.exerciseSlug).filter(Boolean));
  const blocks = session.blocks || [];
  const unresolvable = blocks.some((block) => {
    const steps = blockSteps(block);
    return steps.length > 0 && !steps.every((step) => stepIsResolvable(step, slugs));
  });
  if (unresolvable) {
    return 'This workout\'s timed or superset structure references exercises the session did not record, so it cannot be rebuilt safely.';
  }
  return null;
}

export function canRepeat(session: ActiveSession): boolean {
  return repeatBlockedReason(session) === null;
}

// What was actually lifted last time, offered as the starting value in the new session's
// input. It is a prescription placeholder, exactly like a program's suggested weight —
// nothing is logged until the set is completed.
function lastCompletedWeight(session: ActiveSession, slug: string): number | null {
  const logged = session.sets
    .filter((set) => set.done && set.exerciseSlug === slug && set.weight != null)
    .sort((a, b) => a.setNumber - b.setNumber);
  return logged.length ? logged[logged.length - 1].weight : null;
}

// Structured clone by hand: the new session must never share array or object identity with
// the stored history, or editing one would mutate the other.
function copyBlocks(blocks: TrainingBlock[] | undefined): TrainingBlock[] | undefined {
  if (!blocks?.length) return undefined;
  return blocks.map((block) => block.type === 'emom'
    ? { ...block, intervals: block.intervals.map((interval) => ({ ...interval, steps: interval.steps.map((step) => ({ ...step })) })) }
    : { ...block, steps: block.steps.map((step) => ({ ...step })) });
}

export function repeatSeed(session: ActiveSession): RepeatSeed {
  const exercises = sessionExercises(session).map((exercise) => ({
    ...exercise,
    instructions: exercise.instructions ? [...exercise.instructions] : undefined,
    weight: lastCompletedWeight(session, exercise.exerciseSlug) ?? exercise.weight ?? null
  }));
  return {
    name: session.sheetName || 'Freestyle',
    exercises,
    blocks: copyBlocks(session.blocks),
    summaryImageUrl: session.summaryImageUrl || ''
  };
}
