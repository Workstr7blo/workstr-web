import type { EmomBlock, StraightBlock } from '../../core/types';
import type { ActiveSession, SessionExercise } from '../../app/state';
import type { EmomClockState } from './emom-clock';
import type { EmomPosition, EmomSlot } from './emom';

export interface EmomTimerPhase {
  mode: 'work' | 'recovery';
  secondsRemaining: number;
  durationSec: number;
  stepIndex: number | null;
}

export interface SupersetTransition {
  blockIndex: number;
  roundIndex: number;
  stepIndex: number;
  stepCount: number;
  rounds: number;
  nextExerciseSlug: string | null;
  restAfterRoundSec: number;
  roundComplete: boolean;
  supersetComplete: boolean;
}

export function activeSupersetBlocks(session: ActiveSession): Array<{ block: StraightBlock; blockIndex: number }> {
  return (session.blocks || []).flatMap((block, blockIndex) =>
    block.type === 'straight' && block.steps.length > 1 ? [{ block, blockIndex }] : []
  );
}

export function supersetTransition(session: ActiveSession, exerciseSlug: string, setNumber: number): SupersetTransition | null {
  for (const { block, blockIndex } of activeSupersetBlocks(session)) {
    const stepIndex = block.steps.findIndex((step) => step.exerciseSlug === exerciseSlug);
    if (stepIndex < 0) continue;
    const roundIndex = Math.max(0, Math.min(block.rounds - 1, Math.floor(Number(setNumber) || 1) - 1));
    const roundComplete = stepIndex === block.steps.length - 1;
    const supersetComplete = roundComplete && roundIndex === block.rounds - 1;
    return {
      blockIndex, roundIndex, stepIndex, stepCount: block.steps.length, rounds: block.rounds,
      nextExerciseSlug: supersetComplete ? null : block.steps[roundComplete ? 0 : stepIndex + 1]?.exerciseSlug || null,
      restAfterRoundSec: roundComplete ? Math.max(0, Number(block.restAfterRoundSec) || 0) : 0,
      roundComplete, supersetComplete
    };
  }
  return null;
}

