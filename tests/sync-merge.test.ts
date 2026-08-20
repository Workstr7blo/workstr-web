import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { mergeRecords } from '../src/sync/merge';
import { BODYWEIGHT_ADDRESS, MANIFEST_ADDRESS, SETTINGS_ADDRESS, sessionAddress, sessionsAddress, sheetAddress } from '../src/sync/addresses';
import type { DecodedPrivateRecord } from '../src/nostr/codecs30078';

let namespace = 0;
const freshStore = () => WorkstrStore.open(`merge-${namespace += 1}`);

function record(address: string, updatedAt: string, payload: unknown, deleted = false): DecodedPrivateRecord {
  const rest = address.slice('workstr:v1:'.length);
  const separator = rest.indexOf(':');
  const parsed = separator === -1
    ? { kind: rest as never }
    : { kind: rest.slice(0, separator) as never, id: rest.slice(separator + 1) };
  return { address, parsed, updatedAt, deleted, payload: deleted ? undefined : payload, eventId: 'e', createdAt: 1 };
}

describe('merging records into an empty database', () => {
  it('restores every record kind', async () => {
    const store = await freshStore();
    const summary = await mergeRecords(store, [
      record(sheetAddress('push-day'), '2026-08-20T10:00:00.000Z', {
        name: 'Push Day', slug: 'push-day', is_temporary: false, created_at: 'x', updated_at: 'x',
        exercises: [{ exercise_slug: 'bench', position: 0, sets: 3 }]
      }),
      record(sessionAddress('uid-1'), '2026-08-20T10:00:00.000Z', {
        started_at: '2026-08-01T10:00:00.000Z', finished_at: '2026-08-01T11:00:00.000Z',
        sets: [{ exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: '2026-08-01T10:05:00.000Z' }]
      }),
      record(BODYWEIGHT_ADDRESS, '2026-08-20T10:00:00.000Z', { entries: [{ date: '2026-08-01', weight_kg: 80 }] }),
      record(SETTINGS_ADDRESS, '2026-08-20T10:00:00.000Z', { unit: 'lbs', ownedEquipment: ['barbell'] })
    ]);
    expect(summary.applied).toBe(4);

    const sheets = await store.listSheets();
    expect(sheets[0].name).toBe('Push Day');
    expect(sheets[0].exercises).toHaveLength(1);
    const session = await store.getSessionByUid('uid-1');
    expect(session?.finished_at).toBe('2026-08-01T11:00:00.000Z');
    expect(await store.listSessionSets(session!.id!)).toHaveLength(1);
    expect(await store.listBody()).toHaveLength(1);
    expect((await store.getSettings()).unit).toBe('lbs');
  });

  it('never merges the manifest into the database', async () => {
    const store = await freshStore();
    const summary = await mergeRecords(store, [record(MANIFEST_ADDRESS, '2026-08-20T10:00:00.000Z', { entries: [] })]);
    expect(summary).toMatchObject({ applied: 0, skipped: 0 });
  });

  it('keeps this device relay, signer and backup settings on a restore', async () => {
    const store = await freshStore();
    await store.saveSettings({ ...(await store.getSettings()), workstrRelay: 'wss://mine', signerType: 'nip46', backup: { enabled: true } });
    await mergeRecords(store, [record(SETTINGS_ADDRESS, '2099-01-01T00:00:00.000Z', { unit: 'lbs' })]);
    const settings = await store.getSettings();
    expect(settings.unit).toBe('lbs');
    expect(settings.workstrRelay).toBe('wss://mine');
    expect(settings.signerType).toBe('nip46');
    expect(settings.backup).toEqual({ enabled: true });
  });
});

function bundle(month: string, items: { uid: string; updatedAt: string; deleted?: boolean; payload?: unknown }[]) {
  const updatedAt = items.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), items[0]?.updatedAt || '');
  return record(sessionsAddress(month), updatedAt, { month, items });
}

function session(startedAt: string, completedAt: string) {
  return { started_at: startedAt, sets: [{ exercise_slug: 'bench', set_number: 1, reps: 8, completed_at: completedAt }] };
}

