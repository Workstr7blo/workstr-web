import 'fake-indexeddb/auto';

/**
 * No test may open a real connection.
 *
 * Relay work is started and not awaited — `renderShell` fires catalog, profile and payment
 * lookups in the background — so a socket opened by a test outlives it. When the promise
 * finally settles it calls `render()`, which touches `document`, and by then the jsdom
 * environment for that file is gone: the run fails with `ReferenceError: document is not
 * defined` pointing at shell.ts, on a random file, having passed every assertion.
 *
 * That was previously handled by naming each fetch in a `vi.mock`. The list fell behind
 * every time a relay call was added — four of eight were unmocked when this was written —
 * and the failure it produces names neither the call nor the test that started it.
 *
 * So the boundary is closed here instead of enumerated per test. A test that needs relay
 * data mocks the module it calls, or injects a fake pool through the `poolFactory` options
 * `payment-targets` and `program-publish` already accept. Anything else fails immediately,
 * in the test that caused it, saying what it tried to reach.
 */
function blocked(kind: string, target: unknown): Error {
  return new Error(
    `${kind} blocked in tests: ${String(target)}\n` +
    'Mock the module that makes this call, or inject a fake pool via poolFactory. ' +
    'See tests/setup.ts.'
  );
}

// Loopback is a test standing up its own server - the NWC mock wallet does exactly this -
// and is the opposite of the problem: it is deterministic and shuts down with the test.
function isLoopback(url: string): boolean {
  return /^(wss?|https?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
}

// Subclassed rather than wrapped: returning a different object from the constructor would
// leave `instanceof WebSocket` false for every socket in the suite.
const RealWebSocket = globalThis.WebSocket;
class GuardedWebSocket extends RealWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const href = String(url);
    // Throwing before super() is legal as long as `this` is untouched.
    if (!isLoopback(href)) throw blocked('WebSocket', href);
    super(href, protocols);
  }
}

Object.defineProperty(globalThis, 'WebSocket', {
  configurable: true,
  writable: true,
  value: GuardedWebSocket
});

const realFetch = globalThis.fetch;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isLoopback(url)) return realFetch(input, init);
    return Promise.reject(blocked('fetch', url));
  }
});
