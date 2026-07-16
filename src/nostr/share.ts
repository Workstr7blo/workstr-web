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
}

const PUBLISH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs = PUBLISH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function publishWorkoutSummary(signer: Signer, session: ActiveSession, unit: WeightUnit, relays: string[] = CANON_RELAYS): Promise<PublishSummaryResult> {
  const signed = await signer.signEvent(buildWorkoutSummaryEvent(session, unit));
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(relays, signed as Parameters<typeof pool.publish>[1]).map((publish) => withTimeout(publish)));
    const okRelays = relays.filter((_, index) => results[index].status === 'fulfilled');
    const failedRelays = relays.filter((_, index) => results[index].status === 'rejected');
    if (!okRelays.length) {
      const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      throw new Error(`no relay accepted the note${first ? ` (${String(first.reason)})` : ''}`);
    }
    return { event: signed, okRelays, failedRelays };
  } finally {
    pool.close(relays);
  }
}
