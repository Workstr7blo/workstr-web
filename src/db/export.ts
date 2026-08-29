import type { IDBPDatabase } from 'idb';
import type { WorkstrDB } from './schema';

export const EXPORT_SCHEMA = 1;

// Stores whose key is embedded in the value (in-line keyPath) — export the rows
// as-is. `blobs` is deliberately excluded (cached image binaries, re-fetchable).
const KEYED_STORES = ['exercises', 'sheets', 'sheet_exercises', 'sessions', 'session_sets', 'bodyweight', 'sync_queue'] as const;
// Out-of-line key stores — export { key, value } pairs so the keys survive.
const KV_STORES = ['settings'] as const;

type KeyedStore = typeof KEYED_STORES[number];
type KvStore = typeof KV_STORES[number];

export interface WorkstrExport {
  schema: number;
  app: 'workstr-web';
  exportedAt: string;
  pubkeyNamespace: string;
  stores: Record<string, unknown[]>;
}

export async function exportDatabase(db: IDBPDatabase<WorkstrDB>, pubkeyNamespace: string): Promise<WorkstrExport> {
  const stores: Record<string, unknown[]> = {};
  for (const name of KEYED_STORES) {
    stores[name] = await db.getAll(name);
  }
  for (const name of KV_STORES) {
    const keys = await db.getAllKeys(name);
    const values = await db.getAll(name);
    stores[name] = keys.map((key, index) => ({ key, value: exportValue(name, values[index]) }));
  }
  return { schema: EXPORT_SCHEMA, app: 'workstr-web', exportedAt: new Date().toISOString(), pubkeyNamespace, stores };
}

// The settings row mixes user preferences with device-local state. NWC credentials are
// intentionally not stored here at all: `src/nostr/nwc-storage.ts` keeps them encrypted
// in a dedicated secure-storage database. Keep this scrubber for old/dev rows and as a
// defense-in-depth guard before writing any manual JSON archive.
function exportValue(store: KvStore, value: unknown): unknown {
  if (store !== 'settings' || !value || typeof value !== 'object') return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.nwc;
  return copy;
}

// Wipe-and-replace the current namespace's stores from an export. Destructive by
// design (predictable over a field-merge); callers must confirm first.
export async function importDatabase(db: IDBPDatabase<WorkstrDB>, data: WorkstrExport): Promise<void> {
  assertWorkstrExport(data);
  // `sync_seen` is wiped but never exported: it describes which relay events this database
  // already contains, and an import replaces exactly that. Carrying it across would tell
  // the next pull it had already read records the imported data does not hold.
  const names = [...KEYED_STORES, ...KV_STORES, 'sync_seen' as const];
  const tx = db.transaction(names, 'readwrite');
  await tx.objectStore('sync_seen').clear();
  for (const name of KEYED_STORES) {
    const store = tx.objectStore(name as KeyedStore);
    await store.clear();
    // The queue is emptied, never restored. Its entries name addresses this build may no
    // longer be able to publish, and an export carries whatever was pending on the device
    // that wrote it — replaying that onto a different database uploads the wrong thing at
    // best and wedges the engine at worst. Everything imported is enqueued by the backfill.
    if (name === 'sync_queue') continue;
    for (const row of (data.stores[name] || [])) await store.put(importedRow(name, row) as never);
  }
  for (const name of KV_STORES) {
    const store = tx.objectStore(name as KvStore);
    await store.clear();
    for (const entry of (data.stores[name] || []) as { key: string; value: unknown }[]) {
      await store.put(entry.value as never, entry.key);
    }
  }
  await tx.done;
}

// Importing a JSON archive is the user deliberately moving their training onto this
// database, so what arrives joins the live backup era. Without this, sessions written
// before the era existed — or by an older build that had no such field — would be held
// back from backup forever while the panel still reported everything up to date.
function importedRow(store: KeyedStore, row: unknown): unknown {
  if (store !== 'sessions') return row;
  return { ...(row as Record<string, unknown>), backup_version: 2 };
}

export function assertWorkstrExport(data: unknown): asserts data is WorkstrExport {
  const candidate = data as Partial<WorkstrExport> | null;
  if (!candidate || candidate.app !== 'workstr-web' || candidate.schema !== EXPORT_SCHEMA || typeof candidate.stores !== 'object') {
    throw new Error(`Not a Workstr export file (expected app "workstr-web", schema ${EXPORT_SCHEMA}).`);
  }
}

export function parseExport(text: string): WorkstrExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  assertWorkstrExport(data);
  return data;
}

export function exportFilename(date = new Date()): string {
  return `workstr-export-${date.toISOString().slice(0, 10)}.json`;
}

export function downloadExport(data: WorkstrExport): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename();
  link.click();
  URL.revokeObjectURL(url);
}
