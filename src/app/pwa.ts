export interface ServiceWorkerUpdateOptions {
  // Fired once per parked version. Applying it is the caller's decision, since the reload
  // it causes is only free at certain moments.
  onUpdateWaiting?(): void;
}

// The browser only re-checks a registration on navigation, which an installed PWA may not
// do for days. Poll instead, cheaply: an unchanged worker is a conditional request.
const UPDATE_POLL_MS = 30 * 60 * 1000;

let waiting: ServiceWorker | null = null;
let options: ServiceWorkerUpdateOptions | null = null;
let reloading = false;

export function updatePending(): boolean {
  return waiting !== null;
}

export function applyPendingUpdate(): void {
  if (!waiting || reloading) return;
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function trackWaiting(registration: ServiceWorkerRegistration): void {
  const next = registration.waiting;
  // A first install has nothing to replace; only an update leaves a worker parked.
  if (!next || next === waiting || !navigator.serviceWorker.controller) return;
  waiting = next;
  options?.onUpdateWaiting?.();
}

export async function registerServiceWorker(update?: ServiceWorkerUpdateOptions): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  options = update || null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only a takeover this page asked for is safe to reload into. A first install claiming
    // an uncontrolled page also lands here, and must not reload: it replaced nothing.
    if (!reloading) return;
    window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    trackWaiting(registration);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') trackWaiting(registration);
      });
    });
    const check = (): void => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    window.setInterval(check, UPDATE_POLL_MS);
  } catch (error) {
    console.warn('service worker registration failed', error);
  }
}
