import type { IDBPDatabase } from 'idb';
import { openWorkstrDB, type WorkstrDB } from './schema';
import type { Exercise, Session, SessionSet, WorkstrSettings } from '../core/types';
import { normalizeWeightUnit } from '../core/units';

export type ExerciseDraft = Omit<Exercise, 'id' | 'created_at' | 'updated_at' | 'status' | 'source_type' | 'favourite'> &
  Partial<Pick<Exercise, 'id' | 'created_at' | 'updated_at' | 'status' | 'source_type' | 'favourite'>>;

export class WorkstrStore {
  private constructor(private readonly db: IDBPDatabase<WorkstrDB>) {}

  static async open(pubkey: string): Promise<WorkstrStore> {
    return new WorkstrStore(await openWorkstrDB(pubkey));
  }

  async upsertExercise(exercise: ExerciseDraft | Exercise): Promise<number> {
    const now = new Date().toISOString();
    const tx = this.db.transaction('exercises', 'readwrite');
    const index = tx.store.index('slug');
    const existing = await index.get(exercise.slug);
    const { id: requestedId, ...exerciseFields } = exercise;
    const value: Exercise = {
      ...existing,
      ...exerciseFields,
      favourite: exercise.favourite ?? existing?.favourite ?? false,
      source_type: exercise.source_type ?? existing?.source_type ?? 'manual',
      status: exercise.status ?? existing?.status ?? 'active',
      created_at: exercise.created_at ?? existing?.created_at ?? now,
      updated_at: now
    };
    if (existing?.id) value.id = existing.id;
    else if (requestedId) value.id = requestedId;
    const id = value.id ? await tx.store.put(value) : await tx.store.add(value);
    await tx.done;
    return Number(id);
  }

  async getExercise(id: number): Promise<Exercise | undefined> {
    const exercise = await this.db.get('exercises', id);
    return exercise?.status === 'deleted' ? undefined : exercise;
  }

  async listExercises(): Promise<Exercise[]> {
    return (await this.db.getAll('exercises'))
      .filter((exercise) => exercise.status !== 'deleted')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteExercise(id: number): Promise<void> {
    const existing = await this.db.get('exercises', id);
    if (!existing) return;
    await this.db.put('exercises', {
      ...existing,
      status: 'deleted',
      updated_at: new Date().toISOString()
    });
  }

  async seedExercises(exercises: ExerciseDraft[]): Promise<number> {
    const settings = await this.getSettings();
    if (settings.starterExercisesSeeded) return 0;
    for (const exercise of exercises) {
      await this.upsertExercise({
        ...exercise,
        source_type: 'bundle',
        status: 'active',
        favourite: false
      });
    }
    await this.saveSettings({ ...settings, starterExercisesSeeded: true });
    return exercises.length;
  }

  async createSession(session: Omit<Session, 'id'>): Promise<number> {
    return Number(await this.db.add('sessions', session));
  }

  async finishSession(id: number, finishedAt = new Date().toISOString()): Promise<void> {
    const session = await this.db.get('sessions', id);
    if (!session) return;
    await this.db.put('sessions', { ...session, finished_at: finishedAt });
  }

  async deleteSession(id: number): Promise<void> {
    const tx = this.db.transaction(['sessions', 'session_sets'], 'readwrite');
    await tx.objectStore('sessions').delete(id);
    const index = tx.objectStore('session_sets').index('session_id');
    for await (const cursor of index.iterate(id)) await cursor.delete();
    await tx.done;
  }

  async addSessionSet(set: Omit<SessionSet, 'id'>): Promise<number> {
    return Number(await this.db.add('session_sets', set));
  }

  async listSessions(): Promise<Session[]> {
    return (await this.db.getAll('sessions')).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  }

  async listSessionSets(sessionId: number): Promise<SessionSet[]> {
    return (await this.db.getAllFromIndex('session_sets', 'session_id', sessionId)).sort((a, b) => {
      const ex = String(a.exercise_slug || '').localeCompare(String(b.exercise_slug || ''));
      return ex || Number(a.set_number) - Number(b.set_number);
    });
  }

  async getSettings(): Promise<WorkstrSettings> {
    const stored = (await this.db.get('settings', 'settings')) as Partial<WorkstrSettings> | undefined;
    return {
      publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'],
      ...stored,
      unit: normalizeWeightUnit(stored?.unit)
    };
  }

  async saveSettings(settings: WorkstrSettings): Promise<void> {
    await this.db.put('settings', { ...settings, unit: normalizeWeightUnit(settings.unit) }, 'settings');
  }
}