describe('month bundles', () => {
  it('restores a whole month from one record', async () => {
    const store = await freshStore();
    const summary = await mergeRecords(store, [bundle('2026-08', [
      { uid: 'uid-1', updatedAt: '2026-08-01T10:05:00.000Z', payload: session('2026-08-01T10:00:00.000Z', '2026-08-01T10:05:00.000Z') },
      { uid: 'uid-2', updatedAt: '2026-08-03T10:05:00.000Z', payload: session('2026-08-03T10:00:00.000Z', '2026-08-03T10:05:00.000Z') }
    ])]);

    expect(summary.applied).toBe(2);
    expect(await store.listSessions()).toHaveLength(2);
    const restored = await store.getSessionByUid('uid-2');
    expect(await store.listSessionSets(restored!.id!)).toHaveLength(1);
  });

  // The reason a bundle carries a timestamp per session rather than one for the record:
  // both devices write the same address, and taking the newer event whole would delete
  // whatever the other device trained that month.
  it('keeps a session the other device never had', async () => {
    const store = await freshStore();
    const mine = await store.createSession({ started_at: '2026-08-05T10:00:00.000Z' });
    const myUid = (await store.getSession(mine))!.uid!;

    await mergeRecords(store, [bundle('2026-08', [
      { uid: 'theirs', updatedAt: '2026-08-20T10:05:00.000Z', payload: session('2026-08-20T10:00:00.000Z', '2026-08-20T10:05:00.000Z') }
    ])]);

    expect(await store.getSessionByUid(myUid)).toBeTruthy();
    expect(await store.getSessionByUid('theirs')).toBeTruthy();
  });

  it('does not overwrite a session this device has taken further', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-05T10:00:00.000Z' });
    const uid = (await store.getSession(id))!.uid!;
    await store.addSessionSet({ session_id: id, exercise_slug: 'squat', set_number: 1, reps: 5, completed_at: '2026-08-05T12:00:00.000Z' });

    const summary = await mergeRecords(store, [bundle('2026-08', [
      { uid, updatedAt: '2026-08-05T10:05:00.000Z', payload: session('2026-08-05T10:00:00.000Z', '2026-08-05T10:05:00.000Z') }
    ])]);

    expect(summary.skipped).toBe(1);
    expect((await store.listSessionSets(id))[0].exercise_slug).toBe('squat');
  });

  it('does not resurrect a session this device deleted but has not uploaded yet', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-05T10:00:00.000Z' });
    const uid = (await store.getSession(id))!.uid!;
    await store.enqueueSync(sessionAddress(uid), '2026-08-06T10:00:00.000Z');
    await store.deleteSession(id);

    const summary = await mergeRecords(store, [bundle('2026-08', [
      { uid, updatedAt: '2026-08-05T10:05:00.000Z', payload: session('2026-08-05T10:00:00.000Z', '2026-08-05T10:05:00.000Z') }
    ])]);

    expect(summary.skipped).toBe(1);
    expect(await store.getSessionByUid(uid)).toBeUndefined();
  });

  it('applies a deletion another device recorded inside the bundle', async () => {
    const store = await freshStore();
    const id = await store.createSession({ started_at: '2026-08-05T10:00:00.000Z' });
    const uid = (await store.getSession(id))!.uid!;

    const summary = await mergeRecords(store, [bundle('2026-08', [
      { uid, updatedAt: '2026-08-09T10:00:00.000Z', deleted: true }
    ])]);

    expect(summary.deleted).toBe(1);
    expect(await store.getSessionByUid(uid)).toBeUndefined();
  });
});

