// Type contract for the strfry write-policy plugin. The plugin itself stays plain
// JavaScript because strfry executes it directly on the relay host, where there is no
// build step and no TypeScript toolchain.

// Two protocol families are accepted, each validated on its own terms: persistent
// encrypted sync records, and ephemeral device-pairing responses.

export declare const SYNC_KIND: 30078;
export declare const SYNC_D_PREFIX: 'workstr:v2:';
/** The original names for the sync constants. Retained for existing importers. */
export declare const ACCEPTED_KIND: 30078;
export declare const REQUIRED_D_PREFIX: 'workstr:v2:';
export declare const ACCEPTED_D_PREFIXES: readonly string[];
export declare const DEFAULT_QUOTA_BYTES: number;
export declare const DEFAULT_CEILING_BYTES: number;
export declare const DEFAULT_ALERT_RATIO: number;

export declare const PAIR_KIND: 20078;
export declare const PAIR_D_PREFIX: 'workstr:pair:';
export declare const PAIR_PROTOCOL_VERSION: 1;
/** A pairing id is 32 lowercase hex characters: 128 bits, fixed width. */
export declare const PAIR_ID_PATTERN: RegExp;
export declare const PAIR_MAX_BYTES: number;
export declare const PAIR_MAX_LIFETIME_SECONDS: number;
export declare const PAIR_WINDOW_SECONDS: number;
export declare const DEFAULT_PAIR_MAX_PER_AUTHOR: number;
export declare const DEFAULT_PAIR_MAX_TOTAL: number;

export interface PolicyEvent {
  id?: string;
  pubkey?: string;
  created_at?: number;
  kind?: number;
  tags?: unknown;
  content?: string;
  sig?: string;
}

export interface PolicyDecision {
  action: 'accept' | 'reject';
  /** NIP-20 message. Present on rejections only; strfry ignores it when accepting. */
  msg?: string;
}

/** What the ledger knows about one incoming sync event, or null for the stateless shape check. */
export interface PolicyLimits {
  blocked: boolean;
  /** What the author's footprint becomes if this event is stored. */
  authorBytes: number;
  /** What the relay total becomes if this event is stored. */
  totalBytes: number;
  quotaBytes: number;
  ceilingBytes: number;
}

/**
 * What the ledger knows about one incoming pairing event. Counted, not weighed: these
 * events expire on their own, so the bound is how many an author may publish per window
 * rather than how many bytes they hold.
 */
export interface PairingLimits {
  blocked: boolean;
  authorEvents: number;
  totalEvents: number;
  maxPerAuthor: number;
  maxTotal: number;
  /** The persistent relay total, so a relay over its ceiling stops taking any write. */
  totalBytes: number;
  ceilingBytes: number;
}

export interface LedgerAuthor {
  pubkey: string;
  bytes: number;
  records: number;
}

export interface LedgerSnapshot {
  totalBytes: number;
  quotaBytes: number;
  ceilingBytes: number;
  alertRatio: number;
  authors: LedgerAuthor[];
  blocked: string[];
}

export interface Ledger {
  load(): Ledger;
  check(pubkey: string, address: string, bytes: number): PolicyLimits;
  record(pubkey: string, address: string, bytes: number): void;
  /** Pairing's counterpart to `check`. In-memory only; never persisted. */
  checkPairing(pubkey: string, nowSeconds?: number): PairingLimits;
  recordPairing(pubkey: string, nowSeconds?: number): void;
  snapshot(): LedgerSnapshot;
  flush(): void;
}

export interface LedgerOptions {
  /** Omitted, the ledger holds state in memory only and persists nothing. */
  stateDir?: string | null;
  quotaBytes?: number;
  ceilingBytes?: number;
  alertRatio?: number;
  pairMaxPerAuthor?: number;
  pairMaxTotal?: number;
  warn?(message: string): void;
}

export declare function createLedger(options?: LedgerOptions): Ledger;
export declare function eventBytes(event: PolicyEvent): number;
export declare function humanBytes(bytes: number): string;

export declare function looksLikeSyncEvent(event: PolicyEvent | null | undefined): boolean;
export declare function looksLikePairingEvent(event: PolicyEvent | null | undefined): boolean;

/** The encrypted-sync validator. Its behaviour predates pairing and is unchanged by it. */
export declare function decideSync(event: PolicyEvent, limits?: PolicyLimits | null): PolicyDecision;

/** The pairing validator. Independent of `decideSync`, so either can change alone. */
export declare function decidePairing(
  event: PolicyEvent,
  limits?: PairingLimits | null,
  nowSeconds?: number
): PolicyDecision;

/** Dispatches to whichever family the event belongs to, and rejects anything else. */
export declare function decide(
  event: PolicyEvent | null | undefined,
  limits?: PolicyLimits | PairingLimits | null,
  nowSeconds?: number
): PolicyDecision;

/** Returns the response line for one strfry request line, or null when none is owed. */
export declare function handleLine(line: string, ledger?: Ledger | null): string | null;
export declare function runPolicy(
  inputStream: NodeJS.ReadableStream,
  outputStream: NodeJS.WritableStream,
  ledger: Ledger
): import('node:readline').Interface;
