import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../src/app/state';
import { buildWorkoutSummaryEvent, summarizePublishResults, workoutSummaryText } from '../src/nostr/share';
import { DEFAULT_WRITE_RELAYS } from '../src/nostr/pool';

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
    expect(text).toContain('Workstr training summary');
    expect(text).toContain('Program: Push Day');
    expect(text).toContain('- Bench Press: 2 sets, top 85 kg x 6');
    expect(text).toContain('- Lateral Raise: 1 set, top 10 kg x 12');
    // 8*80 + 6*85 + 12*10 = 1270; the undone set does not count
    expect(text).toContain('Volume: 1270 kg');
    expect(text).toContain('#workout #fitness #workstr');
  });

  it('resolves the exercise name from the session members when sets lack it', () => {
    const text = workoutSummaryText(session(), 'kg');
    expect(text).toContain('Lateral Raise');
    expect(text).not.toContain('lateral-raise:');
  });

  it('converts weights and volume to lbs', () => {
    const text = workoutSummaryText(session(), 'lbs');
    expect(text).toContain('top 187.4 lbs x 6');
    expect(text).toContain('Volume: 2800 lbs');
  });

  it('falls back to Freestyle and handles weightless sets', () => {
    const text = workoutSummaryText(session({
      sheetName: '',
      sets: [{ exerciseSlug: 'plank', exerciseName: 'Plank', setNumber: 1, reps: null, weight: null, done: true, completedAt: '2026-07-16T10:10:00.000Z' }]
    }), 'kg');
    expect(text).toContain('Program: Freestyle');
    expect(text).toContain('- Plank: 1 set, top bodyweight x -');
    expect(text).toContain('Volume: 0 kg');
  });
});

describe('buildWorkoutSummaryEvent', () => {
  it('builds a kind:1 note with workout tags and client identity', () => {
    const event = buildWorkoutSummaryEvent(session(), 'kg');
    expect(event.kind).toBe(1);
    expect(event.tags).toEqual([['t', 'workout'], ['t', 'fitness'], ['t', 'workstr'], ['client', 'workstr']]);
    expect(event.content).toBe(workoutSummaryText(session(), 'kg'));
    expect(event.created_at).toBeGreaterThan(1_700_000_000);
  });

  it('attaches an existing program muscle map URL without requiring a new upload', () => {
    const event = buildWorkoutSummaryEvent(session(), 'kg', 'https://nostr.build/i/push-map.svg');
    expect(event.content).toContain('https://nostr.build/i/push-map.svg');
    expect(event.tags).toContainEqual(['imeta', 'url https://nostr.build/i/push-map.svg', 'm image/svg+xml', 'alt Muscle map for Push Day']);
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

describe('DEFAULT_WRITE_RELAYS', () => {
  it('uses the configured write relay list for personal workout notes', () => {
    expect(DEFAULT_WRITE_RELAYS).toEqual([
      'wss://nos.lol',
      'wss://nostr.mom',
      'wss://relay.primal.net',
      'wss://relay.damus.io',
      'wss://relay.snort.social',
      'wss://relay.wellorder.net',
      'wss://bitcoiner.social',
      'wss://relay.powr.build',
      'wss://relay.nos.social',
      'wss://nostr.bitcoiner.social',
      'wss://nostr-pub.wellorder.net'
    ]);
  });
});
