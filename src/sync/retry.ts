// When a failed pass tries again.
//
// Failure is normal on a phone: a tunnel drops, a signer sleeps. Retry gets slower rather
// than hammering a relay that is not answering, and never gives up entirely.
export const RETRY_BASE_MS = 30000;
export const RETRY_MAX_MS = 900000;

// A signer that went quiet is not a relay that is down. Its connection is thrown away and
// rebuilt before the next attempt, and rebuilding it is exactly what recovers an answer
// lost on a cold one — so the usual backoff before that attempt is delay the user watches
// for nothing, on top of the budget already spent finding out. The first attempt after a
// stall comes quickly; a stall that survives it joins the normal curve, because a signer
// that is genuinely away must not be polled every few seconds.
export const STALL_RETRY_MS = 4000;

export interface RetrySchedule {
  // `failures` counts the failed passes since the last success, the one just finished
  // included. `stalled` says that failure was a signer that stopped answering.
  delayMs(failures: number, stalled: boolean): number;
  reset(): void;
}

export function createRetrySchedule(): RetrySchedule {
  let fastRetryUsed = false;
  return {
    delayMs(failures: number, stalled: boolean): number {
      if (stalled && failures === 1) {
        fastRetryUsed = true;
        return STALL_RETRY_MS;
      }
      // The quick attempt after a stall is an extra one rather than a step up the curve: a
      // stall that persists must back off exactly the way any other failure does, one
      // attempt later, instead of skipping a rung because the first wait was short.
      const step = Math.max(failures - (fastRetryUsed ? 2 : 1), 0);
      return Math.min(RETRY_BASE_MS * 2 ** step, RETRY_MAX_MS);
    },
    reset(): void {
      fastRetryUsed = false;
    }
  };
}
