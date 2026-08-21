// The append-only log workout history travels in.
//
// A chunk holds a run of entries and is published at one address. Once it is full it is
// sealed and never rewritten again: an edit or a deletion of something inside it appends a
// fresh entry to the tail instead. That is what a month bundle could never do — a bundle
// that stopped mentioning a session read as no news rather than as a deletion, and a
// session logged late rewrote a large record that was already finished history.
//
// Reading is a replay: every entry for a uid is considered and the newest one wins. Nothing
// depends on the order chunks arrive in, which is what lets two devices append at once.

export interface LogEntry {
  uid: string;
  updatedAt: string;
  // A deletion. It keeps the uid and drops the payload, because a reader has to be told
  // that something was removed — silence cannot express it.
  deleted?: boolean;
  payload?: unknown;
}

export interface ChunkPayload {
  device: string;
  seq: number;
  entries: LogEntry[];
}

// Where a chunk came from, so a replay can break a tie the same way on every device.
export interface ChunkSource extends ChunkPayload {
  address: string;
}

export function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return typeof entry.uid === 'string' && entry.uid.length > 0
    && typeof entry.updatedAt === 'string' && entry.updatedAt.length > 0;
}

// Two entries for one uid, ordered. `updatedAt` decides it; the rest only exists so that
// two devices that wrote at the same instant still agree on which entry won, rather than
// each keeping whichever it happened to read last.
export function compareEntries(
  a: { updatedAt: string; device: string; seq: number; index: number },
  b: { updatedAt: string; device: string; seq: number; index: number }
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
  if (a.device !== b.device) return a.device < b.device ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.index - b.index;
}

// The state the log describes: the winning entry per uid, deletions included, so a caller
// can tell "removed" from "never mentioned".
export function replayChunks(chunks: ChunkSource[]): Map<string, LogEntry> {
  const winners = new Map<string, { entry: LogEntry; order: { updatedAt: string; device: string; seq: number; index: number } }>();
  for (const chunk of chunks) {
    for (const [index, entry] of (chunk.entries || []).entries()) {
      if (!isLogEntry(entry)) continue;
      const order = { updatedAt: entry.updatedAt, device: chunk.device, seq: chunk.seq, index };
      const held = winners.get(entry.uid);
      if (held && compareEntries(order, held.order) <= 0) continue;
      winners.set(entry.uid, { entry, order });
    }
  }
  return new Map([...winners].map(([uid, held]) => [uid, held.entry]));
}

// How much of a chunk is entries a later one has already superseded. Compaction is the only
// reason to rewrite a sealed chunk, and it is only ever safe on a device's own sequence.
export function supersededRatio(chunk: ChunkSource, winners: Map<string, LogEntry>): number {
  const entries = chunk.entries || [];
  if (entries.length === 0) return 0;
  const dead = entries.filter((entry) => winners.get(entry.uid) !== entry).length;
  return dead / entries.length;
}

// How much sealed event content one chunk may carry.
//
// The ceiling is the NIP-46 signing request: the signer is sent the whole event, NIP-44
// encrypted into an event of its own, so the content is inflated roughly 1.4x by the time
// it reaches the signer's relay. 12 KB of content lands near 17 KB against a 32 KB ceiling.
//
// Measured on realistic training data that is around 36 workouts per chunk, so a year of
// training is six records rather than two hundred. The remaining headroom is deliberate:
// the cost of one more chunk is one more signature, and the cost of overshooting is a
// backup no signer will sign at all.
export const MAX_CHUNK_CONTENT_BYTES = 12000;

export interface PackedChunk {
  entries: LogEntry[];
  bytes: number;
}

// Fills chunks up to `budget` and starts a new one when the next entry would not fit.
//
// `measure` is the real sealed size rather than an estimate of it: compression varies with
// how the JSON happens to repeat, and the cost of guessing high is a record no signer will
// sign. Measuring is local and cheap now that nothing here touches the signer.
export async function packChunks(
  entries: LogEntry[],
  measure: (entries: LogEntry[]) => Promise<number>,
  budget: number
): Promise<PackedChunk[]> {
  const packed: PackedChunk[] = [];
  let current: LogEntry[] = [];
  let bytes = 0;

  for (const entry of entries) {
    const candidate = [...current, entry];
    const size = await measure(candidate);
    if (size <= budget) {
      current = candidate;
      bytes = size;
      continue;
    }
    // One entry that does not fit on its own still gets a chunk. An oversized record is a
    // visible rejection at the relay; dropping it silently is the outcome a backup may
    // never produce.
    if (current.length === 0) {
      packed.push({ entries: candidate, bytes: size });
      current = [];
      bytes = 0;
      continue;
    }
    packed.push({ entries: current, bytes });
    current = [entry];
    bytes = await measure(current);
  }

  if (current.length > 0) packed.push({ entries: current, bytes });
  return packed;
}
