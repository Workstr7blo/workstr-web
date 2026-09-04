import { describe, expect, it } from 'vitest';
import { getStats, normalizeStatsRange, sessionsInRange, statsRangeStart } from '../src/features/progress/stats';
import { WorkstrStore } from '../src/db/store';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

function makeSession(startedAt: string, slug: string, muscleGroup: string, weight: number, reps: number, setCount = 3) {
  return {
    id: 1,
    sheetName: 'Test',
    startedAt,
    finishedAt: startedAt,
    exercises: [{ exerciseSlug: slug, exerciseName: slug, muscleGroup, sets: setCount, reps: String(reps), restSec: 90 }],
    sets: Array.from({ length: setCount }, (_item, index) => ({
      exerciseSlug: slug, setNumber: index + 1, reps, weight, done: true, completedAt: startedAt
    }))
  };
}

describe('getStats', () => {
  it('matches the self-hosted totals, PR and streak math', () => {
    const sessions = [
      makeSession(daysAgo(0), 'bench-press', 'Chest', 50, 10),
      makeSession(daysAgo(1), 'squat', 'Quadriceps', 100, 5)
    ];
    const stats = getStats(sessions, []);
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalSets).toBe(6);
    expect(stats.totalVolume).toBe(3 * 10 * 50 + 3 * 5 * 100); // 3000
    expect(stats.streak).toBe(2); // today + yesterday
    // Epley: 50 * (1 + 10/30) = 66.7 ; 100 * (1 + 5/30) = 116.7
    expect(stats.prs[0]).toMatchObject({ slug: 'squat', e1rm: 116.7, topWeight: 100 });
    expect(stats.prs[1]).toMatchObject({ slug: 'bench-press', e1rm: 66.7, topWeight: 50 });
    expect(stats.muscle).toContainEqual({ muscle: 'Chest', sets: 3 });
    expect(stats.muscle).toContainEqual({ muscle: 'Quadriceps', sets: 3 });
    expect(stats.weekly.length).toBeGreaterThanOrEqual(1);
    expect(stats.weekly.reduce((total, week) => total + week.volume, 0)).toBe(3000);
  });

  it('breaks the streak after a missed day', () => {
    const stats = getStats([makeSession(daysAgo(0), 'a', 'Chest', 50, 10), makeSession(daysAgo(2), 'a', 'Chest', 50, 10)], []);
    expect(stats.streak).toBe(1);
  });

  it('returns zero streak when the last session is older than yesterday', () => {
    const stats = getStats([makeSession(daysAgo(3), 'a', 'Chest', 50, 10)], []);
    expect(stats.streak).toBe(0);
  });
});

describe('WorkstrStore body log', () => {
  it('logs, upserts by date, lists newest-first and deletes', async () => {
    const store = await WorkstrStore.open('body-test-pubkey');
    await store.logBody({ date: '2026-07-10', weight_kg: 80 });
    await store.logBody({ date: '2026-07-12', weight_kg: 79.5 });
    await store.logBody({ date: '2026-07-10', weight_kg: 80.4 }); // same date -> update, not duplicate
    let entries = await store.listBody();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ date: '2026-07-12', weight_kg: 79.5 });
    expect(entries[1]).toMatchObject({ date: '2026-07-10', weight_kg: 80.4 });
    await store.deleteBody(entries[0].id!);
    entries = await store.listBody();
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2026-07-10');
  });

  it('persists height and target weight in settings', async () => {
    const store = await WorkstrStore.open('profile-test-pubkey');
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, heightCm: 175, targetWeightKg: 75 });
    const saved = await store.getSettings();
    expect(saved.heightCm).toBe(175);
    expect(saved.targetWeightKg).toBe(75);
  });
});

describe('statistics date range', () => {
  // One session today, one seven weeks back, one eight months back.
  const sessions = [
    makeSession(daysAgo(0), 'bench-press', 'Chest', 50, 10),
    makeSession(daysAgo(49), 'squat', 'Quadriceps', 100, 5),
    makeSession(daysAgo(240), 'deadlift', 'Back', 140, 3)
  ];

  it('defaults to all time, so nothing changes until a range is picked', () => {
    expect(getStats(sessions, []).range).toBe('all');
    expect(getStats(sessions, []).totalSessions).toBe(3);
  });

  it('falls back to all time for a value it does not recognise', () => {
    expect(normalizeStatsRange('7d')).toBe('all');
    expect(normalizeStatsRange(undefined)).toBe('all');
    expect(normalizeStatsRange('3m')).toBe('3m');
  });

  it('counts the range in whole days, not milliseconds', () => {
    const now = new Date('2026-09-04T14:30:00.000Z');
    expect(statsRangeStart('4w', now)).toBe('2026-08-08');
    expect(statsRangeStart('all', now)).toBeNull();
  });

  it('scopes sessions, sets and volume to the window', () => {
    const month = getStats(sessions, [], new Date(), '4w');
    expect(month.totalSessions).toBe(1);
    expect(month.totalSets).toBe(3);
    expect(month.totalVolume).toBe(3 * 10 * 50);

    const quarter = getStats(sessions, [], new Date(), '3m');
    expect(quarter.totalSessions).toBe(2);
  });

  it('scopes muscle distribution too', () => {
    expect(getStats(sessions, [], new Date(), '4w').muscle.map((entry) => entry.muscle)).toEqual(['Chest']);
    expect(getStats(sessions, [], new Date(), 'all').muscle).toHaveLength(3);
  });

  it('keeps personal records all-time, because a record is a record', () => {
    // The heaviest lift is eight months old. Scoping it away would report a lower number
    // under a heading that still says "personal record".
    const month = getStats(sessions, [], new Date(), '4w');
    expect(month.prs.some((record) => record.slug === 'deadlift')).toBe(true);
    expect(month.prs).toHaveLength(getStats(sessions, [], new Date(), 'all').prs.length);
  });

  it('keeps the streak all-time, because it describes right now', () => {
    const recent = [makeSession(daysAgo(0), 'a', 'Chest', 50, 10), makeSession(daysAgo(1), 'a', 'Chest', 50, 10)];
    expect(getStats(recent, [], new Date(), '4w').streak).toBe(2);
    expect(getStats(recent, [], new Date(), 'all').streak).toBe(2);
  });

  it('buckets by week for short ranges and by month beyond them', () => {
    expect(getStats(sessions, [], new Date(), '4w').bucket).toBe('week');
    expect(getStats(sessions, [], new Date(), '3m').bucket).toBe('week');
    expect(getStats(sessions, [], new Date(), '1y').bucket).toBe('month');
    expect(getStats(sessions, [], new Date(), 'all').bucket).toBe('month');
  });

  it('keeps a year readable instead of drawing 52 bars', () => {
    const weekly = Array.from({ length: 40 }, (_item, index) => makeSession(daysAgo(index * 7), 'a', 'Chest', 50, 10));
    const year = getStats(weekly, [], new Date(), '1y');
    expect(year.bucket).toBe('month');
    expect(year.weekly.length).toBeLessThanOrEqual(12);
  });

  it('filters on the same day a session belongs to everywhere else', () => {
    // sessionDayKey is how History, the calendar and the streak answer "which day was
    // that?", so a late-evening session lands in the range that shows it in History.
    const late = makeSession(daysAgo(0), 'a', 'Chest', 50, 10);
    expect(sessionsInRange([late], '4w')).toHaveLength(1);
    expect(sessionsInRange([makeSession(daysAgo(200), 'a', 'Chest', 50, 10)], '4w')).toHaveLength(0);
  });
});
