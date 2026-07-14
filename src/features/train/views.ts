import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import { displayWeightKg, formatWeightKg, normalizeWeightUnit, type WeightUnit } from '../../core/units';
import { sessionExercises, type ActiveSession, type AppState, type SessionSetLog } from '../../app/state';
import { formatSessionDate, html } from '../../app/format';
import { paintBodyMapSvg } from '../../app/bodymap';

export function workoutVolume(session: ActiveSession): number {
  return session.sets.filter((set) => set.done).reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
}

export function sessionDuration(session: ActiveSession): string {
  if (!session.startedAt || !session.finishedAt) return '';
  const min = Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
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

export function sessionDetail(session: ActiveSession, unit: WeightUnit): string {
  const byEx = new Map<string, SessionSetLog[]>();
  for (const set of session.sets.filter((item) => item.done)) {
    if (!byEx.has(set.exerciseSlug)) byEx.set(set.exerciseSlug, []);
    byEx.get(set.exerciseSlug)!.push(set);
  }
  const exName = (slug: string) => sessionExercises(session).find((member) => member.exerciseSlug === slug)?.exerciseName || slug;
  const rows = [...byEx.entries()].map(([slug, sets]) => {
    const pills = [...sets].sort((a, b) => a.setNumber - b.setNumber).map((set) =>
      `<span class="set-pill">${set.reps ?? '?'}${set.weight != null ? ` × ${html(formatWeightKg(set.weight, unit))}` : ''}</span>`
    ).join('');
    return `<div class="session-detail-ex">
      <div class="session-detail-ex-name">${html(exName(slug))}</div>
      <div class="session-detail-sets">${pills}</div>
    </div>`;
  }).join('');
  return `<div class="session-detail">
    ${rows || '<p class="empty" style="padding:6px 0 12px">No sets were logged in this session.</p>'}
    <div class="workout-card-actions">
      <button class="button primary small" disabled title="Publishing summaries arrives with the Nostr share block">Publish summary</button>
      <button class="button danger small" data-delete-session="${session.id}">Delete session</button>
    </div>
  </div>`;
}

export function workoutHistory(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  if (!state.finishedSessions.length) return '<div class="list empty">No completed sessions yet. Finish a workout to see it here.</div>';
  return `<div class="program-list" id="history-list">${state.finishedSessions.map((session) => {
    const doneSets = session.sets.filter((set) => set.done);
    const volume = workoutVolume(session);
    const meta = [
      formatSessionDate(session.finishedAt || session.startedAt),
      sessionDuration(session),
      `${doneSets.length} set${doneSets.length === 1 ? '' : 's'}`,
      volume > 0 ? `${Math.round(displayWeightKg(volume, unit) || 0)} ${unit} volume` : ''
    ].filter(Boolean).join(' · ');
    const groups = sessionMuscleGroupNames(session, state.exercises);
    const { primary, secondary } = sessionMuscleSets(session, state.exercises);
    const map = paintBodyMapSvg(primary, secondary);
    const expanded = state.expandedSessionId === session.id;
    return `<div class="workout-card ${expanded ? 'expanded' : ''}" data-session="${session.id}">
      <div class="workout-card-header" data-toggle-session="${session.id}">
        <div class="workout-card-map ${map ? 'has-map' : ''}" data-session-map="${session.id}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'}</div>
        <div class="workout-card-info">
          <div class="workout-card-name">${html(session.sheetName || 'Freestyle')}</div>
          <div class="workout-card-meta">${meta}</div>
          ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
        </div>
        <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="workout-card-body" data-session-body="${session.id}">${expanded ? sessionDetail(session, unit) : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
