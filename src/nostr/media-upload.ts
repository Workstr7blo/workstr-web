import type { Signer, UnsignedNostrEvent } from '../signer/types';
import { withTimeout } from './replaceable-event';

// Profile photos are hosted by a NIP-96 media server, never stored in the profile event:
// `kind:0` carries only the returned URL. Everything the server can tell us - where to upload,
// how large a file it takes, whether it wants NIP-98 authorization - is read from its
// discovery document rather than assumed, so a server that moves its API keeps working.
//
// Authorization is a NIP-98 `kind:27235` event signed by the active Workstr signer. The only
// thing that leaves the device is that signed event and the image: the signer never exposes
// a key, and nothing here asks it for one.
export const DEFAULT_MEDIA_SERVER = 'https://nostr.build';
export const NIP98_KIND = 27235;

const DISCOVERY_PATH = '/.well-known/nostr/nip96.json';
const DISCOVERY_TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000;
const SIGN_TIMEOUT_MS = 120000;
const PROCESSING_POLLS = 10;
const PROCESSING_INTERVAL_MS = 1500;

export interface MediaServer {
  apiUrl: string;
  maxBytes?: number;
  contentTypes?: string[];
}

export interface MediaUploadOptions {
  server?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export class MediaUploadError extends Error {}

function httpsUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function getJson(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number, what: string): Promise<Record<string, unknown>> {
  const response = await withTimeout(fetcher(url, init), timeoutMs, `${what} timed out`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MediaUploadError(`${what} returned an unreadable answer (HTTP ${response.status})`);
  }
  if (!body || typeof body !== 'object') throw new MediaUploadError(`${what} returned an unreadable answer`);
  const record = body as Record<string, unknown>;
  if (!response.ok) throw new MediaUploadError(typeof record.message === 'string' && record.message ? record.message : `${what} failed (HTTP ${response.status})`);
  return record;
}

/** Reads the server's NIP-96 document, following one `delegated_to_url` hop. */
export async function discoverMediaServer(server = DEFAULT_MEDIA_SERVER, options: MediaUploadOptions = {}): Promise<MediaServer> {
  const fetcher = options.fetch || fetch;
  let origin = server;
  for (let hop = 0; hop < 2; hop += 1) {
    const doc = await getJson(fetcher, new URL(DISCOVERY_PATH, origin).toString(), { signal: options.signal }, DISCOVERY_TIMEOUT_MS, 'The media server');
    const delegated = httpsUrl(doc.delegated_to_url);
    if (delegated && hop === 0) { origin = delegated; continue; }
    const apiUrl = httpsUrl(doc.api_url, origin);
    if (!apiUrl) throw new MediaUploadError('The media server does not advertise an upload address');
    const plans = (doc.plans && typeof doc.plans === 'object' ? doc.plans : {}) as Record<string, Record<string, unknown> | undefined>;
    const maxBytes = Number(plans.free?.max_byte_size);
    const contentTypes = Array.isArray(doc.content_types) ? doc.content_types.filter((type): type is string => typeof type === 'string') : undefined;
    return { apiUrl, maxBytes: maxBytes > 0 ? maxBytes : undefined, contentTypes: contentTypes?.length ? contentTypes : undefined };
  }
  throw new MediaUploadError('The media server delegates its uploads too many times');
}

function acceptsType(server: MediaServer, type: string): boolean {
  if (!server.contentTypes) return true;
  return server.contentTypes.some((allowed) => allowed === type || (allowed.endsWith('/*') && type.startsWith(allowed.slice(0, -1))));
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export function nip98Event(url: string, method: string): UnsignedNostrEvent {
  return { kind: NIP98_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', method]], content: '' };
}

/** The `Authorization` header value for one request, signed by the active signer. */
export async function nip98Authorization(signer: Signer, url: string, method: string): Promise<string> {
  const signed = await withTimeout(signer.signEvent(nip98Event(url, method)), SIGN_TIMEOUT_MS, 'signer approval timed out');
  return `Nostr ${base64(JSON.stringify(signed))}`;
}

// The hosted URL lives in the response's NIP-94 tags. A server may still be transforming the
// file and hand back a `processing_url` to poll instead.
function uploadedUrl(body: Record<string, unknown>): string | null {
  const event = body.nip94_event as { tags?: unknown } | undefined;
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  const tag = tags.find((item): item is string[] => Array.isArray(item) && item[0] === 'url');
  return httpsUrl(tag?.[1]);
}

/**
 * Uploads one image and returns its hosted `https://` URL. Throws `MediaUploadError` with a
 * reader-safe message for anything short of a usable URL.
 */
export async function uploadProfileImage(file: File, signer: Signer, options: MediaUploadOptions = {}): Promise<string> {
  if (!file.type.startsWith('image/')) throw new MediaUploadError('Choose an image file');
  const fetcher = options.fetch || fetch;
  const wait = options.wait || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const server = await discoverMediaServer(options.server, options);
  if (!acceptsType(server, file.type)) throw new MediaUploadError('The media server does not accept this kind of image');
  if (server.maxBytes && file.size > server.maxBytes) {
    throw new MediaUploadError(`That image is too large. The media server accepts up to ${Math.floor(server.maxBytes / 1048576)} MB.`);
  }
  const form = new FormData();
  form.append('file', file, file.name || 'avatar');
  form.append('size', String(file.size));
  form.append('content_type', file.type);
  const authorization = await nip98Authorization(signer, server.apiUrl, 'POST');
  let body = await getJson(fetcher, server.apiUrl, { method: 'POST', body: form, headers: { Authorization: authorization }, signal: options.signal }, options.timeoutMs ?? UPLOAD_TIMEOUT_MS, 'The upload');
  for (let poll = 0; poll < PROCESSING_POLLS && body.status === 'processing'; poll += 1) {
    const next = httpsUrl(body.processing_url, server.apiUrl);
    if (!next || uploadedUrl(body)) break;
    await wait(PROCESSING_INTERVAL_MS);
    body = await getJson(fetcher, next, { signal: options.signal }, DISCOVERY_TIMEOUT_MS, 'The upload');
  }
  if (body.status === 'error') throw new MediaUploadError(typeof body.message === 'string' && body.message ? body.message : 'The media server rejected the image');
  const url = uploadedUrl(body);
  if (!url) throw new MediaUploadError('The media server did not return an image address');
  return url;
}
