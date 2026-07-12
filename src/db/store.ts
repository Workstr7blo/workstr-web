import type { IDBPDatabase } from 'idb';
import { openWorkstrDB, type WorkstrDB } from './schema';
import type { Exercise, WorkstrSettings } from '../core/types';

export class WorkstrStore {
  private constructor(private readonly db: IDBPDatabase<WorkstrDB>) {}

  static async open(pubkey: string): Promise<WorkstrStore> {
    return new WorkstrStore(await openWorkstrDB(pubkey));
  }

  async upsertExercise(exercise: Exercise): Promise<number> {
    const tx = this.db.transaction('exercises', 'readwrite');
    const index = tx.store.index('slug');
    const existing = await index.get(exercise.slug);
    const value = { ...existing, ...exercise };
    const id = existing?.id ? await tx.store.put(value) : await tx.store.add(value);
    await tx.done;
    return Number(id);
  }

  async listExercises(): Promise<Exercise[]> {
    return (await this.db.getAll('exercises')).filter((exercise) => exercise.status !== 'deleted');
  }

  async getSettings(): Promise<WorkstrSettings> {
    const stored = await this.db.get('settings', 'settings');
    return {
      unit: 'kg',
      publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'],
      ...(stored as Partial<WorkstrSettings> | undefined)
    };
  }

  async saveSettings(settings: WorkstrSettings): Promise<void> {
    await this.db.put('settings', settings, 'settings');
  }
}
