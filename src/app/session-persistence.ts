import type { Session, SessionSet } from '../core/types';
import type { ActiveSession, AppState, SessionExercise } from './state';

export function createSessionPersistence(state: AppState) {
  function fromStored(session: Session, sets: SessionSet[]): ActiveSession {
    const exercises = (session.exercises || []) as SessionExercise[];
    return {
      id: Number(session.id), sheetName: session.sheet_name || 'Workout', startedAt: session.started_at,
      finishedAt: session.finished_at, nostrEventId: session.nostr_event_id, summaryImageUrl: session.summary_image_url,
      exercises, blocks: session.blocks, emomStartedAt: session.emom_started_at,
      emomPositionSec: session.emom_position_sec, emomActiveSec: session.emom_active_sec,
      emomRunningSince: session.emom_running_since || (session.emom_started_at && session.emom_position_sec == null ? session.emom_started_at : undefined),
      sets: sets.map((set) => ({
        exerciseSlug: set.exercise_slug || String(set.exercise_id || ''), exerciseName: set.exercise_name,
        setNumber: Number(set.set_number), reps: set.reps ?? null, weight: set.weight_kg ?? null,
        durationSec: set.duration_sec, blockIndex: set.block_index, roundIndex: set.round_index,
        intervalIndex: set.interval_index, stepIndex: set.step_index, done: true, completedAt: set.completed_at
      }))
    };
  }

  async function loadFinished(): Promise<ActiveSession[]> {
    if (!state.store) return [];
    const sessions = (await state.store.listSessions()).filter((session) => session.finished_at);
    const result: ActiveSession[] = [];
    for (const session of sessions) {
      const sets = session.id ? await state.store.listSessionSets(session.id) : [];
      result.push(fromStored(session, sets));
    }
    return result;
  }

  async function loadUnfinished(): Promise<ActiveSession | null> {
    if (!state.store) return null;
    const session = (await state.store.listSessions()).find((item) => !item.finished_at);
    if (!session?.id) return null;
    return fromStored(session, await state.store.listSessionSets(session.id));
  }

  return { loadFinished, loadUnfinished, fromStored };
}
