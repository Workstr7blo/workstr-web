// Whether the connected signer answers a request by itself, remembered across page loads.
//
// `withSignerTimeout` may only retry a lost answer early when it knows no human is waiting
// to tap approve, and the sole evidence of that is how fast a call has answered. That
// evidence comes from a call that succeeded — which the one call most exposed to a lost
// answer, the first on a cold connection, never produces. Kept only in memory it is
// therefore blank exactly when it is needed: every page load starts over and pays the whole
// 45s budget before the retry that would have recovered the answer in nine seconds.
//
// Remembered against the connection rather than the device, so signing out forgets it: it
// describes one signer's permission grant, and the next one may prompt for everything.
const STORAGE_KEY = 'workstr.signer.answersItself';

export interface AutoApproveMemory {
  known(): boolean;
  record(): void;
}

// Storage can be absent or throw outright — a private window, a browser set to block site
// data. Losing the memory only costs the slow path that existed before it, so every access
// falls back to a value held for this page instead of failing a signer call.
let session = false;

function read(): boolean {
  if (session) return true;
  try {
    session = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    session = false;
  }
  return session;
}

export function rememberedAutoApprove(): AutoApproveMemory {
  return {
    known: read,
    record: () => {
      if (read()) return;
      session = true;
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Kept for this page only.
      }
    }
  };
}

export function forgetAutoApprove(): void {
  session = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored to remove.
  }
}
