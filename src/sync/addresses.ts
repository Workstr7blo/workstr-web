// Every private record is addressed by the `d` tag of a kind:30078 event. The relay's
// write policy accepts only this prefix, so an address that does not start with it is
// rejected on arrival — the prefix is a wire contract, not a naming convention.
export const RECORD_PREFIX = 'workstr:v2:';
export const LEGACY_RECORD_PREFIX = 'workstr:v1:';

// V2 workout history is object-level: one record per session UID, plus a tombstone at the
// same address when deleted. `sessions` remains for old helper/tests and future manual
// tooling; the normal V2 relay path does not read or write monthly bundles.
export type RecordKind = 'sheet' | 'session' | 'sessions' | 'bodyweight' | 'settings' | 'manifest';

// Singletons hold the whole collection in one record; the rest are addressed per row.
const SINGLETON_KINDS: RecordKind[] = ['bodyweight', 'settings', 'manifest'];
const KEYED_KINDS: RecordKind[] = ['sheet', 'session', 'sessions'];

export interface RecordAddress {
  kind: RecordKind;
  id?: string;
}

export const BODYWEIGHT_ADDRESS = `${RECORD_PREFIX}bodyweight`;
export const SETTINGS_ADDRESS = `${RECORD_PREFIX}settings`;
export const MANIFEST_ADDRESS = `${RECORD_PREFIX}manifest`;

// A `d` tag is cleartext on an open relay, so an id must never carry anything private.
// Slugs and uuids are already opaque; this only guards the delimiter.
function assertId(kind: RecordKind, id: string): string {
  const trimmed = String(id || '').trim();
  if (!trimmed) throw new Error(`${kind} address needs an id`);
  if (trimmed.includes(':')) throw new Error(`${kind} id cannot contain ":"`);
  return trimmed;
}

export function sheetAddress(slug: string): string {
  return `${RECORD_PREFIX}sheet:${assertId('sheet', slug)}`;
}

export function sessionAddress(uid: string): string {
  return `${RECORD_PREFIX}session:${assertId('session', uid)}`;
}

// Sessions are bundled by the month they were trained in, which is the one grouping that
// is both stable and mostly immutable: a finished month never changes again, so only the
// current one is rewritten as the user trains. A `YYYY-MM` in a cleartext `d` tag says no
// more than the relay already learns from the event's own timestamp.
export const UNDATED_SESSION_MONTH = '0000-00';

export function sessionMonth(startedAt?: string | null, finishedAt?: string | null): string {
  const month = String(startedAt || finishedAt || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : UNDATED_SESSION_MONTH;
}

// A month that will not fit in one event is split into parts. Part 1 keeps the plain
// month address so the common case has no suffix, and packing is chronological so a new
// session lands at the end and the earlier parts stay byte-identical.
export function sessionsAddress(month: string, part = 1): string {
  const id = part > 1 ? `${month}-p${part}` : month;
  return `${RECORD_PREFIX}sessions:${assertId('sessions', id)}`;
}

export function parseSessionsId(id: string): { month: string; part: number } {
  const match = /^(\d{4}-\d{2}|0000-00)-p(\d+)$/.exec(id);
  return match ? { month: match[1], part: Number(match[2]) } : { month: id, part: 1 };
}

export function isRecordAddress(address: string): boolean {
  return parseAddress(address) !== null;
}

export function isLegacyRecordAddress(address: string): boolean {
  return typeof address === 'string' && address.startsWith(LEGACY_RECORD_PREFIX);
}

// Returns null rather than throwing: this parses events that arrived from an open relay,
// where anything at all can turn up, and a malformed address is data, not an exception.
export function parseAddress(address: string): RecordAddress | null {
  if (typeof address !== 'string' || !address.startsWith(RECORD_PREFIX)) return null;
  const rest = address.slice(RECORD_PREFIX.length);
  if (!rest) return null;
  const separator = rest.indexOf(':');
  if (separator === -1) {
    const kind = rest as RecordKind;
    return SINGLETON_KINDS.includes(kind) ? { kind } : null;
  }
  const kind = rest.slice(0, separator) as RecordKind;
  const id = rest.slice(separator + 1);
  if (!KEYED_KINDS.includes(kind) || !id || id.includes(':')) return null;
  return { kind, id };
}
