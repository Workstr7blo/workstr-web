import type { Session, SessionSet } from '../core/types';
import type { WorkstrStore } from '../db/store';
import { parseAddress, parseSessionsId, sessionMonth } from './addresses';
import { bodyweightRecord, sessionRecord, sessionsBundleRecord, sessionsBundleRecords, settingsRecord, sheetRecord, type RecordSnapshot } from './records';

export interface BackfillProgress {
  cursor: number;
  total: number;
}

export interface SessionEntry {
  session: Session;
  sets: SessionSet[];
}

// Every session with its sets, read once. A push pass resolves many addresses in a row,
// and re-reading the session table per address turned a long history into quadratic work
// before a single byte was encrypted.
export async function loadSessionEntries(store: WorkstrStore): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  for (const session of await store.listSessions()) {
    if (!session.uid || session.id == null) continue;
    entries.push({ session, sets: await store.listSessionSets(session.id) });
  }
  return entries;
}

export function groupSessionsByMonth(entries: SessionEntry[]): Map<string, SessionEntry[]> {
  const months = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    const month = sessionMonth(entry.session.started_at, entry.session.finished_at);
    const bucket = months.get(month);
    if (bucket) bucket.push(entry); else months.set(month, [entry]);
  }
  return months;
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

  // Existing V2-era sessions are safe to enqueue individually. Rows marked backup_version=1
  // by the v5 migration are pre-cutover local-only history and are never uploaded.
  const sessionEntries = await loadSessionEntries(store);
  for (const entry of sessionEntries.filter((item) => item.session.backup_version === 2)) {
    records.push(sessionRecord(entry.session, entry.sets));
  }

  const settings = await store.getSettings();
  const body = await store.listBody(Number.MAX_SAFE_INTEGER);
  // Collections have no modification time of their own, so the moment they were read is
  // the honest answer — it is never older than their newest change.
  const collectedAt = new Date().toISOString();
  records.push(bodyweightRecord(body, collectedAt));
  records.push(settingsRecord(settings, collectedAt));
  return records;
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

// Every record a month actually publishes as. The queue names the month, not its parts:
// how a month splits depends on how much was trained in it, so a queue full of part
// addresses would go stale the moment a session moved between parts.
export async function resolveMonthRecords(store: WorkstrStore, month: string, entries?: SessionEntry[]): Promise<RecordSnapshot[]> {
  const loaded = entries ?? await loadSessionEntries(store);
  const inMonth = loaded.filter((entry) => sessionMonth(entry.session.started_at, entry.session.finished_at) === month);
  return inMonth.length ? sessionsBundleRecords(month, inMonth) : [];
}

// Resolves an address back to its current local state. A missing record is not an error:
// it is how a deletion is detected, since nothing in the queue records why an address
// changed and every delete path — sheet, session, or a wiped import — looks the same here.
//
// `entries` is an optional pre-read of the session table. A push pass passes one in so a
// hundred addresses do not each re-read every session.
export async function resolveRecord(store: WorkstrStore, address: string, entries?: SessionEntry[]): Promise<RecordSnapshot | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  if (parsed.kind === 'sheet') {
    const sheet = (await store.listSheets()).find((candidate) => candidate.slug === parsed.id);
    return sheet && !sheet.is_temporary ? sheetRecord(sheet) : null;
  }
  if (parsed.kind === 'sessions') {
    const { month } = parseSessionsId(String(parsed.id));
    const loaded = entries ?? await loadSessionEntries(store);
    const inMonth = loaded.filter((entry) => sessionMonth(entry.session.started_at, entry.session.finished_at) === month);
    // An emptied month resolves to nothing, which push turns into a tombstone. The
    // sessions it held are deleted one by one through their own addresses, so no reader
    // depends on this tombstone to lose data it should still have.
    return inMonth.length ? sessionsBundleRecord(month, inMonth) : null;
  }
  // A per-session address is only ever queued by a deletion now that sessions travel in
  // month bundles, but a relay written by an earlier version is still full of them and a
  // queue left over from one may still hold them.
  if (parsed.kind === 'session') {
    const loaded = entries ?? await loadSessionEntries(store);
    const found = loaded.find((entry) => entry.session.uid === parsed.id);
    return found ? sessionRecord(found.session, found.sets) : null;
  }
  const now = new Date().toISOString();
  if (parsed.kind === 'bodyweight') return bodyweightRecord(await store.listBody(Number.MAX_SAFE_INTEGER), now);
  if (parsed.kind === 'settings') return settingsRecord(await store.getSettings(), now);
  // The backup key is written by the key bootstrap, never by the queue.
  return null;
}
