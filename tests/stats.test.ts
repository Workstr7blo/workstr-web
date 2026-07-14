import { describe, expect, it } from 'vitest';
import { getStats } from '../src/features/progress/stats';
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