describe('last write wins', () => {
  it('does not let an older remote record overwrite newer local work', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Local Name', exercises: [] });
    const local = (await store.listSheets())[0];
    const summary = await mergeRecords(store, [
      record(sheetAddress(local.slug), '2000-01-01T00:00:00.000Z', { name: 'Ancient', slug: local.slug, exercises: [] })
    ]);
    expect(summary.skipped).toBe(1);
    expect((await store.listSheets())[0].name).toBe('Local Name');
  });

  it('applies a newer remote record over older local work', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Local Name', exercises: [] });
    const local = (await store.listSheets())[0];
    const summary = await mergeRecords(store, [
      record(sheetAddress(local.slug), '2099-01-01T00:00:00.000Z', { name: 'Newer', slug: local.slug, exercises: [] })
    ]);
    expect(summary.applied).toBe(1);
    expect((await store.listSheets())[0].name).toBe('Newer');
  });

  it('lets an unsent local edit outrank the relay', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Local Name', exercises: [] });
    const local = (await store.listSheets())[0];
    // Pending in the queue = edited here and not yet uploaded.
    await store.enqueueSync(sheetAddress(local.slug), '2099-06-01T00:00:00.000Z');
    const summary = await mergeRecords(store, [
      record(sheetAddress(local.slug), '2099-01-01T00:00:00.000Z', { name: 'Remote', slug: local.slug, exercises: [] })
    ]);
    expect(summary.skipped).toBe(1);
    expect((await store.listSheets())[0].name).toBe('Local Name');
  });
});

describe('tombstones', () => {
  it('deletes a sheet and a session the other device removed', async () => {
    const store = await freshStore();
    await store.saveSheet({ name: 'Doomed', exercises: [] });
    const sessionId = await store.createSession({ started_at: '2026-08-01T10:00:00.000Z' });
    const uid = (await store.getSession(sessionId))!.uid!;
    const summary = await mergeRecords(store, [
      record(sheetAddress('doomed'), '2099-01-01T00:00:00.000Z', null, true),
      record(sessionAddress(uid), '2099-01-01T00:00:00.000Z', null, true)
    ]);
    expect(summary.deleted).toBe(2);
    expect(await store.listSheets()).toHaveLength(0);
    expect(await store.listSessions()).toHaveLength(0);
  });

  it('will not let a stray tombstone blank a whole collection', async () => {
    const store = await freshStore();
    await store.logBody({ date: '2026-08-01', weight_kg: 80 });
    await store.saveSettings({ ...(await store.getSettings()), unit: 'lbs' });
    const summary = await mergeRecords(store, [
      record(BODYWEIGHT_ADDRESS, '2099-01-01T00:00:00.000Z', null, true),
      record(SETTINGS_ADDRESS, '2099-01-01T00:00:00.000Z', null, true)
    ]);
    expect(summary.deleted).toBe(0);
    expect(await store.listBody()).toHaveLength(1);
    expect((await store.getSettings()).unit).toBe('lbs');
  });

  it('treats a tombstone for something already gone as nothing to do', async () => {
    const store = await freshStore();
    const summary = await mergeRecords(store, [record(sheetAddress('never-existed'), '2099-01-01T00:00:00.000Z', null, true)]);
    expect(summary).toMatchObject({ deleted: 0, skipped: 1 });
  });
});

describe('merge safety', () => {
  it('does not re-enqueue what it just merged', async () => {
    const store = await freshStore();
    const seen: string[] = [];
    store.setChangeListener((address) => seen.push(address));
    await mergeRecords(store, [
      record(sheetAddress('push-day'), '2099-01-01T00:00:00.000Z', { name: 'Push Day', slug: 'push-day', exercises: [] }),
      record(SETTINGS_ADDRESS, '2099-01-01T00:00:00.000Z', { unit: 'lbs' })
    ]);
    // Re-enqueueing a merged record would upload what was just downloaded, forever.
    expect(seen).toEqual([]);
    expect(await store.listSyncQueue()).toHaveLength(0);
  });

  it('counts a damaged record and carries on with the rest', async () => {
    const store = await freshStore();
    const summary = await mergeRecords(store, [
      record(sheetAddress('broken'), '2099-01-01T00:00:00.000Z', { exercises: 'not-an-array' }),
      record(SETTINGS_ADDRESS, '2099-01-01T00:00:00.000Z', { unit: 'lbs' })
    ], 2);
    // Two undecryptable events were reported by the caller, plus this one damaged payload.
    expect(summary.unreadable).toBe(3);
    expect(summary.applied).toBe(1);
    expect((await store.getSettings()).unit).toBe('lbs');
  });
});
