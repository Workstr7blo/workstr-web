import { describe, expect, it } from 'vitest';
import { emomClockSnapshot, pauseEmomClock, resumeEmomClock, seekEmomClock } from '../src/features/train/emom-clock';

describe('EMOM clock controller', () => {
  it('tracks schedule and active time while running', () => {
    expect(emomClockSnapshot({ positionSec: 10, activeSec: 8, runningSinceMs: 1_000 }, 6_000)).toMatchObject({ positionSec: 15, activeSec: 13, running: true });
  });

  it('freezes both clocks while paused and resumes from their saved values', () => {
    const paused = pauseEmomClock({ positionSec: 10, activeSec: 8, runningSinceMs: 1_000 }, 6_000);
    expect(emomClockSnapshot(paused, 20_000)).toMatchObject({ positionSec: 15, activeSec: 13, running: false });
    expect(resumeEmomClock(paused, 20_000)).toEqual({ positionSec: 15, activeSec: 13, runningSinceMs: 20_000 });
  });

  it('seeks schedule position without changing accumulated active time', () => {
    expect(seekEmomClock({ positionSec: 10, activeSec: 8, runningSinceMs: 1_000 }, 60, 6_000)).toEqual({ positionSec: 60, activeSec: 13, runningSinceMs: 6_000 });
  });
});