export function restSecondsRemaining(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function activeEmomBlocks(session: ActiveSession | null): EmomBlock[] {
  return (session?.blocks || []).filter((block): block is EmomBlock => block.type === 'emom');
}

function emomExerciseSlugs(session: ActiveSession | null): Set<string> {
  return new Set(activeEmomBlocks(session).flatMap((block) =>
    block.intervals.flatMap((interval) => interval.steps.map((step) => step.exerciseSlug).filter(Boolean))
  ));
}

function straightExerciseSlugs(session: ActiveSession | null): Set<string> {
  return new Set((session?.blocks || []).flatMap((block) =>
    block.type === 'straight' ? block.steps.map((step) => step.exerciseSlug).filter(Boolean) : []
  ));
}

export function standardSessionExercises(session: ActiveSession): SessionExercise[] {
  const emomSlugs = emomExerciseSlugs(session);
  if (!emomSlugs.size) return session.exercises;
  const straightSlugs = straightExerciseSlugs(session);
  return session.exercises.filter((exercise) => !emomSlugs.has(exercise.exerciseSlug) || straightSlugs.has(exercise.exerciseSlug));
}

export function sessionSetCounts(session: ActiveSession): Record<string, number> {
  const counts: Record<string, number> = {};
  standardSessionExercises(session).forEach((exercise) => {
    const logged = session.sets.filter((set) => set.exerciseSlug === exercise.exerciseSlug).length;
    counts[exercise.exerciseSlug] = Math.max(Number(exercise.sets) || 1, logged || 1);
  });
  return counts;
}

export function standardWorkComplete(session: ActiveSession): boolean {
  const exercises = standardSessionExercises(session);
  return exercises.length > 0 && exercises.every((exercise) => {
    const target = Number(exercise.sets) || 1;
    return session.sets.filter((set) => set.exerciseSlug === exercise.exerciseSlug && set.done).length >= target;
  });
}

export function exerciseSlugSignature(exercises: SessionExercise[]): string {
  return [...new Set(exercises.map((exercise) => exercise.exerciseSlug).filter(Boolean))].sort().join('|');
}

export function isEmomSession(session: ActiveSession): boolean {
  return activeEmomBlocks(session).length > 0;
}

// Mixed means both halves carry work. An EMOM block that declares no steps claims nothing,
// so the session stays pure EMOM and keeps the EMOM-only clock behaviour.
export function isMixedSession(session: ActiveSession): boolean {
  return emomExerciseSlugs(session).size > 0 && standardSessionExercises(session).length > 0;
}

// Wall-clock seconds the strength section ran before the EMOM clock took over. Pure EMOM
// sessions restart startedAt when the clock starts, so this is zero for them by definition.
export function preEmomElapsedSec(session: ActiveSession): number {
  if (!session.emomStartedAt || !session.startedAt || !isMixedSession(session)) return 0;
  const start = new Date(session.startedAt).getTime();
  const emomStart = new Date(session.emomStartedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(emomStart)) return 0;
  return Math.max(0, Math.round((emomStart - start) / 1000));
}

export function effectiveSessionStartedAt(session: ActiveSession): string | null {
  return isEmomSession(session) && session.emomStartedAt && !isMixedSession(session)
    ? session.emomStartedAt
    : session.startedAt || null;
}

export function readEmomClock(session: ActiveSession): EmomClockState {
  const legacyRunningSince = session.emomRunningSince
    || (session.emomStartedAt && session.emomPositionSec == null ? session.emomStartedAt : undefined);
  const runningSinceMs = legacyRunningSince ? new Date(legacyRunningSince).getTime() : null;
  return {
    positionSec: Number(session.emomPositionSec) || 0,
    activeSec: Number(session.emomActiveSec) || 0,
    runningSinceMs: runningSinceMs != null && Number.isFinite(runningSinceMs) ? runningSinceMs : null
  };
}

export function writeEmomClock(session: ActiveSession, clock: EmomClockState): void {
  session.emomPositionSec = clock.positionSec;
  session.emomActiveSec = clock.activeSec;
  session.emomRunningSince = clock.runningSinceMs == null ? undefined : new Date(clock.runningSinceMs).toISOString();
}

export function emomTimerPhase(slot: EmomSlot, elapsedInSlotSec: number): EmomTimerPhase | null {
  if (!slot.steps.length || !slot.steps.every((step) => Number(step.targetDurationSec) > 0)) return null;
  let startsAtSec = 0;
  for (let stepIndex = 0; stepIndex < slot.steps.length; stepIndex += 1) {
    const durationSec = Math.max(1, Math.floor(Number(slot.steps[stepIndex].targetDurationSec)));
    const endsAtSec = startsAtSec + durationSec;
    if (elapsedInSlotSec < endsAtSec) {
      return { mode: 'work', secondsRemaining: Math.max(0, Math.ceil(endsAtSec - elapsedInSlotSec)), durationSec, stepIndex };
    }
    startsAtSec = endsAtSec;
  }
  const durationSec = Math.max(0, slot.durationSec - startsAtSec);
  if (!durationSec) return null;
  return { mode: 'recovery', secondsRemaining: Math.max(0, Math.ceil(slot.durationSec - elapsedInSlotSec)), durationSec, stepIndex: null };
}

// Which clock the countdown cues follow. A timed step counts down to the end of its own
// work; everything else counts down to the end of the interval, which is where a recovery
// phase ends too. Picking exactly one source keeps a step that fills its whole interval
// from beeping twice a second.
export function emomCountdownTarget(position: EmomPosition, phase: EmomTimerPhase | null): { channel: string; period: string | number; secondsRemaining: number } | null {
  const slotIndex = position.slot?.index ?? null;
  if (position.phase !== 'running' || slotIndex === null) return null;
  if (phase?.mode === 'work') {
    return { channel: 'emom-work', period: `${slotIndex}:${phase.stepIndex}`, secondsRemaining: phase.secondsRemaining };
  }
  return { channel: 'emom', period: slotIndex, secondsRemaining: position.secondsRemaining };
}

export function sessionDurationSeconds(session: ActiveSession): number | null {
  const startedAt = effectiveSessionStartedAt(session);
  if (!startedAt || !session.finishedAt) return null;
  return isEmomSession(session) && session.emomStartedAt && session.emomActiveSec != null
    ? Math.max(0, Math.round(session.emomActiveSec) + preEmomElapsedSec(session))
    : Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}

export function durationLabel(seconds: number | null): string {
  if (seconds == null) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
