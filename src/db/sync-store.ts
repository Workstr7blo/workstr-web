import type { IDBPDatabase } from 'idb';
import type { WorkstrDB } from './schema';
import type { BackupSettings, BodyWeightEntry, Session, SessionSet, Sheet, WorkstrSettings } from '../core/types';
import { isRecordAddress } from '../sync/addresses';

export interface JournalRow {
  id?: number;
  kind: 'log' | 'body';
  uid: string;
  updated_at: string;
  deleted?: boolean;
  seq: number | null;
}

export interface SeenRecord {
  address: string;
  event_id: string;
  created_at: number;
  // Set when this device published the record: the record's own timestamp, which is what
  // says whether the copy on the relay is still current. Absent on a record this device
  // only read, where the event id already answers that question.
  updated_at?: string;
}

// The half of the store that backup cares about: what changed, what is queued to upload,
// and how a record arriving from the relay is written back. Split from `store.ts` because
// the CRUD surface and the sync surface grow independently, and one file carrying both
// outgrows its size budget. `WorkstrStore` extends this, so callers see one store.
export abstract class SyncAwareStore {
  protected constructor(protected readonly db: IDBPDatabase<WorkstrDB>) {}

  // Set by the sync engine when backup is on. Living on the store means every write path
  // reports itself, rather than each caller remembering to.
  private changeListener: ((address: string, updatedAt: string) => void) | null = null;

  setChangeListener(listener: ((address: string, updatedAt: string) => void) | null): void {
    this.changeListener = listener;
  }

  private applyingRemote = false;

  protected noteChange(address: string, updatedAt = new Date().toISOString()): void {
    // A record merged from the relay is not a local change. Re-enqueueing it would
    // upload what was just downloaded, forever.
    if (this.applyingRemote) return;
    this.changeListener?.(address, updatedAt);
  }

  // A change to something that travels in the append-only log. It is written to the
  // journal rather than queued by address, because which chunk it lands in is not known
  // until the chunk is packed — a queue full of chunk addresses would go stale the moment
  // one entry moved between chunks.
  //
  // The listener is still told, so the engine debounces and schedules a pass exactly as it
  // does for a sheet: the journal says what to send, the listener says when.
  protected noteLogChange(kind: 'log' | 'body', uid: string, updatedAt = new Date().toISOString(), deleted = false): void {
    if (this.applyingRemote) return;
    void this.noteJournal(kind, uid, updatedAt, deleted).then(() => {
      this.changeListener?.(`${kind}:${uid}`, updatedAt);
    });
  }

  // Every write inside `apply` is treated as a merge rather than an edit.
  async applyRemote<T>(apply: () => Promise<T>): Promise<T> {
    this.applyingRemote = true;
    try {
      return await apply();
    } finally {
      this.applyingRemote = false;
    }
  }

  async getSheetBySlug(slug: string): Promise<Sheet | undefined> {
    return this.db.getFromIndex('sheets', 'slug', slug);
  }

  async getSessionByUid(uid: string): Promise<Session | undefined> {
    return (await this.db.getAll('sessions')).find((session) => session.uid === uid);
  }

  // Replaces a session and its sets wholesale. A session record travels as one payload,
  // so a partial apply would leave sets from two different versions side by side.
  async putSessionWithSets(session: Session, sets: Omit<SessionSet, 'id' | 'session_id'>[]): Promise<number> {
    const existing = session.uid ? await this.getSessionByUid(session.uid) : undefined;
    const tx = this.db.transaction(['sessions', 'session_sets'], 'readwrite');
    const sessions = tx.objectStore('sessions');
    const value = { ...session, backup_version: session.backup_version ?? 2, ...(existing?.id ? { id: existing.id } : {}) };
    const id = Number(existing?.id ? await sessions.put(value) : await sessions.add(value));
    const rows = tx.objectStore('session_sets');
    for await (const cursor of rows.index('session_id').iterate(id)) await cursor.delete();
    for (const set of sets) await rows.add({ ...set, session_id: id });
    await tx.done;
    return id;
  }

  // Writes one weigh-in, keyed by its date. Used by the merge, which applies the body log
  // an entry at a time rather than replacing the collection.
  async putBodyEntry(entry: Omit<BodyWeightEntry, 'id'>): Promise<void> {
    const tx = this.db.transaction('bodyweight', 'readwrite');
    const existing = await tx.store.index('date').get(String(entry.date));
    await tx.store.put({ ...(existing || {}), ...entry } as BodyWeightEntry);
    await tx.done;
  }

  async replaceBodyweight(entries: Omit<BodyWeightEntry, 'id'>[]): Promise<void> {
    const tx = this.db.transaction('bodyweight', 'readwrite');
    await tx.store.clear();
    for (const entry of entries) await tx.store.put(entry as BodyWeightEntry);
    await tx.done;
  }
  // Idempotent by address: an address queued twice before it uploads is still one upload,
  // and the newer timestamp wins so a stale entry cannot pin an old version.
  async enqueueSync(address: string, updatedAt: string): Promise<void> {
    const existing = await this.db.get('sync_queue', address);
    if (existing && existing.updated_at >= updatedAt) return;
    await this.db.put('sync_queue', { address, updated_at: updatedAt });
  }

