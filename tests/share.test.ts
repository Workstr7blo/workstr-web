import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../src/app/state';
import { buildWorkoutSummaryEvent, summarizePublishResults, workoutSummaryText } from '../src/nostr/share';

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 7,
    sheetName: 'Push Day',
    startedAt: '2026-07-16T10:00:00.000Z',
    finishedAt: '2026-07-16T11:00:00.000Z',
    exercises: [
      { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', sets: 3, reps: '8', restSec: 90 },
      { exerciseSlug: 'lateral-raise', exerciseName: 'Lateral Raise', sets: 3, reps: '12', restSec: 60 }
    ],
    sets: [
      { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', setNumber: 1, reps: 8, weight: 80, done: true, completedAt: '2026-07-16T10:10:00.000Z' },
      { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', setNumber: 2, reps: 6, weight: 85, done: true, completedAt: '2026-07-16T10:15:00.000Z' },
      { exerciseSlug: 'lateral-raise', setNumber: 1, reps: 12, weight: 10, done: true, completedAt: '2026-07-16T10:30:00.000Z' },
      { exerciseSlug: 'lateral-raise', setNumber: 2, reps: 12, weight: 10, done: false, completedAt: '2026-07-16T10:32:00.000Z' }
    ],
    ...overrides
  };
}

describe('workoutSummaryText', () => {
  it('summarises done sets per exercise with top set and volume', () => {
    const text = workoutSummaryText(session(), 'kg');
    expect(text).toContain('Workout: Push Day');
    expect(text).toContain('- Bench Press: 2 sets, top 85kg x 6');
    expect(text).toContain('- Lateral Raise: 1 set, top 10kg x 12');
    // 8*80 + 6*85 + 12*10 = 1270; the undone set does not count
    expect(text).toContain('Total volume: 1270 kg');
    expect(text).toContain('#workout #fitness');
  });

  it('resolves the exercise name from the session members when sets lack it', () => {
    const text = workoutSummaryText(session(), 'kg');
    expect(text).toContain('Lateral Raise');
    expect(text).not.toContain('lateral-raise:');
  });

  it('converts weights and volume to lbs', () => {
    const text = workoutSummaryText(session(), 'lbs');
    expect(text).toContain('top 187.4lbs x 6');
    expect(text).toContain('Total volume: 2800 lbs');
  });

  it('falls back to Freestyle and handles weightless sets', () => {
    const text = workoutSummaryText(session({
      sheetName: '',
      sets: [{ exerciseSlug: 'plank', exerciseName: 'Plank', setNumber: 1, reps: null, weight: null, done: true, completedAt: '2026-07-16T10:10:00.000Z' }]
    }), 'kg');
    expect(text).toContain('Workout: Freestyle');
    expect(text).toContain('- Plank: 1 set, top - x -');
    expect(text).toContain('Total volume: 0 kg');
  });
});

describe('buildWorkoutSummaryEvent', () => {
  it('builds a kind:1 note with workout tags and client identity', () => {
    const event = buildWorkoutSummaryEvent(session(), 'kg');
    expect(event.kind).toBe(1);
    expect(event.tags).toEqual([['t', 'workout'], ['t', 'fitness'], ['client', 'workstr']]);
    expect(event.content).toBe(workoutSummaryText(session(), 'kg'));
    expect(event.created_at).toBeGreaterThan(1_700_000_000);
  });
});

describe('summarizePublishResults', () => {
  it('treats nostr-tools connection failure strings as failed relay publishes', () => {
    const relays = ['wss://nos.lol', 'wss://relay.example'];
    const results: PromiseSettledResult<string>[] = [
      { status: 'fulfilled', value: 'success' },
      { status: 'fulfilled', value: 'connection failure: Error: WebSocket failed' }
    ];

    expect(summarizePublishResults(relays, results)).toEqual([
      { relay: 'wss://nos.lol', accepted: true, reason: 'success' },
      { relay: 'wss://relay.example', accepted: false, reason: 'connection failure: Error: WebSocket failed' }
    ]);
  });

  it('keeps relay OK rejections as failed publishes with their reason', () => {
    const relays = ['wss://relay.nostr.band'];
    const results: PromiseSettledResult<string>[] = [
      { status: 'rejected', reason: new Error('blocked: invalid signature') }
    ];

    expect(summarizePublishResults(relays, results)).toEqual([
      { relay: 'wss://relay.nostr.band', accepted: false, reason: 'blocked: invalid signature' }
    ]);
  });
});
