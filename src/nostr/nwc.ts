// Nostr Wallet Connect (NIP-47) parsing and safe error taxonomy.
//
// The connection string is a spending credential: anyone holding it can pay
// invoices up to the wallet's budget. It therefore follows the same rules as
// the account key: local-only storage (never synced, never exported), never
// logged, never sent anywhere except the relays named inside the string.
// Display is masked via `maskNwcConnectionString`.
//
// The protocol client operations live in `nwc-client.ts` so this module can
// stay focused on ingestion, masking, and shared typed errors.

export interface NwcConnection {
  /** Wallet service pubkey (64-hex). */
  walletPubkey: string;
  /** Client secret key (hex) used to sign/encrypt NWC requests. */
  secret: string;
  /** Relays embedded in the connection string — the only relays NWC events may touch. */
  relays: string[];
  /** Optional lud16 of the wallet, for display. */
  lud16?: string;
  /** Optional URI/service expiry timestamp, seconds since epoch. */
  expiresAt?: number;
}

export type NwcErrorCode =
  | 'invalid_format'
  | 'expired_connection'
  | 'rejected_unauthorized'
  | 'unreachable_service'
  | 'timeout'
  | 'payment_failure'
  | 'unknown_failure'
  | 'unsupported_method'
  | 'invalid_request'
  | 'invoice_too_large';

export type NwcFailureKind =
  | 'invalid_format'
  | 'expired_connection'
  | 'rejected_unauthorized'
  | 'unreachable_service'
  | 'payment_failure'
  | 'unknown_failure';

export type NwcResult<T> = { ok: true; value: T } | { ok: false; error: NwcError };

