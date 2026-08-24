// Type contract for the strfry write-policy plugin. The plugin itself stays plain
// JavaScript because strfry executes it directly on the relay host, where there is no
// build step and no TypeScript toolchain.

export declare const ACCEPTED_KIND: 30078;
export declare const REQUIRED_D_PREFIX: 'workstr:v2:';
export declare const ACCEPTED_D_PREFIXES: readonly string[];
export declare const DEFAULT_QUOTA_BYTES: number;
export declare const DEFAULT_CEILING_BYTES: number;
export declare const DEFAULT_ALERT_RATIO: number;

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

/** What the ledger knows about one incoming event, or null for the stateless shape check. */
export interface PolicyLimits {
  blocked: boolean;
  /** What the author's footprint becomes if this event is stored. */
  authorBytes: number;
  /** What the relay total becomes if this event is stored. */
  totalBytes: number;
  quotaBytes: number;
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
  snapshot(): LedgerSnapshot;
  flush(): void;
}

export interface LedgerOptions {
  /** Omitted, the ledger holds state in memory only and persists nothing. */
  stateDir?: string | null;
  quotaBytes?: number;
  ceilingBytes?: number;
  alertRatio?: number;
  warn?(message: string): void;
}

export declare function createLedger(options?: LedgerOptions): Ledger;
export declare function eventBytes(event: PolicyEvent): number;
export declare function humanBytes(bytes: number): string;

export declare function decide(event: PolicyEvent | null | undefined, limits?: PolicyLimits | null): PolicyDecision;

/** Returns the response line for one strfry request line, or null when none is owed. */
export declare function handleLine(line: string, ledger?: Ledger | null): string | null;
export declare function runPolicy(
  inputStream: NodeJS.ReadableStream,
  outputStream: NodeJS.WritableStream,
  ledger: Ledger
): import('node:readline').Interface;
