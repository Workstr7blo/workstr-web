// How long a device-code prompt makes someone wait after wrong codes. Shared by the lock screen,
// the unlock modal and Change device code, so a guess counts the same wherever it is typed.
//
// Browser-side delays only slow someone typing at a prompt. Anyone holding a copy of the vault
// database guesses offline at whatever rate their hardware allows; the Argon2id cost is the
// defence there, not this.
import { isDeviceVaultError } from '../security/device-vault-types';

export const MAX_UNLOCK_DELAY_MS = 60_000;

// The wait survives a reload, because a reload is exactly what opens the lock screen: kept in
// memory only, it would end at a pull-to-refresh. Neither number is secret.
export const UNLOCK_BACKOFF_KEY = 'workstr.deviceVault.unlockBackoff';

export function unlockDelayMs(failures: number): number {
  return failures < 3 ? 0 : Math.min(MAX_UNLOCK_DELAY_MS, 1000 * 2 ** (failures - 3));
}

export interface UnlockBackoff {
  /** Milliseconds until the next attempt is allowed; 0 when it is allowed now. */
  remainingMs(): number;
  waitMessage(): string | null;
  /** Counts only wrong codes, never malformed ones or storage failures. */
  recordFailure(error: unknown): void;
  clear(): void;
}

function readStored(): { failures: number; retryAt: number } {
  try {
    const stored = JSON.parse(localStorage.getItem(UNLOCK_BACKOFF_KEY) || 'null') as { failures?: unknown; retryAt?: unknown } | null;
    const failures = Number(stored?.failures);
    const retryAt = Number(stored?.retryAt);
    return {
      failures: Number.isSafeInteger(failures) && failures > 0 ? failures : 0,
      retryAt: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0
    };
  } catch {
    return { failures: 0, retryAt: 0 };
  }
}

export function createUnlockBackoff(now: () => number): UnlockBackoff {
  const stored = readStored();
  let failures = stored.failures;
  // Capped, so a device clock that has since moved backwards cannot stretch one wait into hours.
  let retryAt = Math.min(stored.retryAt, now() + MAX_UNLOCK_DELAY_MS);

  function save(): void {
    try {
      if (failures) localStorage.setItem(UNLOCK_BACKOFF_KEY, JSON.stringify({ failures, retryAt }));
      else localStorage.removeItem(UNLOCK_BACKOFF_KEY);
    } catch {
      // Storage refused: the wait still holds until this page reloads.
    }
  }

  const remainingMs = (): number => Math.max(0, retryAt - now());

  return {
    remainingMs,
    waitMessage() {
      const seconds = Math.ceil(remainingMs() / 1000);
      return seconds > 0 ? `Too many incorrect attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.` : null;
    },
    recordFailure(error) {
      if (!isDeviceVaultError(error, 'incorrect-pin')) return;
      failures += 1;
      retryAt = now() + unlockDelayMs(failures);
      save();
    },
    clear() {
      failures = 0;
      retryAt = 0;
      save();
    }
  };
}
