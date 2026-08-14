import { describe, expect, it } from 'vitest';
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
