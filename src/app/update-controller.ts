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

  void registerServiceWorker({
    onUpdateWaiting: () => ctx.toast('Update ready. It will apply next time you leave the app.')
  });

  // Leaving the app is the only free moment to reload: the user returns to a fresh build
  // and never sees it happen. Reloading while the app is on screen would throw them back
  // to the default tab for no reason they asked for.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') settle();
  });

  return { canApplyNow, settle };
}
