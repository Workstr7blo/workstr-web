import { dbName, openWorkstrDB } from './schema';

// Namespace of the anonymous local account the app boots into. Sign-in
// adopts it into `workstr-<pubkey>` per plan decision 6 — never merged.
export const LOCAL_NAMESPACE = 'local';

// Stores whose records only exist through user action; the legacy bundled
// seed (removed 2026-07) wrote only exercises + settings.
const USER_DATA_STORES = ['sessions', 'session_sets', 'sheets', 'sheet_exercises', 'bodyweight', 'plan', 'blobs'] as const;

// True when the namespace holds anything a user made (logged sessions,
// programs, body entries, imported exercises, or legacy seed rows they
// favourited). A fresh or seed-only namespace reports false, so sign-in
// right after a clean boot never triggers the adoption prompt.
export async function namespaceHasUserData(namespace: string): Promise<boolean> {
  const db = await openWorkstrDB(namespace);
  try {
    for (const store of USER_DATA_STORES) {
      if (await db.count(store)) return true;
    }
    const exercises = await db.getAll('exercises');
    return exercises.some((exercise) => exercise.favourite || exercise.status === 'deleted' || exercise.source_type !== 'bundle');
  } finally {
    db.close();
  }
}

// Replace the target namespace's contents with a full copy of the source.
// Keys are preserved so autoincrement ids and cross-store references
// (sheet_id, session_id, exercise_id) stay valid.
export async function copyNamespace(from: string, to: string): Promise<void> {
  const src = await openWorkstrDB(from);
  const dst = await openWorkstrDB(to);
  try {
    for (const store of Array.from(src.objectStoreNames)) {
      const keys = await src.getAllKeys(store);
      const values = await src.getAll(store);
      const tx = dst.transaction(store, 'readwrite');
      await tx.store.clear();
      for (let i = 0; i < values.length; i++) {
        // out-of-line stores (plan, settings, blobs) need the key passed explicitly
        if (tx.store.keyPath) await tx.store.put(values[i] as never);
        else await tx.store.put(values[i] as never, keys[i]);
      }
      await tx.done;
    }
  } finally {
    src.close();
    dst.close();
  }
}

export async function deleteNamespace(namespace: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName(namespace));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // a still-open connection defers deletion until it closes; don't hang on it
    request.onblocked = () => resolve();
  });
}
