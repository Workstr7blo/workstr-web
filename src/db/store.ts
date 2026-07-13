import type { IDBPDatabase } from 'idb';
import { openWorkstrDB, type WorkstrDB } from './schema';
import type { Exercise, WorkstrSettings } from '../core/types';
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
