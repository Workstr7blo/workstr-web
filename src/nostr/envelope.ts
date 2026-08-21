// The binary envelope a private record travels in. Everything the decoder needs before it
// can decrypt lives in a cleartext header; everything that would leak training data lives
// inside the ciphertext.
//
// Layout of the bytes that get base64'd into an event's `content`:
//
//   byte  0     envelope version
//   byte  1     flags
//   bytes 2-13  96-bit AES-GCM nonce
//   bytes 14..  ciphertext, with its 128-bit authentication tag appended
//
// The version is deliberately outside the ciphertext. The old envelope carried it as a
// JSON field inside, which only worked because the decoder already knew how to decrypt;
// a decoder that has to choose a cipher or a compression scheme cannot read a field it
// can only reach afterwards.

export const ENVELOPE_VERSION = 2;

// Bit 0 says the plaintext was gzipped before encryption. The rest are reserved and must
// be zero: a reader that ignored an unknown bit would silently misread whatever the bit
// was introduced to describe.
export const FLAG_GZIP = 0x01;
const KNOWN_FLAGS = FLAG_GZIP;

export const NONCE_BYTES = 12;
export const HEADER_BYTES = 2 + NONCE_BYTES;

// Compression happens before encryption. Ciphertext is indistinguishable from random and
// does not compress; gzipping it would only make every record larger.
//
// A ceiling on the *decompressed* size, not the stored size. A record's ciphertext is
// bounded by what a relay will accept, but gzip turns a few kilobytes into gigabytes if it
// is built to, and no legitimate backup record is anywhere near this large.
export const MAX_PLAINTEXT_BYTES = 1024 * 1024;

// Binds a record to the identity and the address it was written for. AES-GCM authenticates
// this alongside the ciphertext, so a record moved to another address, or replayed under
// another identity, fails to open instead of decoding into something that looks valid.
//
// The Nostr signature already prevents an outsider doing either. What this catches is our
// own mistakes: a bug that writes one record's bytes to another record's address becomes a
// loud authentication failure rather than silent corruption.
const AAD_DOMAIN = 'workstr-backup-v1';

export interface EnvelopeContext {
  pubkey: string;
  address: string;
}

function additionalData(version: number, flags: number, context: EnvelopeContext): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(`${AAD_DOMAIN}|${context.pubkey}|${context.address}`);
  // The header bytes travel in the clear and are not otherwise covered. Flipping the gzip
  // bit on a record would survive decryption and surface as a corrupt-looking failure;
  // including them here makes that tampering fail authentication instead.
  const aad = new Uint8Array(2 + text.length);
  aad[0] = version;
  aad[1] = flags;
  aad.set(text, 2);
  return aad;
}

function concat(chunks: Uint8Array<ArrayBuffer>[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  // Chunked: `String.fromCharCode(...bytes)` on a large record blows the argument limit.
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    // Content came off an open relay, where anything at all can turn up. A string that is
    // not base64 is data, not an exception.
    return null;
  }
}

function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

// Built by hand rather than through `new Blob([bytes]).stream()`: Blob's stream method is
// missing from some runtimes the tests run in, and nothing here needs a Blob to begin with.
function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

// Drains a stream, refusing to buffer more than `limit`. Returns null the moment the limit
// is passed rather than after the fact, which is the only version of the check that
// actually bounds memory.
async function readAll(stream: ReadableStream<Uint8Array<ArrayBuffer>>, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return concat(chunks, total);
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  return readAll(streamOf(bytes).pipeThrough(new CompressionStream('gzip')), MAX_PLAINTEXT_BYTES);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!canCompress()) return null;
  return readAll(streamOf(bytes).pipeThrough(new DecompressionStream('gzip')), limit);
}

// Encrypts a record's plaintext into the base64 an event carries. `key` is the cached
// backup key, so this costs nothing at the signer: only the event signature does.
export async function sealEnvelope(key: CryptoKey, context: EnvelopeContext, plaintext: string): Promise<string> {
  const raw = new TextEncoder().encode(plaintext);

  let body = raw;
  let flags = 0;
  if (canCompress()) {
    const compressed = await gzip(raw);
    // Only when it actually helps. Gzip's header and trailer are ~20 bytes, so a tombstone
    // or a small settings record comes out larger than it went in.
    if (compressed && compressed.length < raw.length) {
      body = compressed;
      flags |= FLAG_GZIP;
    }
  }

  // Random, never a counter. One backup key is shared across every device on the account,
  // so counters would start from the same place on each of them and collide immediately —
  // and a repeated nonce under one AES-GCM key leaks the XOR of the two plaintexts and
  // makes forgery possible.
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(ENVELOPE_VERSION, flags, context) },
    key,
    body
  ));

  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  out[0] = ENVELOPE_VERSION;
  out[1] = flags;
  out.set(nonce, 2);
  out.set(ciphertext, HEADER_BYTES);
  return bytesToBase64(out);
}

// Returns null for anything unreadable — wrong key, tampered header, foreign envelope,
// a decompression bomb. Every one of those is an expected input from an open relay, and
// the caller counts them rather than treating them as exceptions.
export async function openEnvelope(key: CryptoKey, context: EnvelopeContext, content: string): Promise<string | null> {
  const bytes = base64ToBytes(content);
  if (!bytes || bytes.length <= HEADER_BYTES) return null;

  const version = bytes[0];
  const flags = bytes[1];
  if (version !== ENVELOPE_VERSION) return null;
  // A reserved bit that is set means this record was written by something that knows
  // something we do not. Skipping it is the only safe reading.
  if ((flags & ~KNOWN_FLAGS) !== 0) return null;

  const nonce = bytes.subarray(2, HEADER_BYTES);
  const ciphertext = bytes.subarray(HEADER_BYTES);

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: additionalData(version, flags, context) },
      key,
      ciphertext
    ));
  } catch {
    return null;
  }

  if ((flags & FLAG_GZIP) !== 0) {
    const inflated = await gunzip(body, MAX_PLAINTEXT_BYTES);
    if (!inflated) return null;
    return new TextDecoder().decode(inflated);
  }
  if (body.length > MAX_PLAINTEXT_BYTES) return null;
  return new TextDecoder().decode(body);
}
