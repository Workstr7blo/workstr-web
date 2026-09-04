import { describe, expect, it } from 'vitest';

// The guard in tests/setup.ts is the thing standing between this suite and the intermittent
// `document is not defined` failure. A guard nothing proves is a guard that can be removed
// or broken without anyone noticing, so it is asserted here directly.
describe('network guard', () => {
  it('refuses a relay socket and names it', () => {
    expect(() => new WebSocket('wss://relay.damus.io')).toThrow(/WebSocket blocked in tests: wss:\/\/relay\.damus\.io/);
  });

  it('refuses an outbound fetch and names it', async () => {
    await expect(fetch('https://example.com/lnurl')).rejects.toThrow(/fetch blocked in tests: https:\/\/example\.com\/lnurl/);
  });

  it('points at the fix rather than only reporting the block', () => {
    expect(() => new WebSocket('wss://nos.lol')).toThrow(/poolFactory/);
    expect(() => new WebSocket('wss://nos.lol')).toThrow(/tests\/setup\.ts/);
  });

  it('leaves loopback alone, so a test can stand up its own server', () => {
    // The NWC mock wallet runs a real ws server on 127.0.0.1 and must keep working.
    // Constructing against a closed port fails asynchronously, not by the guard.
    expect(() => new WebSocket('ws://127.0.0.1:1/nwc')).not.toThrow();
    expect(() => new WebSocket('ws://localhost:1/nwc')).not.toThrow();
  });

  it('keeps sockets recognisable as sockets', () => {
    // Wrapping instead of subclassing broke `instanceof` for every socket in the suite,
    // which timed out the NWC integration tests.
    const socket = new WebSocket('ws://127.0.0.1:1/nwc');
    expect(socket).toBeInstanceOf(WebSocket);
    socket.close();
  });
});
