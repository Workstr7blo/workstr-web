// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = () => void;

function mockServiceWorker(options: { controlled: boolean }) {
  const listeners: Record<string, Listener[]> = {};
  const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const registration = {
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((name: string, fn: Listener) => { (listeners[name] ||= []).push(fn); })
  };
  const container = {
    controller: options.controlled ? {} : null,
    register: vi.fn(() => Promise.resolve(registration)),
    addEventListener: vi.fn((name: string, fn: Listener) => { (listeners[`sw:${name}`] ||= []).push(fn); })
  };
  vi.stubGlobal('navigator', { serviceWorker: container });
  return {
    container, registration, waiting,
    fire: (name: string) => (listeners[name] || []).forEach((fn) => fn()),
    park: () => { registration.waiting = waiting; }
  };
}

describe('service worker updates', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

  it('reports a parked version and skips waiting only when told to', async () => {
    const sw = mockServiceWorker({ controlled: true });
    sw.park();
    const onUpdateWaiting = vi.fn();
    const pwa = await import('../src/app/pwa');
    await pwa.registerServiceWorker({ onUpdateWaiting });
    expect(onUpdateWaiting).toHaveBeenCalledTimes(1);
    expect(pwa.updatePending()).toBe(true);
    // Detecting an update must not itself take over.
    expect(sw.waiting.postMessage).not.toHaveBeenCalled();
    pwa.applyPendingUpdate();
    expect(sw.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('ignores a first install, which replaces nothing', async () => {
    const sw = mockServiceWorker({ controlled: false });
    sw.park();
    const onUpdateWaiting = vi.fn();
    const pwa = await import('../src/app/pwa');
    await pwa.registerServiceWorker({ onUpdateWaiting });
    expect(onUpdateWaiting).not.toHaveBeenCalled();
    expect(pwa.updatePending()).toBe(false);
  });

  it('does not reload on a takeover it did not ask for', async () => {
    const sw = mockServiceWorker({ controlled: true });
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const pwa = await import('../src/app/pwa');
    await pwa.registerServiceWorker({});
    sw.fire('sw:controllerchange');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once the takeover it asked for arrives', async () => {
    const sw = mockServiceWorker({ controlled: true });
    sw.park();
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const pwa = await import('../src/app/pwa');
    await pwa.registerServiceWorker({});
    pwa.applyPendingUpdate();
    sw.fire('sw:controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('polls for a new version while the page is visible', async () => {
    const sw = mockServiceWorker({ controlled: true });
    vi.useFakeTimers();
    const pwa = await import('../src/app/pwa');
    await pwa.registerServiceWorker({});
    expect(sw.registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(sw.registration.update).toHaveBeenCalledTimes(1);
  });
});

describe('update policy', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function controller(html: string, activeSession: unknown) {
    vi.stubGlobal('navigator', {});
    const root = document.createElement('div');
    root.innerHTML = html;
    const { createUpdateController } = await import('../src/app/update-controller');
    return createUpdateController({ root, state: { activeSession } as never, toast: vi.fn() });
  }

  it('refuses to reload over a live workout', async () => {
    expect((await controller('', { id: 1 })).canApplyNow()).toBe(false);
  });

  it('refuses to reload with the session overlay or a modal open', async () => {
    expect((await controller('<div id="session-overlay" class="open"></div>', null)).canApplyNow()).toBe(false);
    expect((await controller('<div id="modal" class="open"></div>', null)).canApplyNow()).toBe(false);
  });

  it('allows a reload when the app is idle', async () => {
    expect((await controller('<div id="modal"></div><div id="session-overlay"></div>', null)).canApplyNow()).toBe(true);
  });
});

// Installing an update reloads, and a reload locks the device vault. With the vault open, a
// short trip away must not cost the user their code; a long one may.
describe('update timing with a device vault', () => {
  let visibility: DocumentVisibilityState = 'visible';

  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.doUnmock('../src/app/pwa');
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  async function app(deviceVault: string) {
    vi.useFakeTimers();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // A fresh mock per test: controllers from earlier tests stay subscribed to `document`, but
    // they hold their own copy and cannot touch this one.
    const applyPendingUpdate = vi.fn();
    vi.doMock('../src/app/pwa', () => ({ registerServiceWorker: vi.fn(async () => undefined), updatePending: () => true, applyPendingUpdate }));
    const { createUpdateController, VAULT_UPDATE_AWAY_MS } = await import('../src/app/update-controller');
    createUpdateController({ root: document.createElement('div'), state: { activeSession: null, deviceVault } as never, toast: vi.fn() });
    const turn = (next: DocumentVisibilityState) => { visibility = next; document.dispatchEvent(new Event('visibilitychange')); };
    return { applyPendingUpdate, away: VAULT_UPDATE_AWAY_MS, leave: () => turn('hidden'), back: () => turn('visible') };
  }

  it('applies the moment the app is left when there is no open vault', async () => {
    for (const deviceVault of ['absent', 'locked']) {
      const a = await app(deviceVault);
      a.leave();
      expect(a.applyPendingUpdate).toHaveBeenCalledTimes(1);
      vi.resetModules();
    }
  });

  it('waits out a short trip away while the vault is unlocked', async () => {
    const a = await app('unlocked');
    a.leave();
    vi.advanceTimersByTime(60_000);
    a.back();
    expect(a.applyPendingUpdate).not.toHaveBeenCalled();
    // The clock restarts on every departure rather than adding up short trips.
    a.leave();
    vi.advanceTimersByTime(a.away - 1);
    a.back();
    expect(a.applyPendingUpdate).not.toHaveBeenCalled();
  });

  it('applies after the full time away, while still in the background', async () => {
    const a = await app('unlocked');
    a.leave();
    vi.advanceTimersByTime(a.away);
    expect(a.applyPendingUpdate).toHaveBeenCalledTimes(1);
  });

  it('applies on return when a phone froze the background timer', async () => {
    const a = await app('unlocked');
    a.leave();
    // Time passes without the timer running, as on a suspended phone.
    vi.setSystemTime(Date.now() + a.away);
    expect(a.applyPendingUpdate).not.toHaveBeenCalled();
    a.back();
    expect(a.applyPendingUpdate).toHaveBeenCalledTimes(1);
  });
});
