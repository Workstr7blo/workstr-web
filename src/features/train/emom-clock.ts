export interface EmomClockState {
  positionSec: number;
  activeSec: number;
  runningSinceMs: number | null;
}

export interface EmomClockSnapshot extends EmomClockState {
  running: boolean;
}

export function emomClockSnapshot(clock: EmomClockState, nowMs = Date.now()): EmomClockSnapshot {
  const deltaSec = clock.runningSinceMs == null ? 0 : Math.max(0, (nowMs - clock.runningSinceMs) / 1000);
  return {
    positionSec: Math.max(0, clock.positionSec + deltaSec),
    activeSec: Math.max(0, clock.activeSec + deltaSec),
    runningSinceMs: clock.runningSinceMs,
    running: clock.runningSinceMs != null
  };
}

export function pauseEmomClock(clock: EmomClockState, nowMs = Date.now()): EmomClockState {
  const snapshot = emomClockSnapshot(clock, nowMs);
  return { positionSec: snapshot.positionSec, activeSec: snapshot.activeSec, runningSinceMs: null };
}

export function resumeEmomClock(clock: EmomClockState, nowMs = Date.now()): EmomClockState {
  const snapshot = emomClockSnapshot(clock, nowMs);
  return { positionSec: snapshot.positionSec, activeSec: snapshot.activeSec, runningSinceMs: nowMs };
}

export function seekEmomClock(clock: EmomClockState, positionSec: number, nowMs = Date.now()): EmomClockState {
  const snapshot = emomClockSnapshot(clock, nowMs);
  return {
    positionSec: Math.max(0, positionSec),
    activeSec: snapshot.activeSec,
    runningSinceMs: snapshot.running ? nowMs : null
  };
}
