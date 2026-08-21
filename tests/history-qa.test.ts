import { describe, expect, it } from 'vitest';
import { openWorkstrDB } from '../src/db/schema';
import { exportDatabase, importDatabase, EXPORT_SCHEMA } from '../src/db/export';
import { buildHistoryModel, groupSessionsForTimeline } from '../src/features/train/history-model';
import { historyCalendar } from '../src/features/train/history-calendar';
import { workoutHistory } from '../src/features/train/history-timeline';
import { sessionDetail } from '../src/features/train/views';
import { repeatSeed, canRepeat } from '../src/features/train/repeat-workout';
import { getStats } from '../src/features/progress/stats';
import { getRecovery } from '../src/features/recovery/recovery';
import type { ActiveSession, AppState, SessionSetLog } from '../src/app/state';
import type { Session, SessionSet, TrainingBlock } from '../src/core/types';

// v1.3 release regression pass. These are the cross-cutting cases the per-issue suites do
// not own: long histories, the JSON round trip, and the neighbouring features that read the
// same session rows.

const now = new Date(2026, 7, 19, 10, 0, 0);

function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function session(id: number, finished: string, setCount = 3, blocks?: TrainingBlock[]): ActiveSession {
  return {
    id,
    sheetName: `Session ${id}`,
    startedAt: finished,
    finishedAt: finished,
    exercises: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', muscleGroup: 'Chest', sets: setCount, reps: '8', restSec: 60 }],
    blocks,
    sets: Array.from({ length: setCount }, (_item, index): SessionSetLog => ({
      exerciseSlug: 'bench-press', exerciseName: 'Bench Press', setNumber: index + 1,
      reps: 8, weight: 60, done: true, completedAt: finished
    }))
  };
}

function appState(sessions: ActiveSession[], overrides: Partial<AppState> = {}): AppState {
  return {
    finishedSessions: sessions, exercises: [], settings: { unit: 'kg', publicRelays: [] },
    expandedSessionId: null, publishingSessionId: null, publishingStatus: null, pubkey: null,
    history: { monthKey: null, selectedDate: null }, ...overrides
  } as AppState;
}

const parse = (markup: string): Document => new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');

describe('history at scale', () => {
  // Two years of near-daily training: the "long history" case from the issue.
  const long = Array.from({ length: 600 }, (_item, index) => {
    const date = new Date(2026, 7, 19);
    date.setDate(date.getDate() - index);
    return session(index + 1, new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18).toISOString(), 4);
  });

  it('builds a model over two years of history without losing a day', () => {
    const model = buildHistoryModel(long, { now });
    expect(model.days.size).toBe(600);
    expect(model.summary.daysSinceLatest).toBe(0);
    expect(model.summary.workoutsInMonth).toBe(19); // Aug 1-19
    // 600 consecutive days is 85 whole weeks plus a part week either end.
    expect(model.summary.activeWeekStreak).toBeGreaterThanOrEqual(85);
  });

  it('renders one month of cells no matter how long the history is', () => {
    const doc = parse(historyCalendar(buildHistoryModel(long, { now, locale: 'en-US' }), null, true));
    expect(doc.querySelectorAll('[data-history-date]')).toHaveLength(31);
  });

  it('renders one day of cards when a day is selected, not six hundred', () => {
    const doc = parse(workoutHistory(appState(long, { history: { monthKey: null, selectedDate: '2026-08-18' } }), now));
    expect(doc.querySelectorAll('.workout-card')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-toggle-session]')).toHaveLength(1);
  });

  it('handles a sparse history spread over years', () => {
    const sparse = [session(1, at(2024, 2, 29)), session(2, at(2025, 12, 31)), session(3, at(2026, 8, 19))];
    const model = buildHistoryModel(sparse, { now });
    expect(model.days.size).toBe(3);
    expect(model.summary.activeWeekStreak).toBe(1);
    expect(groupSessionsForTimeline(sparse).map((group) => group.key)).toEqual(['2026-08-19', '2025-12-31', '2024-02-29']);
  });

  it('keeps a leap day on the leap day', () => {
    const model = buildHistoryModel([session(1, at(2028, 2, 29))], { now: new Date(2028, 1, 29, 12), monthKey: '2028-02' });
    expect(model.days.has('2028-02-29')).toBe(true);
    expect(parse(historyCalendar(model, '2028-02-29', true)).querySelector('[data-history-date="2028-02-29"]')?.className)
      .toContain('done');
  });
});

