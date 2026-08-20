import type { WorkstrStore } from '../db/store';
import { parseAddress } from './addresses';
import { bodyweightRecord, manifestRecord, sessionRecord, settingsRecord, sheetRecord, type ManifestEntry, type RecordSnapshot } from './records';

export interface BackfillProgress {
  cursor: number;
  total: number;
}

// Enumerating the whole database in a stable order is what makes the first run resumable:
// a cursor into this list means the same thing on the next attempt.
export async function collectRecords(store: WorkstrStore): Promise<RecordSnapshot[]> {
  const records: RecordSnapshot[] = [];

  const sheets = await store.listSheets();
  for (const sheet of [...sheets].sort((a, b) => a.slug.localeCompare(b.slug))) {
    // A temporary sheet is a Quick Workout scratch row, not a program the user owns.
    if (sheet.is_temporary) continue;
    records.push(sheetRecord(sheet));
  }

  const sessions = await store.listSessions();
  for (const session of [...sessions].sort((a, b) => String(a.uid).localeCompare(String(b.uid)))) {
    if (!session.uid || session.id == null) continue;
    records.push(sessionRecord(session, await store.listSessionSets(session.id)));
  }

  const settings = await store.getSettings();
  const body = await store.listBody(Number.MAX_SAFE_INTEGER);
  // Collections have no modification time of their own, so the moment they were read is
  // the honest answer — it is never older than their newest change.
  const collectedAt = new Date().toISOString();
  records.push(bodyweightRecord(body, collectedAt));
  records.push(settingsRecord(settings, collectedAt));
  records.push(manifestRecord(manifestEntries(records), collectedAt));
  return records;
}

export function manifestEntries(records: RecordSnapshot[]): ManifestEntry[] {
  return records.map((record) => ({ address: record.address, updatedAt: record.updatedAt }));
}

// Enqueues from `cursor` onward and advances it as it goes, so an interrupted run picks up
// where it stopped rather than re-uploading history it already sent.
export async function runBackfill(
  store: WorkstrStore,
  from = 0,
  onProgress?: (progress: BackfillProgress) => void | Promise<void>
): Promise<BackfillProgress> {
  const records = await collectRecords(store);
  const total = records.length;
  let cursor = Math.max(0, Math.min(from, total));
  while (cursor < total) {
    const record = records[cursor];
    await store.enqueueSync(record.address, record.updatedAt);
    cursor += 1;
    await onProgress?.({ cursor, total });
  }
  return { cursor, total };
}

// Resolves an address back to its current local state. A missing record is not an error:
// it is how a deletion is detected, since nothing in the queue records why an address
// changed and every delete path — sheet, session, or a wiped import — looks the same here.
export async function resolveRecord(store: WorkstrStore, address: string): Promise<RecordSnapshot | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  if (parsed.kind === 'sheet') {
    const sheet = (await store.listSheets()).find((candidate) => candidate.slug === parsed.id);
    return sheet && !sheet.is_temporary ? sheetRecord(sheet) : null;
  }
  if (parsed.kind === 'session') {
    const session = (await store.listSessions()).find((candidate) => candidate.uid === parsed.id);
    if (!session || session.id == null) return null;
    return sessionRecord(session, await store.listSessionSets(session.id));
  }
  const now = new Date().toISOString();
  if (parsed.kind === 'bodyweight') return bodyweightRecord(await store.listBody(Number.MAX_SAFE_INTEGER), now);
  if (parsed.kind === 'settings') return settingsRecord(await store.getSettings(), now);
  return manifestRecord(manifestEntries(await collectRecords(store)), now);
}
