import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { BodyWeightEntry, Exercise, Session, SessionSet, Sheet, SheetExercise } from '../core/types';

export interface WorkstrDB extends DBSchema {
  exercises: { key: number; value: Exercise; indexes: { slug: string; status: string } };
  sheets: { key: number; value: Sheet; indexes: { slug: string } };
  sheet_exercises: { key: number; value: SheetExercise; indexes: { sheet_id: number } };
  sessions: { key: number; value: Session; indexes: { sheet_id: number; started_at: string } };
  session_sets: { key: number; value: SessionSet; indexes: { session_id: number; exercise_id: number } };
  bodyweight: { key: number; value: BodyWeightEntry; indexes: { date: string } };
  settings: { key: string; value: unknown };
  sync_queue: { key: string; value: { address: string; updated_at: string } };
  sync_seen: { key: string; value: { address: string; event_id: string; created_at: number } };
  blobs: { key: string; value: Blob };
}

export function dbName(pubkey: string): string {
  return `workstr-${pubkey}`;
}

// v2 retired the `plan` object store. It was created by v1, never read and never written
// to, so dropping it cannot lose user data.
// v3 gave every session a `uid`, so it can be addressed on a relay independently of its
// autoincrement key.
// v4 added `sync_seen`, the ledger of relay events this device has already read. Without
// it every app start re-decrypted the whole backup, which is one signer round trip per
// record on a device that already had all of them.
export const DB_VERSION = 4;

export function newSessionUid(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Runs inside the upgrade transaction: existing sessions predate `uid` and would
// otherwise be unaddressable, so they are given one before any sync can see them.
function backfillSessionUids(transaction: IDBPTransaction<WorkstrDB, ArrayLike<StoreNames<WorkstrDB>>, 'versionchange'>): void {
  const sessions = transaction.objectStore('sessions');
  void sessions.openCursor().then(function step(cursor): unknown {
    if (!cursor) return undefined;
    if (!cursor.value.uid) void cursor.update({ ...cursor.value, uid: newSessionUid() });
    return cursor.continue().then(step);
  });
}

export async function openWorkstrDB(pubkey: string): Promise<IDBPDatabase<WorkstrDB>> {
  return openDB<WorkstrDB>(dbName(pubkey), DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) createInitialStores(db);
      // idb types the store list against the current schema, and `plan` deliberately left it.
      const legacy = db as unknown as IDBPDatabase;
      if (legacy.objectStoreNames.contains('plan')) legacy.deleteObjectStore('plan');
      if (oldVersion < 3 && oldVersion >= 1) backfillSessionUids(transaction);
      if (oldVersion < 4 && oldVersion >= 1) db.createObjectStore('sync_seen', { keyPath: 'address' });
    }
  });
}

function createInitialStores(db: IDBPDatabase<WorkstrDB>): void {
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
  const bodyweight = db.createObjectStore('bodyweight', { keyPath: 'id', autoIncrement: true });
  bodyweight.createIndex('date', 'date', { unique: true });
  db.createObjectStore('settings');
  db.createObjectStore('sync_queue', { keyPath: 'address' });
  db.createObjectStore('sync_seen', { keyPath: 'address' });
  db.createObjectStore('blobs');
}
