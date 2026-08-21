import type { IDBPDatabase } from 'idb';
import type { WorkstrDB } from './schema';
import type { BackupSettings, BodyWeightEntry, Session, SessionSet, Sheet, WorkstrSettings } from '../core/types';
import { isRecordAddress } from '../sync/addresses';

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
