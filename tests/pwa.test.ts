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