describe('JSON round trip', () => {
  // The stored row shape History reads, mapped the way session-persistence maps it.
  function toActive(row: Session, rows: SessionSet[]): ActiveSession {
    return {
      id: Number(row.id), sheetName: row.sheet_name || 'Workout', startedAt: row.started_at,
      finishedAt: row.finished_at, blocks: row.blocks, exercises: (row.exercises || []) as ActiveSession['exercises'],
      sets: rows.map((set) => ({
        exerciseSlug: set.exercise_slug || '', exerciseName: set.exercise_name, setNumber: Number(set.set_number),
        reps: set.reps ?? null, weight: set.weight_kg ?? null, done: true, completedAt: set.completed_at
      }))
    };
  }

  async function readHistory(namespace: string): Promise<ActiveSession[]> {
    const db = await openWorkstrDB(namespace);
    const sessions = await db.getAll('sessions');
    const sets = await db.getAll('session_sets');
    db.close();
    return sessions
      .filter((row) => row.finished_at)
      .map((row) => toActive(row, sets.filter((set) => set.session_id === row.id)));
  }

  it('preserves the whole history experience across export and import, with no schema change', async () => {
    const namespace = 'history-round-trip';
    const emom: TrainingBlock[] = [{ type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press', targetDurationSec: 30 }] }] }];
    const seeded = [session(1, at(2026, 8, 19, 23), 4), session(2, at(2026, 8, 17, 7), 5), session(3, at(2026, 8, 17, 19), 6, emom)];

    const db = await openWorkstrDB(namespace);
    for (const item of seeded) {
      await db.put('sessions', {
        id: item.id, sheet_name: item.sheetName, started_at: item.startedAt,
        finished_at: item.finishedAt, exercises: item.exercises, blocks: item.blocks
      } as never);
      for (const set of item.sets) {
        await db.put('session_sets', {
          id: item.id * 100 + set.setNumber, session_id: item.id, exercise_slug: set.exerciseSlug,
          exercise_name: set.exerciseName, set_number: set.setNumber, reps: set.reps,
          weight_kg: set.weight, completed_at: set.completedAt
        } as never);
      }
    }
    const before = buildHistoryModel(await readHistory(namespace), { now });
    const dump = await exportDatabase(db, namespace);
    db.close();
    expect(dump.schema).toBe(EXPORT_SCHEMA); // v1.3 adds no schema version

    // Wipe, then restore from the export.
    const wipe = await openWorkstrDB(namespace);
    const tx = wipe.transaction(['sessions', 'session_sets'], 'readwrite');
    await tx.objectStore('sessions').clear();
    await tx.objectStore('session_sets').clear();
    await tx.done;
    expect(await readHistory(namespace)).toHaveLength(0);
    await importDatabase(wipe, dump);
    wipe.close();

    const restored = await readHistory(namespace);
    const after = buildHistoryModel(restored, { now });
    expect(after.summary).toEqual(before.summary);
    expect([...after.days.keys()].sort()).toEqual([...before.days.keys()].sort());
    expect(after.days.get('2026-08-17')).toEqual(before.days.get('2026-08-17'));
    // The late-night session is still on its own day after the round trip.
    expect(after.days.has('2026-08-19')).toBe(true);

    // Detail and repeat still work on the restored rows.
    const restoredEmom = restored.find((item) => item.id === 3)!;
    expect(canRepeat(restoredEmom)).toBe(true);
    expect(repeatSeed(restoredEmom).blocks?.[0].type).toBe('emom');
    expect(parse(sessionDetail(restoredEmom, 'kg')).querySelectorAll('.set-pill')).toHaveLength(6);
  });
});

describe('neighbouring features read the same rows', () => {
  const sessions = [session(1, at(2026, 8, 19), 3), session(2, at(2026, 8, 18), 3)];

  it('keeps statistics and history agreeing about which days were trained', () => {
    const stats = getStats(sessions, [], now);
    const model = buildHistoryModel(sessions, { now });
    expect(stats.totalSessions).toBe(2);
    // Both now answer "which day?" through core/dates, so the streak matches the calendar.
    expect(stats.streak).toBe(2);
    expect(model.days.size).toBe(2);
  });

  it('drops a deleted session out of history, statistics and recovery together', () => {
    const remaining = sessions.filter((item) => item.id !== 1);
    const model = buildHistoryModel(remaining, { now });
    expect(model.days.size).toBe(1);
    expect(model.summary.workoutsInMonth).toBe(1);
    expect(getStats(remaining, []).totalSessions).toBe(1);
    // Recovery reads the same finished sessions, so clearing history returns it to rested.
    expect(getRecovery(remaining, []).muscleGroups.length).toBeGreaterThan(0);
    const rested = getRecovery([], []);
    expect(rested.readyCount).toBe(rested.totalCount);
    expect(rested.overallReadiness).toBe(100);
  });

  it('shows superset badges and EMOM sets in the history detail', () => {
    const superset = session(4, at(2026, 8, 19), 2, [{
      type: 'straight', rounds: 2, steps: [
        { exerciseSlug: 'bench-press', exerciseName: 'Bench Press' },
        { exerciseSlug: 'barbell-row', exerciseName: 'Barbell Row' }
      ]
    }]);
    const doc = parse(sessionDetail(superset, 'kg'));
    expect(doc.querySelector('.session-superset-badge')?.textContent).toBe('Superset 1');
    expect(doc.querySelectorAll('.set-pill')).toHaveLength(2);
  });

  it('offers publish and repeat side by side, with delete kept out of that row', () => {
    const doc = parse(sessionDetail(session(5, at(2026, 8, 19)), 'kg', true));
    const actions = doc.querySelector('.workout-card-actions')!;
    expect(actions.querySelector('[data-repeat-session]')).not.toBeNull();
    expect(actions.querySelector('[data-publish-session]')).not.toBeNull();
    expect(actions.querySelector('[data-delete-session]')).toBeNull();
  });

  it('still reports a published session as published', () => {
    const published = { ...session(6, at(2026, 8, 19)), nostrEventId: 'event-id' };
    const doc = parse(sessionDetail(published, 'kg', true));
    expect(doc.querySelector('.workout-card-actions .button.ghost')?.textContent).toBe('Published');
    expect(doc.querySelector('[data-publish-session]')).toBeNull();
    // A published workout can still be repeated.
    expect(doc.querySelector('[data-repeat-session]')).not.toBeNull();
  });
});

describe('signed-out and empty states', () => {
  it('works with no identity: history renders, repeat is offered, publish is not', () => {
    const doc = parse(workoutHistory(appState([session(1, at(2026, 8, 19))], { expandedSessionId: 1, pubkey: null }), now));
    expect(doc.querySelector('[data-repeat-session="1"]')).not.toBeNull();
    const publish = doc.querySelector('.workout-card-actions .button.primary[disabled]');
    expect(publish?.textContent).toBe('Publish summary');
    expect(publish?.getAttribute('title')).toContain('Sign in');
  });

  it('renders the current month and an honest empty state with no history at all', () => {
    const doc = parse(historyCalendar(buildHistoryModel([], { now, locale: 'en-US' }), null, false));
    expect(doc.querySelector('.history-cal-title')?.textContent).toBe('August 2026');
    expect(doc.querySelectorAll('[data-history-date]')).toHaveLength(31);
    expect(doc.querySelector('.history-cal-empty')).not.toBeNull();
    expect(parse(workoutHistory(appState([]), now)).querySelector('.list.empty')).not.toBeNull();
  });
});
