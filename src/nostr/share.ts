import { SimplePool } from 'nostr-tools';
import { CANON_RELAYS } from './canon';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../signer/types';
import type { ActiveSession, SessionSetLog } from '../app/state';
import { displayWeightKg, type WeightUnit } from '../core/units';

// Human-readable kind:1 workout summary, same shape the self-hosted Workstr posts.
export function workoutSummaryText(session: ActiveSession, unit: WeightUnit): string {
  const done = session.sets.filter((set) => set.done);
  const byExercise = new Map<string, SessionSetLog[]>();
  for (const set of done) {
    const list = byExercise.get(set.exerciseSlug) ?? [];
    list.push(set);
    byExercise.set(set.exerciseSlug, list);
  }
  const volume = done.reduce((sum, set) => sum + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
  const lines = [`Workout: ${session.sheetName || 'Freestyle'}`];
  for (const [slug, sets] of byExercise) {
    const name = sets.find((set) => set.exerciseName)?.exerciseName
      || session.exercises?.find((member) => member.exerciseSlug === slug)?.exerciseName
      || slug;
    const best = sets.reduce((a, b) => ((Number(b.weight) || 0) > (Number(a.weight) || 0) ? b : a), sets[0]);
    const top = best.weight == null ? '-' : `${displayWeightKg(best.weight, unit)}${unit}`;
    lines.push(`- ${name}: ${sets.length} set${sets.length === 1 ? '' : 's'}, top ${top} x ${best.reps ?? '-'}`);
  }
  lines.push(`Total volume: ${Math.round(displayWeightKg(volume, unit) ?? 0)} ${unit}`);
  lines.push('#workout #fitness');
  return lines.join('\n');
}

export function buildWorkoutSummaryEvent(session: ActiveSession, unit: WeightUnit): UnsignedNostrEvent {
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'workout'], ['t', 'fitness'], ['client', 'workstr']],
    content: workoutSummaryText(session, unit)
  };
}

export interface PublishSummaryResult {
  event: SignedNostrEvent;
  okRelays: string[];
  failedRelays: string[];
  confirmed: boolean;
}

interface PublishRelayResult {
  relay: string;
  accepted: boolean;
  reason: string;
}

const PUBLISH_TIMEOUT_MS = 8000;
const CONFIRM_TIMEOUT_MS = 3500;

function withTimeout<T>(promise: Promise<T>, timeoutMs = PUBLISH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
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

export async function publishWorkoutSummary(signer: Signer, session: ActiveSession, unit: WeightUnit, relays: string[] = CANON_RELAYS): Promise<PublishSummaryResult> {
  const signed = await signer.signEvent(buildWorkoutSummaryEvent(session, unit));
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(relays, signed as Parameters<typeof pool.publish>[1]).map((publish) => withTimeout(publish)));
    const relayResults = summarizePublishResults(relays, results);
    const okRelays = relayResults.filter((result) => result.accepted).map((result) => result.relay);
    const failedRelays = relayResults.filter((result) => !result.accepted).map((result) => result.relay);
    if (!okRelays.length) {
      const firstFailure = relayResults.find((result) => !result.accepted);
      throw new Error(`no relay accepted the note${firstFailure ? ` (${firstFailure.relay}: ${firstFailure.reason})` : ''}`);
    }

    const confirmed = Boolean(await pool.get(okRelays, {
      ids: [signed.id],
      authors: [signed.pubkey],
      kinds: [1],
      limit: 1
    }, { maxWait: CONFIRM_TIMEOUT_MS }));
    if (!confirmed) {
      throw new Error(`relay OK received but the note was not readable back yet (${signed.id})`);
    }

    return { event: signed, okRelays, failedRelays, confirmed };
  } finally {
    pool.close(relays);
  }
}