  async listSyncQueue(): Promise<{ address: string; updated_at: string }[]> {
    return (await this.db.getAll('sync_queue')).sort((a, b) => a.address.localeCompare(b.address));
  }

  // Only called after the relay acknowledges the publish, so a failed upload keeps its
  // place in the queue instead of being silently dropped.
  async dequeueSync(address: string, publishedUpdatedAt: string): Promise<void> {
    const existing = await this.db.get('sync_queue', address);
    // A change made while the upload was in flight must survive it.
    if (existing && existing.updated_at > publishedUpdatedAt) return;
    await this.db.delete('sync_queue', address);
  }

  async clearSyncQueue(): Promise<void> {
    await this.db.clear('sync_queue');
  }

  // Entries this client can no longer publish: a `workstr:v1:` address left behind by the
  // previous version, or anything else `parseAddress` refuses. Left in place they resolve
  // to nothing, publish as a tombstone at an address the relay rejects, and wedge the
  // engine in a permanent error that no retry can clear — so they are dropped once, at the
  // cutover, rather than retried forever.
  async purgeUnpublishableQueue(): Promise<number> {
    let purged = 0;
    for (const entry of await this.listSyncQueue()) {
      if (isRecordAddress(entry.address)) continue;
      await this.db.delete('sync_queue', entry.address);
      purged += 1;
    }
    return purged;
  }

  // Appends to this device's log. An entry that has not been published yet is updated in
  // place rather than added twice: until it has a chunk, the only thing that matters about
  // it is that the uid is dirty and how recently it changed.
  async noteJournal(kind: 'log' | 'body', uid: string, updatedAt: string, deleted = false): Promise<void> {
    const pending = (await this.db.getAllFromIndex('journal', 'uid', uid))
      .filter((row) => row.kind === kind && row.seq === null);
    const existing = pending[0];
    if (existing?.id != null) {
      if (existing.updated_at > updatedAt && existing.deleted === deleted) return;
      await this.db.put('journal', { ...existing, updated_at: updatedAt, deleted });
      return;
    }
    await this.db.add('journal', { kind, uid, updated_at: updatedAt, deleted, seq: null });
  }

  async listJournal(kind: 'log' | 'body'): Promise<JournalRow[]> {
    return (await this.db.getAllFromIndex('journal', 'kind', kind))
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  // Everything not yet in a chunk, oldest first: the order they are packed in, so a chunk
  // reads chronologically and the tail is what keeps changing.
  async listPendingJournal(kind: 'log' | 'body'): Promise<JournalRow[]> {
    return (await this.listJournal(kind)).filter((row) => row.seq === null);
  }

  // Rows whose chunk no longer carries them, after a compaction rewrote it. The entry
  // itself is not lost: a later chunk is what superseded it in the first place.
  async dropJournalRows(ids: number[]): Promise<void> {
    for (const id of ids) await this.db.delete('journal', id);
  }

  async clearJournal(): Promise<void> {
    await this.db.clear('journal');
  }

  async assignJournalSeq(ids: number[], seq: number): Promise<void> {
    for (const id of ids) {
      const row = await this.db.get('journal', id);
      if (row) await this.db.put('journal', { ...row, seq });
    }
  }

  // A uid this device has an unpublished deletion for. A chunk from another device that
  // still carries the session must not write it back.
  async pendingDeletions(kind: 'log' | 'body'): Promise<Set<string>> {
    return new Set((await this.listPendingJournal(kind)).filter((row) => row.deleted).map((row) => row.uid));
  }

  // The ledger of relay events this device has already read or written. Its whole purpose
  // is to make a pull cheap: an event whose id is already recorded against its address
  // needs no decrypt, and a decrypt is a round trip to the signer app.
  async listSeen(): Promise<SeenRecord[]> {
    return this.db.getAll('sync_seen');
  }

  async noteSeen(address: string, eventId: string, createdAt: number, updatedAt?: string): Promise<void> {
    if (!eventId || !Number.isFinite(createdAt)) return;
    const existing = await this.db.get('sync_seen', address);
    // An older event for the same address is a replay, not news: the relay keeps only the
    // newest, and recording it would drag the pull cursor backwards.
    if (existing && existing.created_at > createdAt) return;
    await this.db.put('sync_seen', { address, event_id: eventId, created_at: createdAt, ...(updatedAt ? { updated_at: updatedAt } : {}) });
  }

  // Backup progress is device-local state, deliberately outside the synced settings
  // record. Writing it through `saveSettings` would queue the settings record on every
  // status update, and uploading that record updates the status again — a sync loop that
  // never settles.
  async saveBackupState(patch: Partial<BackupSettings>): Promise<BackupSettings> {
    const stored = (await this.db.get('settings', 'settings')) as Partial<WorkstrSettings> | undefined;
    const backup: BackupSettings = { enabled: false, ...stored?.backup, ...patch };
    await this.db.put('settings', { ...stored, backup } as WorkstrSettings, 'settings');
    return backup;
  }
}
