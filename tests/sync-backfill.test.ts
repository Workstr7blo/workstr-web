import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { collectRecords, resolveRecord, runBackfill, seedJournal } from '../src/sync/backfill';
import { SETTINGS_ADDRESS, sessionAddress, sheetAddress } from '../src/sync/addresses';
import { sessionUpdatedAt, syncedSettings } from '../src/sync/records';

let namespace = 0;
async function freshStore(): Promise<WorkstrStore> {
  namespace += 1;
  return WorkstrStore.open(`backfill-${namespace}`);
}

async function populate(store: WorkstrStore) {
  await store.saveSheet({ name: 'Push Day', exercises: [{ exercise_slug: 'bench', position: 0, sets: 3 }] });
  const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z', sheet_name: 'Push Day' });
  await store.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
  await store.logBody({ date: '2026-08-01', weight_kg: 80 });
  await store.saveSettings({ ...(await store.getSettings()), unit: 'lbs' });
  return sessionId;
}

describe('record collection', () => {
  it('covers every private record kind, with local keys stripped', async () => {
    const store = await freshStore();
    const sessionId = await populate(store);
    const records = await collectRecords(store);
    const addresses = records.map((record) => record.address);
    expect(addresses).toContain(sheetAddress('push-day'));
    expect(addresses).toContain(SETTINGS_ADDRESS);
    // Neither workout history nor the body log is here: it travels in the append-only log, packed at push time.
    const uid = (await store.getSession(sessionId))!.uid!;
    expect(addresses).not.toContain(sessionAddress(uid));
    expect(addresses.some((address) => address.includes(':sessions:'))).toBe(false);
    expect(addresses.some((address) => address.startsWith('workstr:v1:'))).toBe(false);

    // Autoincrement keys are meaningless on another device.
    const sheet = records.find((record) => record.address === sheetAddress('push-day'))!;
    const payload = sheet.payload as { id?: number; exercises: { id?: number; sheet_id?: number }[] };
    expect(payload.id).toBeUndefined();
    expect(payload.exercises[0].id).toBeUndefined();
    expect(payload.exercises[0].sheet_id).toBeUndefined();
  });

  it('seeds backed-up sessions into the log, once', async () => {
    const store = await freshStore();
    const august = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    await store.addSessionSet({ session_id: august, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    await store.finishSession(august, '2026-08-01T11:00:00.000Z');
    const legacy = await store.createSession({ started_at: '2025-01-01T10:00:00.000Z', backup_version: 1 });
    await store.finishSession(legacy, '2025-01-01T11:00:00.000Z');
    await store.clearJournal();

    expect(await seedJournal(store)).toBe(1);
    const journal = await store.listJournal('log');
    expect(journal.map((row) => row.uid)).toEqual([(await store.getSession(august))!.uid]);
    // Pre-cutover history stays on the device.
    expect(journal.map((row) => row.uid)).not.toContain((await store.getSession(legacy))!.uid);
    // Running it again adds nothing: an interrupted first pass must be safe to repeat.
    expect(await seedJournal(store)).toBe(0);
    expect(await store.listJournal('log')).toHaveLength(1);
  });

  it('keeps device-local settings out of the synced record', async () => {
    const picked = syncedSettings({
      unit: 'kg', publicRelays: ['wss://a'], ownedEquipment: ['barbell'],
      workstrRelay: 'wss://relay.workstr.fit:43736', signerType: 'nip46',
      canonCache: { fetchedAt: 1, events: [] }, syncCursor: 5,
      backup: { enabled: true, lastSyncAt: 'now' }
    });
    expect(picked).toEqual({ unit: 'kg', publicRelays: ['wss://a'], ownedEquipment: ['barbell'] });
    for (const key of ['workstrRelay', 'signerType', 'canonCache', 'backup', 'syncCursor']) {
      expect(JSON.stringify(picked)).not.toContain(key);
    }
  });

  it('excludes the Quick Workout scratch sheet', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Quick', is_temporary: true, exercises: [] });
    const addresses = (await collectRecords(store)).map((record) => record.address);
    expect(addresses).not.toContain(sheetAddress('quick'));
  });

  it('dates a session by the newest thing that happened to it', () => {
    const stamp = sessionUpdatedAt(
      { started_at: '2026-08-01T10:00:00.000Z', finished_at: '2026-08-01T11:00:00.000Z' },
      [{ session_id: 1, set_number: 1, reps: 5, completed_at: '2026-08-01T12:00:00.000Z' }]
    );
    expect(stamp).toBe('2026-08-01T12:00:00.000Z');
  });
});

describe('first-run backfill', () => {
  it('enqueues the whole history exactly once', async () => {
    const store = await freshStore();
    await populate(store);
    const first = await runBackfill(store);
    expect(first.cursor).toBe(first.total);
    const queued = await store.listSyncQueue();
    expect(queued.length).toBe(first.total);
    // Running it again must not duplicate: the queue is keyed by address.
    await runBackfill(store);
    expect((await store.listSyncQueue()).length).toBe(first.total);
  });

  it('resumes from the cursor instead of restarting', async () => {
    const store = await freshStore();
    await populate(store);
    const progress: number[] = [];
    // Interrupt after two records, exactly as a closed tab would.
    await expect(runBackfill(store, 0, ({ cursor }) => {
      progress.push(cursor);
      if (cursor === 2) throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    const partial = await store.listSyncQueue();
    expect(partial.length).toBe(2);

    const enqueueSpy = vi.spyOn(store, 'enqueueSync');
    const resumed = await runBackfill(store, 2);
    expect(resumed.cursor).toBe(resumed.total);
    // The two already-sent records are not re-enqueued.
    expect(enqueueSpy).toHaveBeenCalledTimes(resumed.total - 2);
    enqueueSpy.mockRestore();
  });
});

describe('change tracking', () => {
  let store: WorkstrStore;
  let seen: { address: string; updatedAt: string }[];

  beforeEach(async () => {
    store = await freshStore();
    seen = [];
    store.setChangeListener((address, updatedAt) => seen.push({ address, updatedAt }));
  });

  it('reports the right address for every write path', async () => {
    await store.saveSheet({ name: 'Push Day', exercises: [] });
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    await store.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    await store.finishSession(sessionId, '2026-08-01T11:00:00.000Z');
    await store.logBody({ date: '2026-08-02', weight_kg: 81 });
    await store.saveSettings({ ...(await store.getSettings()), unit: 'lbs' });
    const uid = (await store.getSession(sessionId))!.uid!;

    const addresses = seen.map((entry) => entry.address);
    expect(addresses).toContain(sheetAddress('push-day'));
    expect(addresses).toContain(`log:${uid}`);
    expect(addresses.some((address) => address.includes(':sessions:'))).toBe(false);
    // A weigh-in reports the date it belongs to, not the whole collection.
    expect(addresses).toContain('body:2026-08-02');
    expect(addresses).toContain(SETTINGS_ADDRESS);
    // Finishing dates the entry, not the set: a set logged into a running session reports
    // nothing, so no backup pass fires while the user is still training.
    expect(seen.filter((entry) => entry.address === `log:${uid}`)).toHaveLength(1);
    expect(seen.find((entry) => entry.address === `log:${uid}`)?.updatedAt).toBe('2026-08-01T11:00:00.000Z');
  });

  it('says nothing while a workout is running, and reports a set added to a finished one', async () => {
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    await store.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    // Nothing yet: the session is still open, so the signer is left alone.
    expect(seen).toHaveLength(0);

    await store.finishSession(sessionId, '2026-08-01T11:00:00.000Z');
    const uid = (await store.getSession(sessionId))!.uid!;
    // The signal follows the journal write rather than preceding it, so the engine can
    // never be told to sync a log entry that is not in the journal yet.
    await vi.waitFor(() => expect(seen.map((entry) => entry.address)).toEqual([`log:${uid}`]));

    // Editing the finished workout does report, which is how a correction reaches backup.
    seen = [];
    await store.addSessionSet({ session_id: sessionId, exercise_slug: 'bench', set_number: 2, reps: 6, completed_at: '2026-08-01T11:30:00.000Z' });
    await vi.waitFor(() => expect(seen).toEqual([{ address: `log:${uid}`, updatedAt: '2026-08-01T11:30:00.000Z' }]));
  });

  it('reports deletions before the row is gone, so the address is still knowable', async () => {
    const sheetId = await store.saveSheet({ name: 'Push Day', exercises: [] });
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    const uid = (await store.getSession(sessionId))!.uid!;
    seen = [];
    await store.deleteSheet(sheetId);
    await store.deleteSession(sessionId);
    // A deleted session appends a deletion entry to the log; the sheet still travels by
    // address, because a program is edited in place rather than journaled.
    await vi.waitFor(() => expect(seen.map((entry) => entry.address)).toEqual([sheetAddress('push-day'), `log:${uid}`]));
  });

  it('resolves a deleted address to nothing, which is how a tombstone is decided', async () => {
    const sheetId = await store.saveSheet({ name: 'Push Day', exercises: [] });
    expect(await resolveRecord(store, sheetAddress('push-day'))).not.toBeNull();
    await store.deleteSheet(sheetId);
    expect(await resolveRecord(store, sheetAddress('push-day'))).toBeNull();
    expect(await resolveRecord(store, 'other-app:thing')).toBeNull();
  });
});

describe('queue semantics', () => {
  it('keeps an entry until the publish that covered it is acknowledged', async () => {
    const store = await freshStore();
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-01T10:00:00.000Z');
    // A change arriving while the upload is in flight must survive the dequeue.
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-01T11:00:00.000Z');
    await store.dequeueSync(SETTINGS_ADDRESS, '2026-08-01T10:00:00.000Z');
    expect(await store.listSyncQueue()).toHaveLength(1);
    await store.dequeueSync(SETTINGS_ADDRESS, '2026-08-01T11:00:00.000Z');
    expect(await store.listSyncQueue()).toHaveLength(0);
  });

  it('does not let a stale enqueue pin an older version', async () => {
    const store = await freshStore();
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-01T11:00:00.000Z');
    await store.enqueueSync(SETTINGS_ADDRESS, '2026-08-01T09:00:00.000Z');
    expect((await store.listSyncQueue())[0].updated_at).toBe('2026-08-01T11:00:00.000Z');
  });
});

describe('database upgrade to version 3', () => {
  it('gives sessions written before uids existed an addressable identity', async () => {
    const { openDB } = await import('idb');
    const name = 'workstr-legacy-upgrade';
    // A version-2 database, exactly as v1.3 left it: sessions with no uid.
    const legacy = await openDB(name, 2, {
      upgrade(db) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('sheet_id', 'sheet_id');
        sessions.createIndex('started_at', 'started_at');
        const sets = db.createObjectStore('session_sets', { keyPath: 'id', autoIncrement: true });
        sets.createIndex('session_id', 'session_id');
        sets.createIndex('exercise_id', 'exercise_id');
        const exercises = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        exercises.createIndex('slug', 'slug', { unique: true });
        exercises.createIndex('status', 'status');
        const sheets = db.createObjectStore('sheets', { keyPath: 'id', autoIncrement: true });
        sheets.createIndex('slug', 'slug', { unique: true });
        const sheetExercises = db.createObjectStore('sheet_exercises', { keyPath: 'id', autoIncrement: true });
        sheetExercises.createIndex('sheet_id', 'sheet_id');
        const bodyweight = db.createObjectStore('bodyweight', { keyPath: 'id', autoIncrement: true });
        bodyweight.createIndex('date', 'date', { unique: true });
        db.createObjectStore('settings');
        db.createObjectStore('sync_queue', { keyPath: 'address' });
        db.createObjectStore('blobs');
      }
    });
    await legacy.add('sessions', { started_at: '2026-08-01T10:00:00.000Z' } as never);
    await legacy.add('sessions', { started_at: '2026-08-02T10:00:00.000Z' } as never);
    legacy.close();

    const store = await WorkstrStore.open('legacy-upgrade');
    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(2);
    for (const session of sessions) expect(session.uid).toMatch(/.+/);
    // Distinct, or two sessions would collide on one relay address.
    expect(new Set(sessions.map((session) => session.uid)).size).toBe(2);
    // Existing rows are local-only after the V2 cutoff, so they are addressable locally but
    // deliberately absent from relay backfill records.
    for (const session of sessions) expect(session.backup_version).toBe(1);
    const records = await collectRecords(store);
    for (const session of sessions) expect(records.map((record) => record.address)).not.toContain(sessionAddress(session.uid!));
  });
});