const SECRET_QUERY_KEYS = new Set(['secret', 'token', 'privatekey', 'private_key', 'nsec']);
const HEX_SECRET_RE = /\b[0-9a-f]{64}\b/gi;
const NSEC_RE = /nsec1[02-9ac-hj-np-z]+/gi;
const SECRET_PARAM_RE = /(^|[?&\s])((?:secret|token|private_?key|nsec)=)[^&\s<>'"]+/gi;

// Structured error so the UI can pick copy without string-matching, while
// `message` is always log/UI-safe: raw NWC strings, secret params, hex private
// keys, nsecs, and token-like query parameters are redacted at construction.
export class NwcError extends Error {
  readonly code: NwcErrorCode;
  readonly kind: NwcFailureKind;
  readonly causeCode?: string;
  constructor(code: NwcErrorCode, message: string, options: { kind?: NwcFailureKind; causeCode?: string } = {}) {
    super(redactNwcSecrets(message));
    this.name = 'NwcError';
    this.code = code;
    this.kind = options.kind ?? failureKindForCode(code);
    this.causeCode = options.causeCode ? redactNwcSecrets(options.causeCode) : undefined;
  }

  toJSON(): { name: string; code: NwcErrorCode; kind: NwcFailureKind; message: string; causeCode?: string } {
    return { name: this.name, code: this.code, kind: this.kind, message: this.message, causeCode: this.causeCode };
  }
}

function failureKindForCode(code: NwcErrorCode): NwcFailureKind {
  switch (code) {
    case 'invalid_format':
    case 'expired_connection':
    case 'rejected_unauthorized':
    case 'unreachable_service':
    case 'payment_failure':
    case 'unknown_failure':
      return code;
    case 'timeout':
      return 'unreachable_service';
    case 'unsupported_method':
    case 'invalid_request':
      return 'rejected_unauthorized';
    case 'invoice_too_large':
      return 'payment_failure';
  }
}

export function redactNwcSecrets(value: string): string {
  let redacted = value;
  redacted = redacted.replace(/nostr\+walletconnect:\/\/[^\s<>'"]+/gi, (match) => redactNwcUri(match));
  redacted = redacted.replace(SECRET_PARAM_RE, '$1$2[REDACTED]');
  redacted = redacted.replace(NSEC_RE, 'nsec1[REDACTED]');
  redacted = redacted.replace(HEX_SECRET_RE, '[REDACTED_HEX]');
  return redacted;
}

export function redactNwcUri(input: string): string {
  const value = String(input).trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'nostr+walletconnect:') return redactNwcSecretsWithoutUri(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString().replace(/%5BREDACTED%5D/g, '[REDACTED]');
  } catch {
    return redactNwcSecretsWithoutUri(value);
  }
}

export function logSafeNwcConnection(connection: NwcConnection): Omit<NwcConnection, 'secret'> & { secret: '[REDACTED]' } {
  return { ...connection, secret: '[REDACTED]' };
}

function redactNwcSecretsWithoutUri(value: string): string {
  return value
    .replace(SECRET_PARAM_RE, '$1$2[REDACTED]')
    .replace(NSEC_RE, 'nsec1[REDACTED]')
    .replace(HEX_SECRET_RE, '[REDACTED_HEX]');
}

// Strict ingestion: rejects lud16 strings, plain URLs, and malformed URIs so a
// paste into the wrong field fails loudly instead of silently storing junk.
export function parseNwcConnectionString(input: string): NwcConnection {
  const value = input.trim();
  if (!value) throw new NwcError('invalid_format', 'Paste an NWC connection string (nostr+walletconnect://…).');
  if (value.includes('@') && !value.startsWith('nostr+walletconnect://')) {
    throw new NwcError('invalid_format', 'That looks like a Lightning address. Paste the NWC connection string from your wallet instead.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NwcError('invalid_format', 'Connection string must start with nostr+walletconnect://');
  }
  if (url.protocol !== 'nostr+walletconnect:') {
    throw new NwcError('invalid_format', 'Connection string must start with nostr+walletconnect://');
  }
  const walletPubkey = decodeURIComponent(url.hostname || url.pathname.replace(/^\/\//, '')).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new NwcError('invalid_format', 'Connection string has no valid wallet pubkey.');
  }
  const secret = url.searchParams.get('secret')?.toLowerCase() ?? '';
  if (!secret) throw new NwcError('invalid_format', 'Connection string is missing the secret parameter.');
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new NwcError('invalid_format', 'Connection string secret is not a valid key.');
  }
  const relays = url.searchParams.getAll('relay').map((relay) => relay.trim()).filter(Boolean);
  if (relays.length === 0) throw new NwcError('invalid_format', 'Connection string names no relay.');
  if (relays.some((relay) => !/^wss?:\/\//i.test(relay))) {
    throw new NwcError('invalid_format', 'Connection string relay must be a websocket URL.');
  }
  const expiresAt = parseNwcExpiry(url.searchParams);
  if (expiresAt !== undefined && expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new NwcError('expired_connection', 'This wallet connection has expired. Create a new connection string in your wallet.');
  }
  const lud16 = url.searchParams.get('lud16') ?? undefined;
  return { walletPubkey, secret, relays, lud16, expiresAt };
}

export function parseNwcConnectionStringResult(input: string): NwcResult<NwcConnection> {
  try {
    return { ok: true, value: parseNwcConnectionString(input) };
  } catch (error) {
    return { ok: false, error: toNwcError(error) };
  }
}

function parseNwcExpiry(params: URLSearchParams): number | undefined {
  const raw = params.get('expires_at') ?? params.get('expiry') ?? params.get('expires');
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new NwcError('invalid_format', 'Connection string has an invalid expiry timestamp.');
  }
  return Math.floor(parsed);
}

// Masked rendering for Settings: scheme + truncated wallet pubkey + relay
// host. Never includes the secret or full relay query string.
export function maskNwcConnectionString(connection: NwcConnection): string {
  const host = (() => {
    try {
      return new URL(connection.relays[0].replace(/^wss:\/\//, 'https://')).host;
    } catch {
      return '…';
    }
  })();
  return `nostr+walletconnect://${connection.walletPubkey.slice(0, 8)}…?relay=${host}`;
}

export function toNwcError(error: unknown): NwcError {
  if (error instanceof NwcError) return error;
  const message = error instanceof Error ? error.message : String(error || 'Unknown NWC failure.');
  return new NwcError('unknown_failure', message);
}
