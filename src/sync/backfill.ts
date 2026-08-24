import type { Session, SessionSet } from '../core/types';
import type { WorkstrStore } from '../db/store';
import { parseAddress } from './addresses';
import { bodyweightRecord, sessionRecord, settingsRecord, sheetRecord, type RecordSnapshot } from './records';

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

  // Workout history is not here any more: it travels in the append-only log, whose chunks
  // are packed at push time because which chunk an entry lands in is not known until then.
  // `seedJournal` is what puts existing sessions into it.

  const settings = await store.getSettings();
  // Body weight is not here either: like workout history it travels in the log, so two
  // devices that each logged a weigh-in offline both keep theirs.
  //
  // Settings has no modification time of its own, so the moment it was read is the honest
  // answer — it is never older than its newest change.
  records.push(settingsRecord(settings, new Date().toISOString()));
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
  // Per-session records are read-only compatibility for the brief V2 object-record era.
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

// Puts everything this device holds that belongs in a log into one, once, so a device with
// history but no journal starts sending it. Rows already journaled are left alone, which is
// what makes this safe to run again after an interrupted first pass.
export async function seedJournal(store: WorkstrStore): Promise<number> {
  let seeded = 0;

  const inLog = new Set((await store.listJournal('log')).map((row) => row.uid));
  for (const entry of await loadSessionEntries(store)) {
    const uid = String(entry.session.uid);
    // Rows marked backup_version 1 by the v5 migration are pre-cutover local-only history.
    if (entry.session.backup_version !== 2 || inLog.has(uid)) continue;
    await store.noteJournal('log', uid, sessionRecord(entry.session, entry.sets).updatedAt);
    seeded += 1;
  }

  const inBody = new Set((await store.listJournal('body')).map((row) => row.uid));
  const seededAt = new Date().toISOString();
  for (const entry of await store.listBody(Number.MAX_SAFE_INTEGER)) {
    const date = String(entry.date);
    if (inBody.has(date)) continue;
    await store.noteJournal('body', date, entry.updated_at || seededAt);
    seeded += 1;
  }

  return seeded;
}
