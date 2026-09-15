import { applyPendingUpdate, registerServiceWorker, updatePending } from './pwa';
import type { AppState } from './state';

export interface UpdateControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
}

export interface UpdateController {
  canApplyNow(): boolean;
  settle(): void;
}

// A reload also locks an unlocked device vault, whose session lives only in memory. For someone
// with a device code a quick trip to another app is therefore not a free moment: they would
// come back to the code prompt. Their update waits until they have been away this long, when
// being asked for the code on return is no surprise.
export const VAULT_UPDATE_AWAY_MS = 10 * 60 * 1000;

// Without this the app never picks up a deployment: an installed PWA resumes its existing
// page instead of navigating, so a client can run a build for days. The rule is that an
// update is applied at a moment where a reload costs the user nothing.
export function createUpdateController(ctx: UpdateControllerContext): UpdateController {
  const canApplyNow = (): boolean => {
    // A live session and a half-filled builder are both destroyed by a reload.
    if (ctx.state.activeSession) return false;
    if (ctx.root.querySelector('#session-overlay')?.classList.contains('open')) return false;
    if (ctx.root.querySelector('#modal')?.classList.contains('open')) return false;
    return true;
  };

  const settle = (): void => {
    if (updatePending() && canApplyNow()) applyPendingUpdate();
  };

  const vaultOpen = (): boolean => ctx.state.deviceVault === 'unlocked';
  let hiddenAt: number | null = null;
  let awayTimer: ReturnType<typeof setTimeout> | undefined;

  void registerServiceWorker({
    onUpdateWaiting: () => ctx.toast(vaultOpen()
      ? 'Update ready. It will apply after you have been away from the app for a while.'
      : 'Update ready. It will apply next time you leave the app.')
  });

  // Leaving the app is the only free moment to reload: the user returns to a fresh build
  // and never sees it happen. Reloading while the app is on screen would throw them back
  // to the default tab for no reason they asked for.
  document.addEventListener('visibilitychange', () => {
    clearTimeout(awayTimer);
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (!vaultOpen()) { settle(); return; }
      // Phones throttle or freeze background timers, so this may never fire there; the check
      // on return below catches that case.
      awayTimer = setTimeout(() => { if (document.visibilityState === 'hidden') settle(); }, VAULT_UPDATE_AWAY_MS);
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    // Back after a long absence. This reload is on screen, but it only brings forward a code
    // prompt that much time away makes reasonable, and the build would otherwise stay stale.
    if (vaultOpen() && away >= VAULT_UPDATE_AWAY_MS) settle();
  });

  return { canApplyNow, settle };
}
