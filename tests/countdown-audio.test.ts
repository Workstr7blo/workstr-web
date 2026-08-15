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
      createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: silentStart })
    };
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', class MockWebkitAudioContext {
      constructor() { return context; }
    });
    const audio = await import('../src/features/train/countdown-audio');
    audio.unlockCountdownAudio();
    expect(silentStart).toHaveBeenCalledWith(0);
  });
});
