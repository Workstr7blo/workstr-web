// Every private record is addressed by the `d` tag of a kind:30078 event. The relay's
// write policy accepts only this prefix, so an address that does not start with it is
// rejected on arrival — the prefix is a wire contract, not a naming convention.
export const RECORD_PREFIX = 'workstr:v2:';
export const LEGACY_RECORD_PREFIX = 'workstr:v1:';

// `log` is the append-only journal workout history travels in: a sealed chunk of entries
// that is never rewritten once full. `body` is the same mechanism for the body log.
// `session` is read but no longer written — one address per workout leaked an exact public
// count of how often the user trains, which is what the log replaces.
export type RecordKind = 'sheet' | 'session' | 'bodyweight' | 'settings' | 'key' | 'log' | 'body';

// Singletons hold the whole collection in one record; the rest are addressed per row.
const SINGLETON_KINDS: RecordKind[] = ['bodyweight', 'settings', 'key'];
const KEYED_KINDS: RecordKind[] = ['sheet', 'session'];
// Addressed by the device that wrote them and a sequence number within that device.
const CHUNKED_KINDS: RecordKind[] = ['log', 'body'];

export interface RecordAddress {
  kind: RecordKind;
  id?: string;
  // Set for `log` and `body` only.
  device?: string;
  seq?: number;
}

export const BODYWEIGHT_ADDRESS = `${RECORD_PREFIX}bodyweight`;
export const SETTINGS_ADDRESS = `${RECORD_PREFIX}settings`;

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

// A device only ever writes its own sequence, so two devices can append at the same moment
// without ever contending for one address — there is no coordination to get wrong, and no
// append can be silently overwritten by the other device's copy of the same chunk.
//
// The sequence is zero-padded so the addresses sort in the order they were written, which
// is what lets a reader walk a device's history without opening anything.
export const DEVICE_ID_CHARS = 8;
const SEQ_DIGITS = 6;

export function chunkAddress(kind: 'log' | 'body', device: string, seq: number): string {
  const cleaned = String(device || '').trim();
  if (!/^[0-9a-f]{1,16}$/.test(cleaned)) throw new Error(`${kind} address needs a hex device id`);
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`${kind} address needs a whole sequence number`);
  return `${RECORD_PREFIX}${kind}:${cleaned}:${String(seq).padStart(SEQ_DIGITS, '0')}`;
}

export function logAddress(device: string, seq: number): string {
  return chunkAddress('log', device, seq);
}

export function bodyAddress(device: string, seq: number): string {
  return chunkAddress('body', device, seq);
}

export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DEVICE_ID_CHARS / 2));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  if (CHUNKED_KINDS.includes(kind)) {
    const match = /^([0-9a-f]{1,16}):(\d{1,9})$/.exec(id);
    if (!match) return null;
    return { kind, id, device: match[1], seq: Number(match[2]) };
  }
  if (!KEYED_KINDS.includes(kind) || !id || id.includes(':')) return null;
  return { kind, id };
}
