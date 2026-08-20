// Every private record is addressed by the `d` tag of a kind:30078 event. The relay's
// write policy accepts only this prefix, so an address that does not start with it is
// rejected on arrival — the prefix is a wire contract, not a naming convention.
export const RECORD_PREFIX = 'workstr:v1:';

export type RecordKind = 'sheet' | 'session' | 'bodyweight' | 'settings' | 'manifest';

// Singletons hold the whole collection in one record; the rest are addressed per row.
const SINGLETON_KINDS: RecordKind[] = ['bodyweight', 'settings', 'manifest'];
const KEYED_KINDS: RecordKind[] = ['sheet', 'session'];

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

export function isRecordAddress(address: string): boolean {
  return parseAddress(address) !== null;
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
