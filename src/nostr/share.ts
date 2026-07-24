import { SimplePool } from 'nostr-tools';
import { DEFAULT_WRITE_RELAYS } from './pool';
import { canonMuscle } from '../core/muscles';
import type { Exercise } from '../core/types';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import { sessionExercises, type ActiveSession, type SessionSetLog } from '../app/state';
import { displayWeightKg, type WeightUnit } from '../core/units';

function sessionDuration(session: ActiveSession): string {
  if (!session.startedAt || !session.finishedAt) return '';
  const sec = Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m` : `${sec}s`;
}

function doneSetsByExercise(session: ActiveSession): Map<string, SessionSetLog[]> {
  const byExercise = new Map<string, SessionSetLog[]>();
  for (const set of session.sets.filter((item) => item.done)) {
    const list = byExercise.get(set.exerciseSlug) ?? [];
    list.push(set);
    byExercise.set(set.exerciseSlug, list);
  }
  return byExercise;
}

function exerciseName(session: ActiveSession, slug: string, sets: SessionSetLog[]): string {
  return sets.find((set) => set.exerciseName)?.exerciseName
    || sessionExercises(session).find((member) => member.exerciseSlug === slug)?.exerciseName
    || slug;
}

function sessionMuscleSets(session: ActiveSession, exercises: Exercise[] = []): { primary: Set<string>; secondary: Set<string>; names: string[] } {
  const doneSlugs = new Set(session.sets.filter((set) => set.done).map((set) => set.exerciseSlug));
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const member of sessionExercises(session)) {
    if (!doneSlugs.has(member.exerciseSlug)) continue;
    const full = exercises.find((exercise) => exercise.slug === member.exerciseSlug);
    const main = canonMuscle(full?.muscle_group || member.muscleGroup || '');
    if (main) primary.add(main);
    for (const raw of full?.muscles || []) {
      const muscle = canonMuscle(raw);
      if (muscle) secondary.add(muscle);
    }
  }
  primary.forEach((muscle) => secondary.delete(muscle));
  return { primary, secondary, names: [...primary] };
}

// Human-readable kind:1 workout summary with optional muscle-map media.
export function workoutSummaryText(session: ActiveSession, unit: WeightUnit, imageUrl = '', exercises: Exercise[] = []): string {
  const done = session.sets.filter((set) => set.done);
  const byExercise = doneSetsByExercise(session);
  const volume = done.reduce((sum, set) => sum + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
  const muscles = sessionMuscleSets(session, exercises).names;
  const lines = [
    'Workstr training summary',
    '',
    `Program: ${session.sheetName || 'Freestyle'}`,
    [
      sessionDuration(session) ? `Duration: ${sessionDuration(session)}` : '',
      `${done.length} set${done.length === 1 ? '' : 's'}`,
      `Volume: ${Math.round(displayWeightKg(volume, unit) ?? 0)} ${unit}`
    ].filter(Boolean).join(' · ')
  ];
  if (muscles.length) lines.push(`Worked: ${muscles.join(', ')}`);
  lines.push('', 'Top work');
  for (const [slug, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => a.setNumber - b.setNumber);
    const best = sorted.reduce((a, b) => ((Number(b.weight) || 0) > (Number(a.weight) || 0) ? b : a), sorted[0]);
    const top = best.weight == null ? 'bodyweight' : `${displayWeightKg(best.weight, unit)} ${unit}`;
    lines.push(`- ${exerciseName(session, slug, sets)}: ${sets.length} set${sets.length === 1 ? '' : 's'}, top ${top} x ${best.reps ?? '-'}`);
  }
  lines.push('', 'Tracked with Workstr.', '#workout #fitness #workstr');
  if (imageUrl) lines.push('', imageUrl);
  return lines.join('\n');
}

function mediaMime(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

export function buildWorkoutSummaryEvent(session: ActiveSession, unit: WeightUnit, imageUrl = '', exercises: Exercise[] = []): UnsignedNostrEvent {
  const tags = [['t', 'workout'], ['t', 'fitness'], ['t', 'workstr'], ['client', 'workstr']];
  if (imageUrl) tags.push(['imeta', `url ${imageUrl}`, `m ${mediaMime(imageUrl)}`, `alt Muscle map for ${session.sheetName || 'Workstr workout'}`]);
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: workoutSummaryText(session, unit, imageUrl, exercises)
  };
}

export interface PublishSummaryResult {
  event: SignedNostrEvent;
  okRelays: string[];
  failedRelays: string[];
  confirmed: boolean;
}

export type PublishSummaryStage = 'preparing-image' | 'waiting-for-signer' | 'uploading-image' | 'publishing';

interface PublishSummaryOptions {
  onStage?: (stage: PublishSummaryStage) => void;
  exercises?: Exercise[];
  imageUrl?: string;
}

interface PublishRelayResult {
  relay: string;
  accepted: boolean;
  reason: string;
}

const SIGN_TIMEOUT_MS = 120000;
const PUBLISH_TIMEOUT_MS = 8000;
const CONFIRM_TIMEOUT_MS = 3500;

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
  // nostr-tools SimplePool.publish resolves connection failures as a string instead
  // of rejecting them. Treat those as failures so the UI never marks a local
  // summary as Published when no relay actually acknowledged the EVENT.
  return result.status === 'fulfilled' && !result.value.toLowerCase().startsWith('connection failure:');
}

export function summarizePublishResults(relays: string[], results: PromiseSettledResult<string>[]): PublishRelayResult[] {
  return relays.map((relay, index) => ({
    relay,
    accepted: isAcceptedPublishResult(results[index]),
    reason: publishResultReason(results[index])
  }));
}

export async function publishWorkoutSummary(signer: Signer, session: ActiveSession, unit: WeightUnit, relays: string[] = DEFAULT_WRITE_RELAYS, options: PublishSummaryOptions = {}): Promise<PublishSummaryResult> {
  // Workstr Web should not ask the signer for NIP-98 media-upload auth during
  // summary publish when a relay-published program did not carry a map URL.
  // Reuse the program map when present; otherwise publish a text-only kind:1.
  const imageUrl = options.imageUrl || '';
  options.onStage?.('waiting-for-signer');
  const signed = await withTimeout(signer.signEvent(buildWorkoutSummaryEvent(session, unit, imageUrl, options.exercises || [])), SIGN_TIMEOUT_MS, 'signer approval timed out');
  options.onStage?.('publishing');
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(relays, signed as Parameters<typeof pool.publish>[1]).map((publish) => withTimeout(publish, PUBLISH_TIMEOUT_MS, 'relay publish timed out')));
    const relayResults = summarizePublishResults(relays, results);
    const okRelays = relayResults.filter((result) => result.accepted).map((result) => result.relay);
    const failedRelays = relayResults.filter((result) => !result.accepted).map((result) => result.relay);
    if (!okRelays.length) {
      const firstFailure = relayResults.find((result) => !result.accepted);
      throw new Error(`no relay accepted the note${firstFailure ? ` (${firstFailure.relay}: ${firstFailure.reason})` : ''}`);
    }

    let confirmed = false;
    try {
      confirmed = Boolean(await pool.get(okRelays, {
        ids: [signed.id],
        authors: [signed.pubkey],
        kinds: [1],
        limit: 1
      }, { maxWait: CONFIRM_TIMEOUT_MS }));
    } catch {
      confirmed = false;
    }

    return { event: signed, okRelays, failedRelays, confirmed };
  } finally {
    pool.close(relays);
  }
}
