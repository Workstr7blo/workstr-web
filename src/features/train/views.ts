import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import { formatWeightKg, type WeightUnit } from '../../core/units';
import { sessionExercises, type ActiveSession, type SessionSetLog } from '../../app/state';
import { html } from '../../app/format';
import { repeatBlockedReason } from './repeat-workout';

export function workoutVolume(session: ActiveSession): number {
  return session.sets.filter((set) => set.done).reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
}

export function sessionDuration(session: ActiveSession): string {
  if (!session.startedAt || !session.finishedAt) return '';
  const min = session.blocks?.some((block) => block.type === 'emom') && session.emomActiveSec != null
    ? Math.round(session.emomActiveSec / 60)
    : Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
  if (!Number.isFinite(min) || min <= 0) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

function muscleSetsForSlugs(slugs: string[], fallbackGroups: string[], exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const group of fallbackGroups) { const canonical = canonMuscle(group); if (canonical) primary.add(canonical); }
  for (const slug of slugs) {
    const full = exercises.find((exercise) => exercise.slug === slug);
    const canonicalPrimary = canonMuscle(full?.muscle_group || '');
    if (canonicalPrimary) primary.add(canonicalPrimary);
    for (const raw of full?.muscles || []) { const canonical = canonMuscle(raw); if (canonical) secondary.add(canonical); }
  }
  primary.forEach((muscle) => secondary.delete(muscle));
  return { primary, secondary };
}

export function sessionMuscleSets(session: ActiveSession, exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const slugs = [...new Set(sessionExercises(session).map((member) => member.exerciseSlug))];
  const fallbackGroups = sessionExercises(session).map((member) => member.muscleGroup || '').filter(Boolean);
  return muscleSetsForSlugs(slugs, fallbackGroups, exercises);
}

export function sessionMuscleGroupNames(session: ActiveSession, exercises: Exercise[]): string[] {
  const names = new Set<string>();
  for (const member of sessionExercises(session)) {
    if (member.muscleGroup) names.add(member.muscleGroup);
    const full = exercises.find((exercise) => exercise.slug === member.exerciseSlug);
    if (full?.muscle_group) names.add(full.muscle_group);
  }
  return [...names].filter(Boolean);
}

export function publishSummaryButton(session: ActiveSession, canPublish: boolean, publishing = false, size = 'small', publishingLabel = 'Waiting for signer...'): string {
  if (session.nostrEventId) return `<button class="button ghost ${size}" disabled title="Summary already published to Nostr">Published</button>`;
  if (publishing) return `<button class="button primary ${size}" disabled>${html(publishingLabel)}</button>`;
  if (!canPublish) return `<button class="button primary ${size}" disabled title="Sign in with your Nostr signer in Settings to publish">Publish summary</button>`;
  return `<button class="button primary ${size}" data-publish-session="${session.id}">Publish summary</button>`;
}

// Repeating is the main thing you come to a finished workout to do, so it leads the action
// row. A snapshot too old or too broken to rebuild says so on the disabled button instead
// of failing once tapped.
export function repeatWorkoutButton(session: ActiveSession): string {
  const blocked = repeatBlockedReason(session);
  return blocked
    ? `<button class="button ghost small" disabled title="${html(blocked)}">Repeat workout</button>`
    : `<button class="button primary small" data-repeat-session="${session.id}">Repeat workout</button>`;
}

export function sessionDetail(session: ActiveSession, unit: WeightUnit, canPublish = false, publishing = false, publishingLabel = 'Waiting for signer...'): string {
  const byEx = new Map<string, SessionSetLog[]>();
  for (const set of session.sets.filter((item) => item.done)) {
    if (!byEx.has(set.exerciseSlug)) byEx.set(set.exerciseSlug, []);
    byEx.get(set.exerciseSlug)!.push(set);
  }
  const exName = (slug: string) => sessionExercises(session).find((member) => member.exerciseSlug === slug)?.exerciseName || slug;
  const supersetFor = (slug: string) => (session.blocks || [])
    .map((block, index) => ({ block, index }))
    .find(({ block }) => block.type === 'straight' && block.steps.length > 1 && block.steps.some((step) => step.exerciseSlug === slug));
  const rows = [...byEx.entries()].map(([slug, sets]) => {
    const superset = supersetFor(slug);
    const pills = [...sets].sort((a, b) => a.setNumber - b.setNumber).map((set) =>
      `<span class="set-pill">${set.reps ?? '?'}${set.weight != null ? ` × ${html(formatWeightKg(set.weight, unit))}` : ''}</span>`
    ).join('');
    return `<div class="session-detail-ex">
      <div class="session-detail-ex-name">${html(exName(slug))}${superset ? ` <span class="session-superset-badge">Superset ${superset.index + 1}</span>` : ''}</div>
      <div class="session-detail-sets">${pills}</div>
    </div>`;
  }).join('');
  return `<div class="session-detail">
    ${rows || '<p class="empty" style="padding:6px 0 12px">No sets were logged in this session.</p>'}
    <div class="workout-card-actions">
      ${repeatWorkoutButton(session)}
      ${publishSummaryButton(session, canPublish, publishing, 'small', publishingLabel)}
    </div>
    <!-- Deleting is destructive and rarely what you came for, so it sits behind a
         disclosure rather than beside publish. Native <details> keeps it keyboard
         operable without new state; the confirm dialog still guards the click. -->
    <details class="session-danger">
      <summary>More actions</summary>
      <button class="button danger small" data-delete-session="${session.id}">Delete session</button>
    </details>
  </div>`;
}
