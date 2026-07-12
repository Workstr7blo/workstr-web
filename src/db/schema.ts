import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BodyWeightEntry, Exercise, Session, SessionSet, Sheet, SheetExercise } from '../core/types';

export interface WorkstrDB extends DBSchema {
  exercises: { key: number; value: Exercise; indexes: { slug: string; status: string } };
  sheets: { key: number; value: Sheet; indexes: { slug: string } };
  sheet_exercises: { key: number; value: SheetExercise; indexes: { sheet_id: number } };
  sessions: { key: number; value: Session; indexes: { sheet_id: number; started_at: string } };
  session_sets: { key: number; value: SessionSet; indexes: { session_id: number; exercise_id: number } };
  plan: { key: string; value: unknown };
  bodyweight: { key: number; value: BodyWeightEntry; indexes: { date: string } };
  settings: { key: string; value: unknown };
  sync_queue: { key: string; value: { address: string; updated_at: string } };
  blobs: { key: string; value: Blob };
}

export function dbName(pubkey: string): string {
  return `workstr-${pubkey}`;
}

export async function openWorkstrDB(pubkey: string): Promise<IDBPDatabase<WorkstrDB>> {
  return openDB<WorkstrDB>(dbName(pubkey), 1, {
    upgrade(db) {
      const exercises = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
      exercises.createIndex('slug', 'slug', { unique: true });
      exercises.createIndex('status', 'status');
      const sheets = db.createObjectStore('sheets', { keyPath: 'id', autoIncrement: true });
      sheets.createIndex('slug', 'slug', { unique: true });
      const sheetExercises = db.createObjectStore('sheet_exercises', { keyPath: 'id', autoIncrement: true });
      sheetExercises.createIndex('sheet_id', 'sheet_id');
      const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      sessions.createIndex('sheet_id', 'sheet_id');
      sessions.createIndex('started_at', 'started_at');
      const sets = db.createObjectStore('session_sets', { keyPath: 'id', autoIncrement: true });
      sets.createIndex('session_id', 'session_id');
      sets.createIndex('exercise_id', 'exercise_id');
      db.createObjectStore('plan');
      const bodyweight = db.createObjectStore('bodyweight', { keyPath: 'id', autoIncrement: true });
      bodyweight.createIndex('date', 'date', { unique: true });
      db.createObjectStore('settings');
      db.createObjectStore('sync_queue', { keyPath: 'address' });
      db.createObjectStore('blobs');
    }
  });
}
