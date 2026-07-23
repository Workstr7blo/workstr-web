import { canonMuscle } from '../../core/muscles';
import type { Exercise } from '../../core/types';
import { displayWeightKg, normalizeWeightUnit } from '../../core/units';
import type { SheetWithExercises } from '../../db/store';
import type { RelayProgram } from '../../nostr/canon';
import { programImportState } from '../../nostr/programImport';
import type { AppState } from '../../app/state';
import { authorPill, displayPubkey, exerciseImage, formatMinutes, html, programMuscleLabel } from '../../app/format';
import { paintBodyMapSvg } from '../../app/bodymap';

export interface BuilderRow { exerciseSlug: string; exerciseName: string; muscleGroup?: string; imageUrl?: string; sets: number; reps: string; restSec: number; weight: number | null; notes: string }

export interface BuilderState { sheetId?: number; name: string; desc: string; rows: BuilderRow[]; library: Exercise[] }

export function estimateProgramMin(exercises: RelayProgram['exercises']): number {
  return exercises.reduce((total, exercise) => {
    const sets = Number(exercise.sets) || 3;
    const rest = Number(exercise.restSec || exercise.rest) || 90;
    return total + sets * 45 + Math.max(0, sets - 1) * rest;
  }, 0);
}

export function resolveProgramExercise(member: RelayProgram['exercises'][number], exercises: Exercise[]): Exercise | null {
  if (member.address) {
    const byAddress = exercises.find((exercise) => exercise.nostr_address === member.address);
    if (byAddress) return byAddress;
    const slug = member.address.split(':').pop();
    const bySlug = exercises.find((exercise) => exercise.slug === slug || `workstr:exercise:${exercise.slug}` === slug);
    if (bySlug) return bySlug;
  }
  if (member.name) {
    const name = member.name.toLowerCase();
    return exercises.find((exercise) => exercise.name.toLowerCase() === name) || null;
  }
  return null;
}

export function programGroups(program: RelayProgram, exercises: Exercise[]): string[] {
  const groups = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const primary = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full)));
    if (primary) groups.add(primary);
  }
  return [...groups];
}

export function programMuscleSets(program: RelayProgram, exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const rawPrimary = member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full));
    const canonicalPrimary = canonMuscle(rawPrimary) || canonMuscle(programMuscleLabel(rawPrimary));
    if (canonicalPrimary) primary.add(canonicalPrimary);
    for (const raw of full?.muscles || []) {
      const canonical = canonMuscle(raw);
      if (canonical) secondary.add(canonical);
    }
  }
  primary.forEach((muscle) => secondary.delete(muscle));
  return { primary, secondary };
}

export function programMuscleMap(program: RelayProgram, exercises: Exercise[]): string {
  const { primary, secondary } = programMuscleSets(program, exercises);
  return paintBodyMapSvg(primary, secondary);
}

export function programExerciseName(member: RelayProgram['exercises'][number], full: Exercise | null): string {
  const slugName = member.address ? member.address.split(':').pop()?.replace(/^workstr:exercise:/, '').replace(/[-_]+/g, ' ') : '';
  return member.name || full?.name || slugName || 'Exercise';
}

export function inferProgramMuscle(name: string): string {
  const value = name.toLowerCase();
  if (/squat|lunge|quad|leg press|step[- ]?up/.test(value)) return 'Quadriceps';
  if (/lateral raise|front raise|shoulder|deltoid|press/.test(value)) return 'Shoulders';
  if (/curl|bicep|hammer|arm/.test(value)) return 'Biceps';
  if (/tricep|extension|dip/.test(value)) return 'Triceps';
  if (/row|pull|lat|back|shrug/.test(value)) return 'Back';
  if (/deadlift|hinge|hamstring|romanian/.test(value)) return 'Hamstrings';
  if (/glute|hip thrust|bridge/.test(value)) return 'Glutes';
  if (/calf/.test(value)) return 'Calves';
  if (/crunch|plank|core|abs|sit[- ]?up/.test(value)) return 'Core';
  if (/bench|push[- ]?up|chest|pec/.test(value)) return 'Chest';
  return '';
}

export function programAuthor(program: RelayProgram, state: AppState): string {
  if (!program.pubkey) return 'unknown';
  return state.authorProfiles?.[program.pubkey]?.name || state.profileNames[program.pubkey] || displayPubkey(program.pubkey);
}

export function programAuthorPill(program: RelayProgram, state: AppState): string {
  if (!program.pubkey) return '';
  return authorPill(state.authorProfiles?.[program.pubkey], program.pubkey);
}

export function isLocalProgram(program: RelayProgram): boolean {
  return program.address.startsWith('local:');
}

export function localSheetId(program: RelayProgram): number {
  return Number(program.address.slice('local:'.length)) || 0;
}

