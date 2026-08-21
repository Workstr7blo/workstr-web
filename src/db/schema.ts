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
  // The append-only log this device has written or is about to write. `seq` is the chunk
  // an entry landed in, and null until it has actually been published.
  journal: {
    key: number;
    value: { id?: number; kind: 'log' | 'body'; uid: string; updated_at: string; deleted?: boolean; seq: number | null };
    indexes: { kind: string; uid: string };
  };
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
// v5 marks existing sessions as local-only legacy history for the fresh V2 backup era.
// v6 added `journal`, the append-only log of what this device has written to the relay.
// Workout history travels as sealed chunks rather than one record per workout, and the
// journal is what records which entry went into which chunk.
export const DB_VERSION = 6;

export function newSessionUid(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Runs inside the upgrade transaction: old sessions predate V2 relay backup. Give any
// unaddressable row a uid, then mark every existing row local-only so V2 starts fresh.
function backfillSessionMetadata(transaction: IDBPTransaction<WorkstrDB, ArrayLike<StoreNames<WorkstrDB>>, 'versionchange'>): void {
  const sessions = transaction.objectStore('sessions');
  void sessions.openCursor().then(function step(cursor): unknown {
    if (!cursor) return undefined;
    const next = { ...cursor.value };
    if (!next.uid) next.uid = newSessionUid();
    if (!next.backup_version) next.backup_version = 1;
    if (next.uid !== cursor.value.uid || next.backup_version !== cursor.value.backup_version) void cursor.update(next);
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
      if (oldVersion < 4 && oldVersion >= 1) db.createObjectStore('sync_seen', { keyPath: 'address' });
      if (oldVersion < 5 && oldVersion >= 1) backfillSessionMetadata(transaction);
      if (oldVersion < 6 && oldVersion >= 1) createJournalStore(db);
    }
  });
}

function createJournalStore(db: IDBPDatabase<WorkstrDB>): void {
  const journal = db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
  journal.createIndex('kind', 'kind');
  journal.createIndex('uid', 'uid');
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
  createJournalStore(db);
  db.createObjectStore('blobs');
}
