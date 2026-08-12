import type { EmomBlock, TrainingStep } from '../../core/types';

export interface EmomSlot {
  index: number;
  blockIndex: number;
  roundIndex: number;
  intervalIndex: number;
  startsAtSec: number;
  endsAtSec: number;
  durationSec: number;
  steps: TrainingStep[];
}

export interface EmomPosition {
  phase: 'pending' | 'running' | 'complete';
  slot: EmomSlot | null;
  secondsRemaining: number;
  elapsedInSlotSec: number;
  activeStepIndex: number | null;
}

export function compileEmomSchedule(block: EmomBlock, blockIndex = 0, startsAtSec = 0, startsAtIndex = 0): EmomSlot[] {
  const rounds = Math.max(0, Math.floor(Number(block.rounds) || 0));
  const intervals = (block.intervals || []).filter((interval) => Number(interval.durationSec) > 0 && interval.steps?.length);
  const slots: EmomSlot[] = [];
  let cursorSec = startsAtSec;
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex += 1) {
      const interval = intervals[intervalIndex];
      const durationSec = Math.max(1, Math.floor(Number(interval.durationSec)));
      slots.push({
        index: startsAtIndex + slots.length,
        blockIndex,
        roundIndex,
        intervalIndex,
        startsAtSec: cursorSec,
        endsAtSec: cursorSec + durationSec,
        durationSec,
        steps: interval.steps
      });
      cursorSec += durationSec;
    }
  }
  return slots;
}

export function compileEmomBlocks(blocks: EmomBlock[]): EmomSlot[] {
  const slots: EmomSlot[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    slots.push(...compileEmomSchedule(blocks[blockIndex], blockIndex, slots.at(-1)?.endsAtSec || 0, slots.length));
  }
  return slots;
}

function activeTimedStep(steps: TrainingStep[], elapsedSec: number): number | null {
  if (!steps.length) return null;
  const allTimed = steps.every((step) => Number(step.targetDurationSec) > 0);
  if (!allTimed) return steps.length === 1 ? 0 : null;
  let boundary = 0;
  for (let index = 0; index < steps.length; index += 1) {
    boundary += Math.max(1, Math.floor(Number(steps[index].targetDurationSec)));
    if (elapsedSec < boundary) return index;
  }
  return null;
}

export function emomPosition(schedule: EmomSlot[], startedAtMs: number | null, nowMs = Date.now()): EmomPosition {
  if (!schedule.length || startedAtMs == null || !Number.isFinite(startedAtMs)) {
    return { phase: 'pending', slot: schedule[0] || null, secondsRemaining: schedule[0]?.durationSec || 0, elapsedInSlotSec: 0, activeStepIndex: schedule[0]?.steps.length === 1 ? 0 : null };
  }
  const elapsedSec = Math.max(0, (nowMs - startedAtMs) / 1000);
  const slot = schedule.find((candidate) => elapsedSec < candidate.endsAtSec) || null;
  if (!slot) return { phase: 'complete', slot: null, secondsRemaining: 0, elapsedInSlotSec: 0, activeStepIndex: null };
  const elapsedInSlotSec = Math.max(0, elapsedSec - slot.startsAtSec);
  return {
    phase: 'running',
    slot,
    secondsRemaining: Math.max(0, Math.ceil(slot.endsAtSec - elapsedSec)),
    elapsedInSlotSec,
    activeStepIndex: activeTimedStep(slot.steps, elapsedInSlotSec)
  };
}

export function emomDurationSec(schedule: EmomSlot[]): number {
  return schedule.at(-1)?.endsAtSec || 0;
}
