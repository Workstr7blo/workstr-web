// Type contract for the strfry write-policy plugin. The plugin itself stays plain
// JavaScript because strfry executes it directly on the relay host, where there is no
// build step and no TypeScript toolchain.

export declare const ACCEPTED_KIND: 30078;
export declare const REQUIRED_D_PREFIX: 'workstr:v1:';

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

export declare function decide(event: PolicyEvent | null | undefined): PolicyDecision;

/** Returns the response line for one strfry request line, or null when none is owed. */
export declare function handleLine(line: string): string | null;
