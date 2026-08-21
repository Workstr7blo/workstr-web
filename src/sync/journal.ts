import type { WorkstrStore } from '../db/store';
import type { JournalRow } from '../db/sync-store';
import type { Signer } from '../signer/types';
import type { PrivateRecord, RecordCipher } from '../nostr/codecs30078';
import { encodePrivateRecord } from '../nostr/codecs30078';
import { chunkAddress } from './addresses';
import { MAX_CHUNK_CONTENT_BYTES, packChunks, replayChunks, supersededRatio, type ChunkPayload, type ChunkSource, type LogEntry } from './chunks';
import { publishRecord, type PublishOutcome } from './relay';
import { sessionRecord } from './records';
import type { BodyWeightEntry } from '../core/types';
import { loadSessionEntries, type SessionEntry } from './backfill';

export interface JournalPushSummary {
  published: number;
  skipped: number;
  rejected: PublishOutcome[];
  failed: PublishOutcome[];
}

export interface JournalPushOptions {
  onProgress?: (done: number, total: number) => void;
  renewSigner?: () => Promise<Signer | null>;
  // Defaults to the real budget. Overridden by tests so sealing can be exercised without
  // logging the hundred workouts it takes to fill a chunk at the shipped size.
  budgetBytes?: number;
}

interface Resolvable {
  sessions: Map<string, SessionEntry>;
  body: Map<string, BodyWeightEntry>;
}

// Turns a journal row into the entry that actually goes in a chunk. A row whose subject is
// gone locally becomes a deletion rather than being dropped: a reader has no other way to
// learn that it went.
function entryFor(row: JournalRow, held: Resolvable): LogEntry {
  const gone = { uid: row.uid, updatedAt: row.updated_at, deleted: true };
  if (row.deleted) return gone;

  if (row.kind === 'body') {
    const entry = held.body.get(row.uid);
    if (!entry) return gone;
    // The autoincrement key means nothing on another device, so it never travels.
    const { id: _id, ...payload } = entry;
    return { uid: row.uid, updatedAt: entry.updated_at || row.updated_at, payload };
  }

  const session = held.sessions.get(row.uid);
  if (!session) return gone;
  const record = sessionRecord(session.session, session.sets);
  return { uid: row.uid, updatedAt: record.updatedAt, payload: record.payload };
}

// The newest thing in a chunk, which is what decides whether the relay's copy is stale.
function chunkUpdatedAt(entries: LogEntry[]): string {
  return entries.reduce((latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest), entries[0]?.updatedAt || '');
}

// Publishes this device's pending log entries.
//
// Only the tail is ever rewritten. Rows already assigned to the open chunk are packed
// again alongside the new ones, because republishing an addressable event replaces it and
// a partial rewrite would lose the entries it left out. Everything before the tail is
// sealed and is not even read.
export async function pushJournal(
  store: WorkstrStore,
  signer: Signer,
  cipher: RecordCipher,
  relayUrl: string,
  kind: 'log' | 'body' = 'log',
  options: JournalPushOptions = {}
): Promise<JournalPushSummary> {
  const settings = await store.getSettings();
  const device = settings.backup?.device;
  if (!device) throw new Error('this device has no id, so it cannot write to the log');

  const rows = await store.listJournal(kind);
  const pending = rows.filter((row) => row.seq === null);
  if (pending.length === 0) return { published: 0, skipped: 0, rejected: [], failed: [] };

  const openSeq = (kind === 'body' ? settings.backup?.bodyOpenSeq : settings.backup?.logOpenSeq) ?? 0;
  // The tail's existing rows come first so the chunk stays chronological: entries already
  // on the relay keep their place, and only the end of the chunk grows.
  const tail = rows.filter((row) => row.seq === openSeq);
  const packing = [...tail, ...pending];

  // Only the side this pass is actually publishing is read.
  const held: Resolvable = {
    sessions: kind === 'log'
      ? new Map((await loadSessionEntries(store)).map((entry) => [String(entry.session.uid), entry]))
      : new Map(),
    body: kind === 'body'
      ? new Map((await store.listBody(Number.MAX_SAFE_INTEGER)).map((entry) => [String(entry.date), entry]))
      : new Map()
  };
  const entries = packing.map((row) => entryFor(row, held));

  const measure = async (candidate: LogEntry[]): Promise<number> => {
    const payload: ChunkPayload = { device, seq: openSeq, entries: candidate };
    const event = await encodePrivateRecord(cipher, {
      address: chunkAddress(kind, device, openSeq),
      updatedAt: chunkUpdatedAt(candidate),
      payload
    });
    return event.content.length;
  };

  const packed = await packChunks(entries, measure, options.budgetBytes ?? MAX_CHUNK_CONTENT_BYTES);
  const seen = new Map((await store.listSeen()).map((entry) => [entry.address, entry]));

  const summary: JournalPushSummary = { published: 0, skipped: 0, rejected: [], failed: [] };
  let active = signer;
  let cursor = 0;

  for (const [index, part] of packed.entries()) {
    const seq = openSeq + index;
    const address = chunkAddress(kind, device, seq);
    const updatedAt = chunkUpdatedAt(part.entries);
    // The rows this chunk is made of, in the same order they were packed.
    const rowsHere = packing.slice(cursor, cursor + part.entries.length);
    cursor += part.entries.length;

    options.onProgress?.(index, packed.length);

    // Already on the relay unchanged. A sealed chunk reaches this on every pass and must
    // never cost a signature again — that is the whole point of sealing it.
    if (seen.get(address)?.updated_at === updatedAt) {
      summary.skipped += 1;
      await store.assignJournalSeq(rowsHere.map((row) => row.id as number), seq);
      continue;
    }

    const record: PrivateRecord = { address, updatedAt, payload: { device, seq, entries: part.entries } as ChunkPayload };
    let outcome = await publishRecord(active, cipher, relayUrl, record);
    if (!outcome.accepted && outcome.failure === 'signer' && options.renewSigner) {
      const renewed = await options.renewSigner();
      if (renewed) {
        active = renewed;
        outcome = await publishRecord(active, cipher, relayUrl, record);
      }
    }

    if (!outcome.accepted) {
      if (outcome.failure === 'policy') summary.rejected.push(outcome); else summary.failed.push(outcome);
      // Stop at the first chunk that did not land. The rows keep their null seq, so the
      // next pass packs them again from here rather than leaving a gap in the sequence.
      break;
    }

    if (outcome.eventId && outcome.createdAt) await store.noteSeen(address, outcome.eventId, outcome.createdAt, updatedAt);
    await store.assignJournalSeq(rowsHere.map((row) => row.id as number), seq);
    // Only once the chunk it belongs to is actually on the relay. Moving the open sequence
    // before that would seal a chunk the relay never received.
    await store.saveBackupState(kind === 'body' ? { bodyOpenSeq: seq } : { logOpenSeq: seq });
    summary.published += 1;
  }

  options.onProgress?.(packed.length, packed.length);
  return summary;
}

