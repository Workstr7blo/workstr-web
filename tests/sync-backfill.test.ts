import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { collectRecords, resolveRecord, runBackfill } from '../src/sync/backfill';
import { BODYWEIGHT_ADDRESS, MANIFEST_ADDRESS, SETTINGS_ADDRESS, sessionAddress, sessionsAddress, sheetAddress } from '../src/sync/addresses';
import { parseSessionsId } from '../src/sync/addresses';
import { MAX_BUNDLE_BYTES, sessionsBundleRecords, sessionUpdatedAt, syncedSettings, type SessionsBundlePayload } from '../src/sync/records';

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
    expect(addresses).toContain(BODYWEIGHT_ADDRESS);
    expect(addresses).toContain(SETTINGS_ADDRESS);
    expect(addresses).toContain(MANIFEST_ADDRESS);
    // V2 sessions travel as one record per session, not mutable month bundles.
    const uid = (await store.getSession(sessionId))!.uid!;
    expect(addresses).toContain(sessionAddress(uid));
    expect(addresses).not.toContain(sessionsAddress('2026-08'));
    expect(addresses.some((address) => address.startsWith('workstr:v1:'))).toBe(false);

    // Autoincrement keys are meaningless on another device.
    const sheet = records.find((record) => record.address === sheetAddress('push-day'))!;
    const payload = sheet.payload as { id?: number; exercises: { id?: number; sheet_id?: number }[] };
    expect(payload.id).toBeUndefined();
    expect(payload.exercises[0].id).toBeUndefined();
    expect(payload.exercises[0].sheet_id).toBeUndefined();
  });

  it('collects V2 sessions individually by uid', async () => {
    const store = await freshStore();
    const august = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    await store.addSessionSet({ session_id: august, exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' });
    const september = await store.createSession({ started_at: '2026-09-02T10:00:00.000Z' });
    await store.addSessionSet({ session_id: september, exercise_slug: 'squat', set_number: 1, reps: 5, completed_at: '2026-09-02T10:05:00.000Z' });

    const records = await collectRecords(store);
    const addresses = records.map((record) => record.address);
    const augustUid = (await store.getSession(august))!.uid!;
    const septemberUid = (await store.getSession(september))!.uid!;
    expect(addresses).toContain(sessionAddress(augustUid));
    expect(addresses).toContain(sessionAddress(septemberUid));
    expect(addresses).not.toContain(sessionsAddress('2026-08'));
    expect(addresses).not.toContain(sessionsAddress('2026-09'));

    const record = records.find((candidate) => candidate.address === sessionAddress(augustUid))!;
    expect(record.updatedAt).toBe('2026-08-01T10:05:00.000Z');
    const payload = record.payload as { id?: number; sets: { id?: number; session_id?: number }[] };
    expect(payload.id).toBeUndefined();
    expect(payload.sets[0].session_id).toBeUndefined();
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

describe('a month too heavy for one event', () => {
  // strfry refuses an event over its size limit, so a month has to be split before it is
  // encrypted rather than discovered to be too big at the relay.
  function month(days: number, setsPerDay: number) {
    const entries = [];
    for (let day = 1; day <= days; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      entries.push({
        session: { id: day, uid: `uid-${day}`, started_at: `${date}T10:00:00.000Z`, sheet_name: 'Upper Body Hypertrophy Block A' },
        sets: Array.from({ length: setsPerDay }, (_unused, n) => ({
          session_id: day, exercise_slug: 'barbell-bench-press-medium-grip', set_number: n + 1,
          reps: 8, weight_kg: 82.5, completed_at: `${date}T10:${String(n + 1).padStart(2, '0')}:00.000Z`
        }))
      });
    }
    return entries;
  }

  it('splits into parts that each fit, and leaves a light month whole', async () => {
    const heavy = sessionsBundleRecords('2026-08', month(24, 24));
    expect(heavy.length).toBeGreaterThan(1);
    expect(heavy[0].address).toBe(sessionsAddress('2026-08'));
    expect(heavy[1].address).toBe(sessionsAddress('2026-08', 2));
    for (const part of heavy) expect(JSON.stringify(part.payload).length).toBeLessThan(MAX_BUNDLE_BYTES * 1.2);
    // Nothing is lost in the split.
    expect(heavy.flatMap((part) => (part.payload as SessionsBundlePayload).items)).toHaveLength(24);

    const light = sessionsBundleRecords('2026-08', month(4, 6));
    expect(light).toHaveLength(1);
    expect(light[0].address).toBe(sessionsAddress('2026-08'));
  });

  // The point of packing chronologically: training today must not rewrite, and re-upload,
  // every part of the month behind it.
  it('leaves the earlier parts untouched when a session is added', async () => {
    const before = sessionsBundleRecords('2026-08', month(24, 24));
    const after = sessionsBundleRecords('2026-08', month(25, 24));
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    for (let index = 0; index < before.length - 1; index += 1) {
      expect(JSON.stringify(after[index])).toBe(JSON.stringify(before[index]));
    }
  });

  it('reads a part address back as its month', () => {
    expect(parseSessionsId('2026-08')).toEqual({ month: '2026-08', part: 1 });
    expect(parseSessionsId('2026-08-p3')).toEqual({ month: '2026-08', part: 3 });
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
    expect(addresses).toContain(sessionAddress(uid));
    expect(addresses).not.toContain(sessionsAddress('2026-08'));
    expect(addresses).toContain(BODYWEIGHT_ADDRESS);
    expect(addresses).toContain(SETTINGS_ADDRESS);
    // A logged set dates the session record by when the set happened.
    expect(seen.find((entry) => entry.address === sessionAddress(uid))?.updatedAt).toBe('2026-08-01T10:05:00.000Z');
  });

  it('reports deletions before the row is gone, so the address is still knowable', async () => {
    const sheetId = await store.saveSheet({ name: 'Push Day', exercises: [] });
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    const uid = (await store.getSession(sessionId))!.uid!;
    seen = [];
    await store.deleteSheet(sheetId);
    await store.deleteSession(sessionId);
    // A deleted V2 session needs only its own tombstone. Monthly bundles are no longer
    // rewritten by normal workout-history changes.
    expect(seen.map((entry) => entry.address)).toEqual([sheetAddress('push-day'), sessionAddress(uid)]);
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
