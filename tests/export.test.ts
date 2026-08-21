import { describe, expect, it } from 'vitest';
import { openWorkstrDB } from '../src/db/schema';
import {
  exportDatabase, importDatabase, parseExport, assertWorkstrExport, exportFilename, EXPORT_SCHEMA
} from '../src/db/export';

async function seed(namespace: string): Promise<void> {
  const db = await openWorkstrDB(namespace);
  await db.put('exercises', { id: 1, slug: 'bench', name: 'Bench Press', muscles: [], equipment: [], tags: [], instructions: [], favourite: true, source_type: 'imported', status: 'active' } as never);
  await db.put('sheets', { id: 1, slug: 'push', name: 'Push Day', is_temporary: false, created_at: 'x', updated_at: 'x' } as never);
  await db.put('sheet_exercises', { id: 1, sheet_id: 1, exercise_slug: 'bench', position: 0 } as never);
  await db.put('sessions', { id: 1, started_at: '2026-01-01T00:00:00Z' } as never);
  await db.put('session_sets', { id: 1, session_id: 1, exercise_slug: 'bench', set_number: 1, reps: 8, weight_kg: 60, completed_at: 'x' } as never);
  await db.put('bodyweight', { id: 1, date: '2026-01-01', weight_kg: 70 } as never);
  await db.put('sync_queue', { address: 'a:b:c', updated_at: 'x' } as never);
  await db.put('settings', { unit: 'kg' } as never, 'workstr');
  db.close();
}

async function wipe(namespace: string): Promise<void> {
  const db = await openWorkstrDB(namespace);
  const names = ['exercises', 'sheets', 'sheet_exercises', 'sessions', 'session_sets', 'bodyweight', 'sync_queue', 'settings'] as const;
  const tx = db.transaction(names, 'readwrite');
  await Promise.all(names.map((name) => tx.objectStore(name).clear()));
  await tx.done;
  db.close();
}

describe('export/import round-trip', () => {
  it('exports every store (minus blobs) and restores an identical dataset', async () => {
    const ns = 'export-roundtrip';
    await seed(ns);

    const db = await openWorkstrDB(ns);
    const dump = await exportDatabase(db, ns);
    db.close();

    // Shape assertions.
    expect(dump.schema).toBe(EXPORT_SCHEMA);
    expect(dump.app).toBe('workstr-web');
    expect(dump.pubkeyNamespace).toBe(ns);
    expect(Object.keys(dump.stores)).not.toContain('blobs');
    expect(dump.stores.exercises).toHaveLength(1);
    // Out-of-line stores keep their keys.
    expect(dump.stores.settings).toEqual([{ key: 'workstr', value: { unit: 'kg' } }]);
    // The retired `plan` store is not exported at all; an older file carrying one imports fine.
    expect(dump.stores.plan).toBeUndefined();

    await wipe(ns);
    const empty = await openWorkstrDB(ns);
    expect(await empty.getAll('exercises')).toHaveLength(0);
    await importDatabase(empty, dump);
    const restored = await exportDatabase(empty, ns);
    empty.close();

    // Everything is restored as it was, with two deliberate exceptions below.
    expect(restored.stores).toEqual({
      ...dump.stores,
      sessions: [{ id: 1, started_at: '2026-01-01T00:00:00Z', backup_version: 2 }],
      sync_queue: []
    });
  });

  it('brings imported workouts into the live backup era', async () => {
    const ns = 'export-era';
    await seed(ns);
    const db = await openWorkstrDB(ns);
    const dump = await exportDatabase(db, ns);
    db.close();

    await wipe(ns);
    const target = await openWorkstrDB(ns);
    await importDatabase(target, dump);
    // The archive's session predates the era and carries no marker. Left as it arrived it
    // would sit outside backup forever while the panel reported everything up to date.
    expect((await target.getAll('sessions')).map((row) => row.backup_version)).toEqual([2]);
    target.close();
  });

  it('empties the sync queue rather than replaying the exporting device queue', async () => {
    const ns = 'export-queue';
    await seed(ns);
    const db = await openWorkstrDB(ns);
    const dump = await exportDatabase(db, ns);
    db.close();
    // The exporting device had a pending entry; it names an address that means nothing on
    // the importing database, and this build cannot even publish it.
    expect(dump.stores.sync_queue).toHaveLength(1);

    await wipe(ns);
    const target = await openWorkstrDB(ns);
    await importDatabase(target, dump);
    expect(await target.getAll('sync_queue')).toHaveLength(0);
    target.close();
  });

  it('imports into a fresh (never-seeded) namespace', async () => {
    const src = 'export-src';
    await seed(src);
    const srcDb = await openWorkstrDB(src);
    const dump = await exportDatabase(srcDb, src);
    srcDb.close();

    const freshDb = await openWorkstrDB('export-fresh-target');
    await importDatabase(freshDb, dump);
    expect(await freshDb.get('exercises', 1)).toMatchObject({ slug: 'bench', favourite: true });
    expect(await freshDb.get('settings', 'workstr')).toEqual({ unit: 'kg' });
    freshDb.close();
  });
});

describe('export validation', () => {
  it('parseExport rejects non-JSON and non-Workstr payloads', () => {
    expect(() => parseExport('{ not json')).toThrow(/valid JSON/);
    expect(() => parseExport(JSON.stringify({ app: 'other', schema: 1, stores: {} }))).toThrow(/Workstr export/);
    expect(() => parseExport(JSON.stringify({ app: 'workstr-web', schema: 99, stores: {} }))).toThrow(/schema 1/);
  });
  it('parseExport accepts a valid payload', () => {
    const valid = { app: 'workstr-web', schema: EXPORT_SCHEMA, exportedAt: 'x', pubkeyNamespace: 'local', stores: {} };
    expect(parseExport(JSON.stringify(valid))).toEqual(valid);
    expect(() => assertWorkstrExport(valid)).not.toThrow();
  });
});

describe('exportFilename', () => {
  it('is date-stamped', () => {
    expect(exportFilename(new Date('2026-07-21T12:00:00Z'))).toBe('workstr-export-2026-07-21.json');
  });
});