// How much of a sealed chunk has to be dead before it is worth rewriting. Garbage costs
// storage and a little restore time, never correctness, so the bar is deliberately high:
// rewriting a sealed chunk is the one operation that touches finished history.
export const COMPACT_THRESHOLD = 0.5;

export interface CompactionSummary {
  rewritten: number;
  reclaimed: number;
}

// Which journal row is the live one for each uid. Derived from the journal rather than from
// the relay: a device knows exactly what it put in its own chunks, so deciding what is dead
// costs no round trip and no decrypt.
function liveRows(rows: JournalRow[]): Map<string, JournalRow> {
  const live = new Map<string, JournalRow>();
  for (const row of rows) {
    const held = live.get(row.uid);
    if (held && (held.updated_at > row.updated_at || (held.updated_at === row.updated_at && (held.id ?? 0) >= (row.id ?? 0)))) continue;
    live.set(row.uid, row);
  }
  return live;
}

// Rewrites this device's own sealed chunks that later entries have mostly replaced.
//
// Only ever its own. Another device's sequence may be mid-append from that device's point
// of view, and rewriting it would race an append this device cannot see. Per-device
// sequences are what make the safe case identifiable at all.
//
// The tail is excluded too: it is still being appended to, so it is not finished history.
export async function compactJournal(
  store: WorkstrStore,
  signer: Signer,
  cipher: RecordCipher,
  relayUrl: string,
  kind: 'log' | 'body' = 'log'
): Promise<CompactionSummary> {
  const settings = await store.getSettings();
  const device = settings.backup?.device;
  const openSeq = (kind === 'body' ? settings.backup?.bodyOpenSeq : settings.backup?.logOpenSeq) ?? 0;
  const summary: CompactionSummary = { rewritten: 0, reclaimed: 0 };
  if (!device) return summary;

  const rows = await store.listJournal(kind);
  const live = liveRows(rows);

  const sealed = new Map<number, JournalRow[]>();
  for (const row of rows) {
    if (row.seq === null || row.seq >= openSeq) continue;
    const bucket = sealed.get(row.seq);
    if (bucket) bucket.push(row); else sealed.set(row.seq, [row]);
  }
  if (sealed.size === 0) return summary;

  const held: Resolvable = {
    sessions: kind === 'log'
      ? new Map((await loadSessionEntries(store)).map((entry) => [String(entry.session.uid), entry]))
      : new Map(),
    body: kind === 'body'
      ? new Map((await store.listBody(Number.MAX_SAFE_INTEGER)).map((entry) => [String(entry.date), entry]))
      : new Map()
  };

  for (const [seq, chunkRows] of [...sealed].sort((a, b) => a[0] - b[0])) {
    const kept = chunkRows.filter((row) => live.get(row.uid) === row);
    if (chunkRows.length === 0 || (chunkRows.length - kept.length) / chunkRows.length < COMPACT_THRESHOLD) continue;

    const address = chunkAddress(kind, device, seq);
    const entries = kept.map((row) => entryFor(row, held));
    const updatedAt = chunkUpdatedAt(entries) || chunkRows[chunkRows.length - 1].updated_at;
    const record: PrivateRecord = { address, updatedAt, payload: { device, seq, entries } as ChunkPayload };

    const outcome = await publishRecord(signer, cipher, relayUrl, record);
    // Best effort: a chunk that did not rewrite is still correct, just larger than it
    // needs to be, so a failure here must never fail the pass.
    if (!outcome.accepted) break;
    if (outcome.eventId && outcome.createdAt) await store.noteSeen(address, outcome.eventId, outcome.createdAt, updatedAt);
    // The rows it dropped are gone from this chunk; the entries live on in the later chunk
    // that superseded them, so the journal keeps them and only their chunk changes.
    await store.dropJournalRows(chunkRows.filter((row) => !kept.includes(row)).map((row) => row.id as number));
    summary.rewritten += 1;
    summary.reclaimed += chunkRows.length - kept.length;
  }

  return summary;
}
