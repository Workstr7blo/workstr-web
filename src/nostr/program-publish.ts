import { SimplePool } from 'nostr-tools';
import type { SheetExercise } from '../core/types';
import { slugify } from '../core/ids';
import type { SheetWithExercises } from '../db/store';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { CREATOR_PROGRAM_D_PREFIX, CREATOR_PROGRAM_KIND } from './creator-programs';
import { redactNwcSecrets } from './nwc';
import { DEFAULT_PUBLIC_RELAYS } from './pool';

const SIGN_TIMEOUT_MS = 120000;
const PUBLISH_TIMEOUT_MS = 8000;
const CONFIRM_TIMEOUT_MS = 3500;
const WORKSTR_SYNC_RELAY_HOST = 'relay.workstr.fit';
const NWC_PUBLIC_SECRET_ERROR = 'Creator program publish blocked: remove NWC wallet connection or secret material before publishing.';

export interface PublishCreatorProgramResult {
  event: SignedNostrEvent;
  okRelays: string[];
  failedRelays: string[];
  confirmed: boolean;
}

export interface ProgramPublishRelayResult {
  relay: string;
  accepted: boolean;
  reason: string;
}

export type PublishCreatorProgramStage = 'waiting-for-signer' | 'publishing';

export interface ProgramPublishPool {
  publish(relays: string[], event: SignedNostrEvent): Array<Promise<string>>;
  get?(relays: string[], filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  close(relays: string[]): void;
}

interface PublishCreatorProgramOptions {
  onStage?: (stage: PublishCreatorProgramStage) => void;
  poolFactory?: () => ProgramPublishPool;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = PUBLISH_TIMEOUT_MS, label = 'timeout'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function publishResultReason(result: PromiseSettledResult<string>): string {
  if (result.status === 'fulfilled') return result.value || 'accepted';
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

function isAcceptedPublishResult(result: PromiseSettledResult<string>): boolean {
  return result.status === 'fulfilled' && !result.value.toLowerCase().startsWith('connection failure:');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTopic(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

function isPublicProgramRelay(relay: string): boolean {
  try {
    const parsed = new URL(relay);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return false;
    return parsed.hostname.toLowerCase() !== WORKSTR_SYNC_RELAY_HOST;
  } catch {
    return false;
  }
}

export function normalizeProgramPublishRelays(relays: string[] = DEFAULT_PUBLIC_RELAYS): string[] {
  return dedupe(relays).filter(isPublicProgramRelay);
}

export function creatorProgramDTag(sheet: Pick<SheetWithExercises, 'id' | 'slug' | 'name'>): string {
  const stable = sheet.slug || (sheet.id ? `program-${sheet.id}` : slugify(sheet.name) || 'program');
  return `${CREATOR_PROGRAM_D_PREFIX}${stable}`;
}

function exerciseAddress(row: SheetExercise): string {
  const slug = row.exercise_slug || slugify(row.exercise_name || '') || 'exercise';
  return `workstr:exercise:${slug}`;
}

function containsNwcSecretMaterial(value: string): boolean {
  return /walletconnect/i.test(value) || redactNwcSecrets(value) !== value;
}

function assertNoNwcSecretMaterial(value: unknown): void {
  if (typeof value === 'string') {
    if (containsNwcSecretMaterial(value)) throw new Error(NWC_PUBLIC_SECRET_ERROR);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoNwcSecretMaterial(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertNoNwcSecretMaterial(item);
  }
}

function assertCreatorProgramPublicFieldsSafe(sheet: SheetWithExercises): void {
  assertNoNwcSecretMaterial({
    slug: sheet.slug,
    name: sheet.name,
    notes: sheet.notes,
    difficulty: sheet.difficulty,
    tags: sheet.tags,
    exercises: sheet.exercises.map((row) => ({
      exercise_slug: row.exercise_slug,
      exercise_name: row.exercise_name,
      muscle_group: row.muscle_group,
      image_url: row.image_url,
      reps: row.reps,
      weight: row.weight,
      rest: row.rest,
      notes: row.notes
    })),
    blocks: sheet.blocks
  });
}

function programMeta(sheet: SheetWithExercises): Record<string, unknown> {
  return {
    v: 1,
    description: sheet.notes || '',
    difficulty: sheet.difficulty || '',
    tags: sheet.tags || [],
    exercises: sheet.exercises.map((row) => ({
      address: exerciseAddress(row),
      name: row.exercise_name || row.exercise_slug || 'Exercise',
      muscleGroup: row.muscle_group || undefined,
      imageUrl: row.image_url || undefined,
      notes: row.notes || undefined,
      sets: Number(row.sets) || undefined,
      reps: row.reps == null ? undefined : String(row.reps),
      weight: row.weight == null ? undefined : String(row.weight),
      restSec: Number(row.rest) || undefined
    })),
    blocks: sheet.blocks || undefined
  };
}

export function buildCreatorProgramEvent(sheet: SheetWithExercises): UnsignedNostrEvent {
  assertCreatorProgramPublicFieldsSafe(sheet);
  const dTag = creatorProgramDTag(sheet);
  const tags = [
    ['d', dTag],
    ['title', sheet.name],
    ['t', 'workstr'],
    ['t', 'beastmode'],
    ['t', 'workstr-program'],
    ['client', 'Workstr']
  ];
  const difficulty = (sheet.difficulty || '').trim();
  if (difficulty) {
    tags.push(['difficulty', difficulty], ['t', normalizeTopic(difficulty)]);
  }
  for (const tag of sheet.tags || []) tags.push(['t', tag]);
  for (const row of sheet.exercises) {
    tags.push([
      'exercise',
      exerciseAddress(row),
      row.exercise_name || row.exercise_slug || 'Exercise',
      row.weight == null ? '' : String(row.weight),
      row.reps == null ? '' : String(row.reps),
      row.rest == null ? '' : String(row.rest),
      'normal'
    ]);
  }
  tags.push(['workstr_meta', JSON.stringify(programMeta(sheet))]);
  return {
    kind: CREATOR_PROGRAM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: sheet.notes || ''
  };
}

export function summarizeProgramPublishResults(relays: string[], results: PromiseSettledResult<string>[]): ProgramPublishRelayResult[] {
  return relays.map((relay, index) => ({
    relay,
    accepted: isAcceptedPublishResult(results[index]),
    reason: publishResultReason(results[index])
  }));
}

export async function publishCreatorProgram(
  signer: Signer,
  sheet: SheetWithExercises,
  relays: string[] = DEFAULT_PUBLIC_RELAYS,
  options: PublishCreatorProgramOptions = {}
): Promise<PublishCreatorProgramResult> {
  const publicRelays = normalizeProgramPublishRelays(relays);
  if (!publicRelays.length) throw new Error('no public program relays configured');

  options.onStage?.('waiting-for-signer');
  const signed = await withTimeout(signer.signEvent(buildCreatorProgramEvent(sheet)), SIGN_TIMEOUT_MS, 'signer approval timed out');
  options.onStage?.('publishing');
  const pool = options.poolFactory?.() || new SimplePool() as unknown as ProgramPublishPool;
  try {
    const results = await Promise.allSettled(pool.publish(publicRelays, signed).map((publish) => withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out')));
    const relayResults = summarizeProgramPublishResults(publicRelays, results);
    const okRelays = relayResults.filter((result) => result.accepted).map((result) => result.relay);
    const failedRelays = relayResults.filter((result) => !result.accepted).map((result) => result.relay);
    if (!okRelays.length) {
      const firstFailure = relayResults.find((result) => !result.accepted);
      throw new Error(`no public relay accepted the program${firstFailure ? ` (${firstFailure.relay}: ${firstFailure.reason})` : ''}`);
    }

    let confirmed = false;
    try {
      confirmed = Boolean(await pool.get?.(okRelays, {
        ids: [signed.id],
        authors: [signed.pubkey],
        kinds: [CREATOR_PROGRAM_KIND],
        limit: 1
      }, { maxWait: CONFIRM_TIMEOUT_MS }));
    } catch {
      confirmed = false;
    }

    return { event: signed, okRelays, failedRelays, confirmed };
  } finally {
    pool.close(publicRelays);
  }
}
