// Type contract for the relay admin tool. Plain JavaScript for the same reason as the
// plugin: it runs on the relay host, where there is no build step.

export interface UsageLedger {
  version: number;
  updatedAt?: string;
  /** pubkey -> record address -> bytes stored at that address. */
  authors: Record<string, Record<string, number>>;
}

export interface Blocklist {
  version: number;
  blocked: Record<string, { at: string; reason: string }>;
}

export declare function readState<T>(path: string, fallback: T): T;
export declare function writeState(path: string, data: unknown): void;
export declare function authorTotals(usage: UsageLedger): { pubkey: string; bytes: number; records: number }[];

/** Recomputes the ledger from `strfry export` output; newest line wins per address. */
export declare function ledgerFromEvents(lines: string[]): UsageLedger;
