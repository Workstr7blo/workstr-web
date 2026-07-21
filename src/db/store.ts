import type { IDBPDatabase } from 'idb';
import { openWorkstrDB, type WorkstrDB } from './schema';
import { exportDatabase, importDatabase, type WorkstrExport } from './export';
import type { BodyWeightEntry, Exercise, Session, SessionSet, Sheet, SheetExercise, WorkstrSettings } from '../core/types';
import { normalizeWeightUnit } from '../core/units';
import { slugify } from '../core/ids';

export type ExerciseDraft = Omit<Exercise, 'id' | 'created_at' | 'updated_at' | 'status' | 'source_type' | 'favourite'> &
  Partial<Pick<Exercise, 'id' | 'created_at' | 'updated_at' | 'status' | 'source_type' | 'favourite'>>;

export interface SheetWithExercises extends Sheet { exercises: SheetExercise[] }

export interface SheetDraft {
  name: string;
  notes?: string;
  is_temporary?: boolean;
  nostr_pubkey?: string;
  nostr_address?: string;
  nostr_event_id?: string;
  nostr_published_at?: string;
  origin_created_at?: number;
  exercises: Omit<SheetExercise, 'id' | 'sheet_id'>[];
}

export class WorkstrStore {
  private constructor(private readonly db: IDBPDatabase<WorkstrDB>) {}

  static async open(pubkey: string): Promise<WorkstrStore> {
    return new WorkstrStore(await openWorkstrDB(pubkey));
  }

  close(): void {
    this.db.close();
  }

  async exportData(pubkeyNamespace: string): Promise<WorkstrExport> {
    return exportDatabase(this.db, pubkeyNamespace);
  }

  async importData(data: WorkstrExport): Promise<void> {
    return importDatabase(this.db, data);
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

  // One-time cleanup for installs created while the app still shipped a
  // bundled starter library: drop untouched seed rows, keep favourited ones.
  async removeStarterExercises(): Promise<void> {
    const tx = this.db.transaction('exercises', 'readwrite');
    for await (const cursor of tx.store.iterate()) {
      if (cursor.value.source_type === 'bundle' && !cursor.value.favourite) await cursor.delete();
    }
    await tx.done;
  }

  async listSheets(): Promise<SheetWithExercises[]> {
    const sheets = (await this.db.getAll('sheets'))
      .filter((sheet) => !sheet.is_temporary)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const result: SheetWithExercises[] = [];
    for (const sheet of sheets) {
      const exercises = (await this.db.getAllFromIndex('sheet_exercises', 'sheet_id', sheet.id!))
        .sort((a, b) => Number(a.position) - Number(b.position));
      result.push({ ...sheet, exercises });
    }
    return result;
  }

  // Create or replace a sheet and its exercise rows. The slug is minted once
  // on create and stays stable across edits, like self-hosted Workstr.
  async saveSheet(draft: SheetDraft, id?: number): Promise<number> {
    const now = new Date().toISOString();
    const tx = this.db.transaction(['sheets', 'sheet_exercises'], 'readwrite');
    const sheets = tx.objectStore('sheets');
    const existing = id ? await sheets.get(id) : undefined;
    let slug = existing?.slug;
    if (!slug) {
      const base = slugify(draft.name) || 'program';
      let candidate = base;
      let suffix = 2;
      while (await sheets.index('slug').get(candidate)) candidate = `${base}-${suffix++}`;
      slug = candidate;
    }
    const value: Sheet = {
      ...existing,
      slug,
      name: draft.name,
      notes: draft.notes || '',
      is_temporary: draft.is_temporary ?? existing?.is_temporary ?? false,
      // Import = snapshot: the nostr identity comes only from the draft, so a
      // builder save (which carries none) forks an imported sheet and canon
      // updates never clobber local edits.
      nostr_pubkey: draft.nostr_pubkey,
      nostr_address: draft.nostr_address,
      nostr_event_id: draft.nostr_event_id,
      nostr_published_at: draft.nostr_published_at,
      origin_created_at: draft.origin_created_at,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    if (existing?.id) value.id = existing.id;
    const sheetId = Number(value.id ? await sheets.put(value) : await sheets.add(value));
    const rows = tx.objectStore('sheet_exercises');
    for await (const cursor of rows.index('sheet_id').iterate(sheetId)) await cursor.delete();
    for (const [index, row] of draft.exercises.entries()) {
      await rows.add({ ...row, sheet_id: sheetId, position: row.position ?? index });
    }
    await tx.done;
    return sheetId;
  }

  async deleteSheet(id: number): Promise<void> {
    const tx = this.db.transaction(['sheets', 'sheet_exercises'], 'readwrite');
    await tx.objectStore('sheets').delete(id);
    for await (const cursor of tx.objectStore('sheet_exercises').index('sheet_id').iterate(id)) await cursor.delete();
    await tx.done;
  }

  async createSession(session: Omit<Session, 'id'>): Promise<number> {
    return Number(await this.db.add('sessions', session));
  }

  async finishSession(id: number, finishedAt = new Date().toISOString()): Promise<void> {
    const session = await this.db.get('sessions', id);
    if (!session) return;
    await this.db.put('sessions', { ...session, finished_at: finishedAt });
  }

  async markSessionPublished(id: number, eventId: string): Promise<void> {
    const session = await this.db.get('sessions', id);
    if (!session) return;
    await this.db.put('sessions', { ...session, nostr_event_id: eventId });
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

  async listBody(limit = 120): Promise<BodyWeightEntry[]> {
    return (await this.db.getAll('bodyweight'))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit);
  }

  // Upsert by date, mirroring self-hosted body_log's UNIQUE(date) ON CONFLICT UPDATE.
  async logBody(entry: { date?: string; weight_kg: number; notes?: string }): Promise<void> {
    if (!Number.isFinite(entry.weight_kg)) throw new Error('weight_kg must be a number');
    const date = String(entry.date || new Date().toISOString().slice(0, 10));
    const tx = this.db.transaction('bodyweight', 'readwrite');
    const existing = await tx.store.index('date').get(date);
    await tx.store.put({ ...existing, date, weight_kg: entry.weight_kg, notes: entry.notes || '' });
    await tx.done;
  }

  async deleteBody(id: number): Promise<void> {
    await this.db.delete('bodyweight', id);
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