export function sheetToProgram(sheet: SheetWithExercises): RelayProgram {
  return {
    slug: sheet.slug,
    name: sheet.name,
    description: sheet.notes || '',
    tags: [],
    sourceLabel: sheet.nostr_address ? 'in library' : 'local',
    eventId: sheet.nostr_event_id || '',
    pubkey: '',
    address: `local:${sheet.id}`,
    createdAt: Math.floor(new Date(sheet.created_at).getTime() / 1000) || 0,
    exercises: sheet.exercises.map((row) => ({
      address: '',
      name: row.exercise_name || row.exercise_slug || 'Exercise',
      muscleGroup: row.muscle_group,
      imageUrl: row.image_url,
      notes: row.notes,
      sets: Number(row.sets) || undefined,
      reps: row.reps != null ? String(row.reps) : undefined,
      weight: row.weight != null ? String(row.weight) : undefined,
      restSec: Number(row.rest) || undefined
    }))
  };
}

export function programCard(program: RelayProgram, state: AppState): string {
  const exerciseCount = program.exercises.length;
  const time = formatMinutes(estimateProgramMin(program.exercises));
  const groups = programGroups(program, state.exercises);
  const map = programMuscleMap(program, state.exercises);
  const meta = [`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`, program.description ? html(program.description) : '', time ? `~${time}` : ''].filter(Boolean).join(' · ');
  const isExpanded = state.expandedProgramAddress === program.address;
  const statusCls = isLocalProgram(program) ? 'local' : 'published';
  return `<div class="workout-card ${isExpanded ? 'expanded' : ''}" data-program-address="${html(program.address)}">
    <div class="workout-card-header" data-toggle-program="${html(program.address)}">
      <div class="workout-card-map ${map ? 'has-map' : ''}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg>'}</div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(program.name)}<span class="program-status ${statusCls}">${html(program.sourceLabel || 'Workstr')}</span></div>
        <div class="workout-card-meta">${meta}</div>
        ${program.pubkey ? `<div class="workout-card-author">${programAuthorPill(program, state)}</div>` : ''}
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body">${isExpanded ? programBody(program, state) : ''}</div>
  </div>`;
}

export function programBody(program: RelayProgram, state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const exHtml = program.exercises.length ? program.exercises.map((member, index) => {
    const full = resolveProgramExercise(member, state.exercises);
    const name = programExerciseName(member, full);
    const muscle = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name));
    const image = exerciseImage(member.imageUrl || full?.image_url);
    const sets = Number(member.sets) || 3;
    const reps = member.reps || String(full?.default_reps || '8-12');
    const weightValue = displayWeightKg(member.weight, unit);
    const weight = weightValue != null ? ` @ ${html(String(weightValue))}` : '';
    const rest = Number(member.restSec || member.rest || full?.default_rest) || 90;
    return `<div class="wk-ex-item" data-exitem="${html(program.address)}-${index}">
      <div class="wk-ex-header" data-toggle-exitem="${html(program.address)}-${index}">
        ${image}
        <div class="wk-ex-info">
          <div class="wk-ex-name">${html(name)}</div>
          <div class="wk-ex-short">${sets} × ${html(reps)}${weight}</div>
        </div>
        ${muscle ? `<span class="wk-ex-muscle-pill">${html(muscle)}</span>` : ''}
        <svg class="wk-ex-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wk-ex-detail">
        <div class="wk-ex-detail-grid">
          <div class="wk-ex-detail-cell"><div class="val">${sets}</div><div class="lbl">Sets</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${html(reps)}</div><div class="lbl">Reps</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${weightValue != null ? html(String(weightValue)) : '—'}</div><div class="lbl">${unit}</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${rest}s</div><div class="lbl">Rest</div></div>
        </div>
        ${member.notes ? `<div class="wk-ex-detail-note">${html(member.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="empty" style="padding:10px 0">No exercises yet.</p>';
  const importState = isLocalProgram(program) ? null : programImportState(program, state.sheets);
  const actions = importState === null
    ? `<button class="button gold small" type="button" data-start-program="${html(program.address)}">Start workout</button>
      <button class="button ghost small" type="button" data-edit-sheet="${localSheetId(program)}">Edit</button>
      <button class="button danger small" type="button" data-del-sheet="${localSheetId(program)}">Delete</button>`
    : importState === 'in-library'
      ? '<button class="button ghost small" type="button" disabled>In library</button>'
      : `<button class="button ${importState === 'update' ? 'gold' : 'primary'} small" type="button" data-import-program="${html(program.address)}">${importState === 'update' ? 'Update' : 'Import'}</button>`;
  return `<div class="wk-ex-list">${exHtml}</div>
    <div class="workout-card-actions">
      ${actions}
    </div>`;
}
