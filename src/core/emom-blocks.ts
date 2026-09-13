import type { EmomBlock } from './types';

// How long an EMOM section lasts. A section saved since sections were given a length carries it;
// one saved before plays every round of every interval, which is how long it has always been.
// Program cards, the program body, the builder and the live runner all read a length from here,
// so an estimate can never disagree with the clock.
export function emomBlockDurationSec(block: EmomBlock): number {
  const total = Math.floor(Number(block.totalDurationSec) || 0);
  if (total > 0) return total;
  const rounds = Math.max(0, Math.floor(Number(block.rounds) || 0));
  return rounds * (block.intervals || []).reduce((sum, interval) => sum + Math.max(0, Number(interval.durationSec) || 0), 0);
}
