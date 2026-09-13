import type { EmomBlock, TrainingStep } from '../../core/types';

export interface EmomSlot {
  index: number;
  blockIndex: number;
  // The coordinates a logged set is stored and found by. Every slot of a block has its own pair,
  // for sections with a length and for legacy ones alike.
  roundIndex: number;
  intervalIndex: number;
  // The slot's place in its own section and how many the section has: what "Minute 3/10" reads.
  minuteIndex: number;
  minuteCount: number;
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

// A section with a total duration plays its moves in list order, one per interval, repeating the
// list until the duration runs out: two moves over ten minutes is ten minutes, never twenty, and a
// move count that does not divide the duration simply stops part way through the list. A section
// saved before sections had a length keeps playing every round of every interval, exactly as long
// as it always did.
export function compileEmomSchedule(block: EmomBlock, blockIndex = 0, startsAtSec = 0, startsAtIndex = 0): EmomSlot[] {
  const intervals = (block.intervals || []).filter((interval) => Number(interval.durationSec) > 0 && interval.steps?.length);
  const totalSec = Math.floor(Number(block.totalDurationSec) || 0);
  const rounds = Math.max(0, Math.floor(Number(block.rounds) || 0));
  const slots: EmomSlot[] = [];
  let cursorSec = startsAtSec;
  const intervalSec = (position: number) => Math.max(1, Math.floor(Number(intervals[position % intervals.length].durationSec)));
  const push = (position: number, durationSec: number) => {
    const intervalIndex = position % intervals.length;
    slots.push({
      index: startsAtIndex + slots.length,
      blockIndex,
      roundIndex: Math.floor(position / intervals.length),
      intervalIndex,
      minuteIndex: position,
      minuteCount: 0,
      startsAtSec: cursorSec,
      endsAtSec: cursorSec + durationSec,
      durationSec,
      steps: intervals[intervalIndex].steps
    });
    cursorSec += durationSec;
  };
  if (intervals.length && totalSec > 0) {
    for (let position = 0; cursorSec - startsAtSec < totalSec; position += 1) {
      push(position, Math.min(intervalSec(position), totalSec - (cursorSec - startsAtSec)));
    }
  } else if (intervals.length) {
    for (let position = 0; position < rounds * intervals.length; position += 1) push(position, intervalSec(position));
  }
  for (const slot of slots) slot.minuteCount = slots.length;
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
