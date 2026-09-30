import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountdownCueGuard } from '../src/features/train/countdown-audio';

describe('CountdownCueGuard', () => {
  it('plays each countdown second and final cue only once per period', () => {
    const guard = new CountdownCueGuard();
    expect(guard.countdown('rest', 1, 6)).toBeNull();
    expect(guard.countdown('rest', 1, 5)).toBe('short');
    expect(guard.countdown('rest', 1, 5)).toBeNull();
    expect(guard.countdown('rest', 1, 4)).toBe('short');
    expect(guard.finish('rest', 1)).toBe('final');
    expect(guard.finish('rest', 1)).toBeNull();
  });

  it('allows the same countdown values in a new timer period', () => {
    const guard = new CountdownCueGuard();
    expect(guard.countdown('emom', 0, 5)).toBe('short');
    expect(guard.finish('emom', 0)).toBe('final');
    expect(guard.countdown('emom', 1, 5)).toBe('short');
    expect(guard.finish('emom', 1)).toBe('final');
  });

  it('can be reset for a new session', () => {
    const guard = new CountdownCueGuard();
    expect(guard.countdown('rest', 1, 1)).toBe('short');
    guard.reset();
    expect(guard.countdown('rest', 1, 1)).toBe('short');
  });
});

describe('countdown audio playback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resumes a suspended context and preserves the emphasized final cue', async () => {
    let releaseResume: (() => void) | undefined;
    const resume = new Promise<void>((resolve) => { releaseResume = resolve; });
    const frequencies: number[] = [];
    const stopTimes: number[] = [];
    const silentStarts: number[] = [];
    const context = {
      state: 'suspended', currentTime: 10, sampleRate: 48_000, destination: {},
      resume: vi.fn(() => resume.then(() => { context.state = 'running'; })),
      createBuffer: vi.fn(() => ({})),
      createBufferSource: () => ({
        buffer: null,
        connect: vi.fn(),
        start: (time: number) => silentStarts.push(time)
      }),
      createOscillator: () => ({
        type: 'sine',
        frequency: { setValueAtTime: (value: number) => frequencies.push(value) },
        connect: vi.fn(), start: vi.fn(), stop: (time: number) => stopTimes.push(time)
      }),
      createGain: () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn()
      })
    };
    vi.stubGlobal('AudioContext', class MockAudioContext {
      constructor() { return context; }
    });
    const audio = await import('../src/features/train/countdown-audio');
    audio.unlockCountdownAudio();
    expect(silentStarts).toEqual([0]);
    audio.playCountdownCue('short');
    audio.playCountdownCue('final');
    releaseResume?.();
    await resume;
    await vi.waitFor(() => expect(frequencies).toEqual([1175]));
    expect(stopTimes).toEqual([10.65]);
  });

  it('uses the prefixed AudioContext constructor when WebKit requires it', async () => {
    const silentStart = vi.fn();
    const context = {
      state: 'running', currentTime: 0, sampleRate: 44_100, destination: {},
      resume: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      createBufferSource: () => ({ buffer: null, loop: false, connect: vi.fn(), start: silentStart }),
      createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() })
    };
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', class MockWebkitAudioContext {
      constructor() { return context; }
    });
    const audio = await import('../src/features/train/countdown-audio');
    audio.unlockCountdownAudio();
    expect(silentStart).toHaveBeenCalledWith(0);
  });

  function mockContext(state: string, resume: () => Promise<void>, frequencies: number[]) {
    return {
      state, currentTime: 5, sampleRate: 48_000, destination: {},
      resume: vi.fn(resume),
      createBuffer: vi.fn(() => ({})),
      createBufferSource: () => ({ buffer: null, loop: false, connect: vi.fn(), start: vi.fn() }),
      createOscillator: () => ({
        type: 'sine',
        frequency: { setValueAtTime: (value: number) => frequencies.push(value) },
        connect: vi.fn(), start: vi.fn(), stop: vi.fn()
      }),
      createGain: () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn()
      }),
      addEventListener: vi.fn()
    };
  }

  it('retries a resume that never settles instead of muting the rest of the session', async () => {
    const frequencies: number[] = [];
    const context = mockContext('suspended', () => new Promise<void>(() => {}), frequencies);
    vi.stubGlobal('AudioContext', class MockAudioContext { constructor() { return context; } });
    vi.useFakeTimers();
    try {
      const audio = await import('../src/features/train/countdown-audio');
      audio.unlockCountdownAudio();
      expect(context.resume).toHaveBeenCalledTimes(1);
      // A cue arriving while the first attempt is in flight must not queue a second.
      audio.playCountdownCue('short');
      expect(context.resume).toHaveBeenCalledTimes(1);
      // Once the hung attempt times out, later cues get a fresh attempt.
      vi.advanceTimersByTime(2_000);
      audio.playCountdownCue('short');
      expect(context.resume).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays the final cue when the context recovers from an interruption', async () => {
    const frequencies: number[] = [];
    const listeners: Array<() => void> = [];
    const context = mockContext('running', () => new Promise<void>(() => {}), frequencies);
    context.addEventListener = vi.fn((name: string, listener: () => void) => {
      if (name === 'statechange') listeners.push(listener);
    }) as never;
    vi.stubGlobal('AudioContext', class MockAudioContext { constructor() { return context; } });
    const audio = await import('../src/features/train/countdown-audio');
    audio.unlockCountdownAudio();
    expect(audio.countdownAudioState()).toBe('running');

    // WebKit interrupts the context mid-session; the round cue is dropped.
    context.state = 'interrupted';
    listeners.forEach((listener) => listener());
    audio.playCountdownCue('final');
    expect(frequencies).toEqual([]);
    expect(audio.countdownAudioState()).toBe('interrupted');

    // Recovery replays the cue rather than staying silent for every later round.
    context.state = 'running';
    listeners.forEach((listener) => listener());
    expect(frequencies).toEqual([1175]);
  });

  it('lets a tap resume even while an earlier resume attempt is still hanging', async () => {
    const context = mockContext('suspended', () => new Promise<void>(() => {}), []);
    vi.stubGlobal('AudioContext', class MockAudioContext { constructor() { return context; } });
    const audio = await import('../src/features/train/countdown-audio');
    audio.resumeCountdownAudio();
    audio.unlockCountdownAudio();
    expect(context.resume).toHaveBeenCalledTimes(1);
    audio.playCountdownCue('short');
    expect(context.resume).toHaveBeenCalledTimes(1);
    audio.unlockCountdownAudio();
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it('never creates a context outside a gesture', async () => {
    const created = vi.fn();
    vi.stubGlobal('AudioContext', class MockAudioContext { constructor() { created(); } });
    const audio = await import('../src/features/train/countdown-audio');
    audio.resumeCountdownAudio();
    expect(created).not.toHaveBeenCalled();
    expect(audio.countdownAudioState()).toBe('not started');
  });

  it('starts a fresh context on the first tap after the page was hidden', async () => {
    const first = { ...mockContext('running', () => Promise.resolve(), []), close: vi.fn(() => Promise.resolve()) };
    const second = { ...mockContext('running', () => Promise.resolve(), []), close: vi.fn(() => Promise.resolve()) };
    const contexts = [first, second];
    vi.stubGlobal('AudioContext', class MockAudioContext { constructor() { return contexts.shift() as object; } });
    let visibility = 'visible';
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
    vi.stubGlobal('document', doc);
    const audio = await import('../src/features/train/countdown-audio');
    audio.unlockCountdownAudio();
    audio.unlockCountdownAudio();
    expect(first.close).not.toHaveBeenCalled();

    visibility = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    audio.resumeCountdownAudio();
    expect(first.close).not.toHaveBeenCalled();

    audio.unlockCountdownAudio();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(contexts).toEqual([]);
  });
});
