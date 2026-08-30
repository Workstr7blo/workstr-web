import { canonMuscle } from '../../core/muscles';
import type { EmomBlock, Exercise, StraightBlock, TrainingStep } from '../../core/types';
import { displayWeightKg, normalizeWeightUnit } from '../../core/units';
import type { SheetWithExercises } from '../../db/store';
import type { RelayProgram } from '../../nostr/canon';
import type { AppState } from '../../app/state';
import { authorPill, difficultyBadgeClass, displayPubkey, exerciseImage, formatMinutes, html, programMuscleLabel } from '../../app/format';
import { paintBodyMapSvg } from '../../app/bodymap';
import { programDisplayTags } from './program-labels';
import { programActions, programZapButton, programZapStatus } from './program-zap-view';
export { PROGRAM_EQUIPMENT_LABELS, PROGRAM_FOCUS_LABELS, PROGRAM_FORMAT_LABELS, PROGRAM_GOALS, inferProgramLabels, programDisplayTags, programSearchTags, selectedProgramGoals } from './program-labels';

export interface BuilderRow { exerciseSlug: string; exerciseName: string; muscleGroup?: string; imageUrl?: string; sets: number; reps: string; restSec: number; weight: number | null; notes: string; sectionIndex: number; intervalIndex: number; durationSec: number; supersetWithPrevious?: boolean }

export interface BuilderEmomSection { rounds: number; intervalSec: number }

export interface BuilderState { sheetId?: number; name: string; desc: string; difficulty: string; tags: string[]; mode: 'normal' | 'emom' | 'mixed'; emomSections: BuilderEmomSection[]; rows: BuilderRow[]; library: Exercise[] }

export function emomBlockFromBuilder(rows: BuilderRow[], rounds: number, intervalSec: number): EmomBlock {
  const byInterval = new Map<number, BuilderRow[]>();
  for (const row of rows) {
    const index = Math.max(0, Math.floor(Number(row.intervalIndex) || 0));
    byInterval.set(index, [...(byInterval.get(index) || []), row]);
  }
  const lastIndex = Math.max(0, ...byInterval.keys());
  return {
    type: 'emom',
    rounds: Math.max(1, Math.floor(Number(rounds) || 1)),
    intervals: Array.from({ length: lastIndex + 1 }, (_, index) => ({
      durationSec: Math.max(1, Math.floor(Number(intervalSec) || 60)),
      steps: (byInterval.get(index) || []).map((row) => ({
        exerciseSlug: row.exerciseSlug,
        exerciseName: row.exerciseName,
        targetReps: row.reps || undefined,
        targetDurationSec: Number(row.durationSec) || undefined,
        weight: row.weight,
        notes: row.notes || undefined
      }))
    })).filter((interval) => interval.steps.length)
  };
}

export function emomBlocksFromBuilder(rows: BuilderRow[], sections: BuilderEmomSection[]): EmomBlock[] {
  return sections.map((section, sectionIndex) => emomBlockFromBuilder(
    rows.filter((row) => (row.sectionIndex || 0) === sectionIndex), section.rounds, section.intervalSec
  )).filter((block) => block.intervals.length);
}

export function straightBlocksFromBuilder(rows: BuilderRow[]): StraightBlock[] {
  const groups: BuilderRow[][] = [];
  for (const row of rows) {
    if (row.supersetWithPrevious && groups.length) groups.at(-1)!.push(row);
    else groups.push([row]);
  }
  return groups.filter((group) => group.length > 1).map((group) => ({
    type: 'straight',
    rounds: Math.max(1, ...group.map((row) => Math.floor(Number(row.sets) || 1))),
    steps: group.map((row) => ({
      exerciseSlug: row.exerciseSlug,
      exerciseName: row.exerciseName,
      targetReps: row.reps || undefined,
      weight: row.weight,
      notes: row.notes || undefined
    })),
    restAfterRoundSec: Math.max(0, Number(group.at(-1)?.restSec) || 0)
  }));
}

// Program members carry an address on relay programs and only a name on local sheets, so
// match block steps on either. Both sides are lowercased because the two paths disagree on case.
function stepKeys(steps: Array<{ exerciseSlug?: string; exerciseName?: string }>): string[] {
  return steps.flatMap((step) => [step.exerciseSlug, step.exerciseName].filter(Boolean).map((key) => String(key).toLowerCase()));
}

function memberKeys(member: RelayProgram['exercises'][number]): string[] {
  const slug = member.address ? member.address.split(':').pop() : '';
  return [slug, member.name].filter(Boolean).map((key) => String(key).toLowerCase());
}

// The members that belong to the strength half of a program: everything the EMOM blocks do
// not claim, plus superset members, which are strength work even when a slug repeats in an EMOM.
export function standardProgramExercises(exercises: RelayProgram['exercises'], blocks?: RelayProgram['blocks']): RelayProgram['exercises'] {
  const emomKeys = new Set((blocks || []).flatMap((block) => block.type === 'emom' ? stepKeys(block.intervals.flatMap((interval) => interval.steps)) : []));
  if (!emomKeys.size) return exercises;
  const straightKeys = new Set((blocks || []).flatMap((block) => block.type === 'straight' ? stepKeys(block.steps) : []));
  return exercises.filter((member) => {
    const keys = memberKeys(member);
    return !keys.some((key) => emomKeys.has(key)) || keys.some((key) => straightKeys.has(key));
  });
}

// Both halves of a program are estimated from one formula so a section total can never
// disagree with the card total the way an EMOM-only estimate used to.
export function emomSeconds(blocks?: RelayProgram['blocks']): number {
  return (blocks || []).reduce((total, block) => block.type === 'emom'
    ? total + block.rounds * block.intervals.reduce((sum, interval) => sum + interval.durationSec, 0)
    : total, 0);
}

export function strengthSeconds(exercises: RelayProgram['exercises']): number {
  return exercises.reduce((total, exercise) => {
    const sets = Number(exercise.sets) || 3;
    const rest = Number(exercise.restSec || exercise.rest) || 90;
    return total + sets * 45 + Math.max(0, sets - 1) * rest;
  }, 0);
}

export function estimateProgramMin(exercises: RelayProgram['exercises'], blocks?: RelayProgram['blocks']): number {
  return emomSeconds(blocks) + strengthSeconds(standardProgramExercises(exercises, blocks));
}

// Every timed step in schedule order. Members are matched against these one at a time so
// an exercise repeated across sections shows each section's own rounds and interval.
export interface EmomPlacement { section: number; block: EmomBlock; interval: EmomBlock['intervals'][number]; step: TrainingStep }

export function emomPlacements(blocks?: RelayProgram['blocks']): EmomPlacement[] {
  const placements: EmomPlacement[] = [];
  const emomBlocks = (blocks || []).filter((block): block is EmomBlock => block.type === 'emom');
  emomBlocks.forEach((block, section) => {
    block.intervals.forEach((interval) => {
      interval.steps.forEach((step) => placements.push({ section, block, interval, step }));
    });
  });
  return placements;
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
    difficulty: sheet.difficulty || '',
    tags: sheet.tags || [],
    blocks: sheet.blocks,
    sourceLabel: sheet.nostr_address ? 'in library' : 'local',
    eventId: sheet.nostr_event_id || '',
    pubkey: sheet.nostr_pubkey || '',
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

export function programCard(program: RelayProgram, state: AppState, options: { showZap?: boolean; zapRank?: number } = {}): string {
  const exerciseCount = standardProgramExercises(program.exercises, program.blocks).length;
  const time = formatMinutes(estimateProgramMin(program.exercises, program.blocks));
  const emomBlocks = program.blocks?.filter((block) => block.type === 'emom') || [];
  const emom = emomBlocks[0];
  const supersetCount = program.blocks?.filter((block) => block.type === 'straight' && block.steps.length > 1).length || 0;
  const groups = programGroups(program, state.exercises);
  const map = programMuscleMap(program, state.exercises);
  const emomLabel = emomBlocks.length > 1 ? `${emomBlocks.length}-section EMOM` : emom ? `${emom.rounds}-round EMOM` : '';
  const trainingLabel = [time || '', emomLabel, supersetCount ? `${supersetCount} superset${supersetCount === 1 ? '' : 's'}` : '', exerciseCount || !emomLabel ? `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const displayTags = programDisplayTags(program, state.exercises).slice(0, 2);
  const tagPills = displayTags.map((tag) => `<span class="tag-pill">${html(tag)}</span>`).join('');
  const isExpanded = state.expandedProgramAddress === program.address;
  const zapTotals = state.programZapTotals?.[program.address];
  const zapStats = options.showZap === false ? '' : `<div class="program-zap-stats">⚡ ${(zapTotals?.sats || 0).toLocaleString('en-US')} sats</div>`;
  const rank = options.zapRank && options.zapRank >= 1 && options.zapRank <= 3 ? options.zapRank : 0;
  const rankBadge = rank ? `<div class="program-zap-rank">#${rank} top zapped</div>` : '';
  const statusCls = isLocalProgram(program) ? 'local' : 'published';
  const fallbackMap = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg>';
  return `<div class="workout-card ${isExpanded ? 'expanded' : ''} ${rank ? `top-zapped rank-${rank}` : ''}" data-program-address="${html(program.address)}">
    <div class="workout-card-header" data-toggle-program="${html(program.address)}">
      <div class="workout-card-media">
        ${rankBadge}
        <div class="workout-card-map ${map ? 'has-map' : ''}">${map || fallbackMap}</div>
        ${options.showZap === false ? '' : programZapButton(program, state)}
      </div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(program.name)}</div>
        <div class="workout-card-meta">${trainingLabel}</div>
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(' · '))}</div>` : ''}
        <div class="program-badge-row"><span class="program-status ${statusCls}">${html(program.sourceLabel || 'Workstr')}</span>${program.difficulty ? `<span class="diff-badge inline ${difficultyBadgeClass(program.difficulty)}">${html(program.difficulty)}</span>` : ''}</div>
        ${tagPills ? `<div class="program-tag-grid">${tagPills}</div>` : ''}
        ${program.pubkey ? `<div class="workout-card-author">${programAuthorPill(program, state)}${zapStats}</div>` : zapStats}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body">${isExpanded ? programBody(program, state) : ''}</div>
  </div>`;
}

export function programBody(program: RelayProgram, state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const emomBlocks = program.blocks?.filter((block): block is EmomBlock => block.type === 'emom') || [];
  const supersets = program.blocks?.filter((block): block is StraightBlock => block.type === 'straight' && block.steps.length > 1) || [];
  const strengthMembers = new Set(standardProgramExercises(program.exercises, program.blocks));
  const members = program.exercises.map((member, index) => ({ member, index }));
  const strength = members.filter((entry) => strengthMembers.has(entry.member));
  const timed = members.filter((entry) => !strengthMembers.has(entry.member));
  // Only a program with both halves needs telling apart; a pure program reads better without headings.
  const split = emomBlocks.length > 0 && strength.length > 0;
  const placements = emomPlacements(program.blocks);
  const claimed = new Set<EmomPlacement>();

  // First unclaimed step matching the member, so repeats walk forward instead of all
  // reporting the first section.
  const takePlacement = (member: RelayProgram['exercises'][number]): EmomPlacement | null => {
    const keys = memberKeys(member);
    const match = (placement: EmomPlacement) => stepKeys([placement.step]).some((key) => keys.includes(key));
    const next = placements.find((placement) => !claimed.has(placement) && match(placement)) || placements.find(match);
    if (next) claimed.add(next);
    return next || null;
  };

  const exerciseRow = ({ member, index }: { member: RelayProgram['exercises'][number]; index: number }): string => {
    const full = resolveProgramExercise(member, state.exercises);
    const name = programExerciseName(member, full);
    const muscle = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name));
    const image = exerciseImage(member.imageUrl || full?.image_url);
    const placement = strengthMembers.has(member) ? null : takePlacement(member);
    const weightValue = displayWeightKg(member.weight, unit);
    const weight = weightValue != null ? ` @ ${html(String(weightValue))}` : '';
    let short: string;
    let grid: string;
    if (placement) {
      const rounds = placement.block.rounds;
      const work = Number(placement.step.targetDurationSec) || 0;
      const reps = placement.step.targetReps || member.reps || '';
      short = `${rounds} round${rounds === 1 ? '' : 's'} · ${placement.interval.durationSec}s${work ? ` · ${work}s work` : ''}${weight}`;
      grid = `<div class="wk-ex-detail-cell"><div class="val">${rounds}</div><div class="lbl">Rounds</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${placement.interval.durationSec}s</div><div class="lbl">Interval</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${work ? `${work}s` : html(String(reps || '—'))}</div><div class="lbl">${work ? 'Work' : 'Reps'}</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${weightValue != null ? html(String(weightValue)) : '—'}</div><div class="lbl">${unit}</div></div>`;
    } else {
      const sets = Number(member.sets) || 3;
      const reps = member.reps || String(full?.default_reps || '8-12');
      const rest = Number(member.restSec || member.rest || full?.default_rest) || 90;
      short = `${sets} × ${html(reps)}${weight}`;
      grid = `<div class="wk-ex-detail-cell"><div class="val">${sets}</div><div class="lbl">Sets</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${html(reps)}</div><div class="lbl">Reps</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${weightValue != null ? html(String(weightValue)) : '—'}</div><div class="lbl">${unit}</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${rest}s</div><div class="lbl">Rest</div></div>`;
    }
    return `<div class="wk-ex-item" data-exitem="${html(program.address)}-${index}">
      <div class="wk-ex-header" data-toggle-exitem="${html(program.address)}-${index}">
        <span class="wk-ex-index">${String(index + 1).padStart(2, '0')}</span>
        ${image}
        <div class="wk-ex-info">
          <div class="wk-ex-name">${html(name)}</div>
          <div class="wk-ex-short">${short}</div>
        </div>
        ${muscle ? `<span class="wk-ex-muscle-pill">${html(muscle)}</span>` : ''}
        <svg class="wk-ex-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wk-ex-detail">
        <div class="wk-ex-detail-grid">
          ${grid}
        </div>
        ${member.notes ? `<div class="wk-ex-detail-note">${html(member.notes)}</div>` : ''}
      </div>
    </div>`;
  };

  if (!program.exercises.length && !emomBlocks.length) {
    return `${programZapStatus(program, state)}<div class="wk-ex-list"><p class="empty" style="padding:10px 0">No exercises yet.</p></div>
    <div class="workout-card-actions">
      ${programActions(program, state)}
    </div>`;
  }

  const supersetLines = supersets.map((block, index) => `<span>Superset ${index + 1}: ${block.steps.map((step) => html(step.exerciseName || step.exerciseSlug)).join(' + ')} · ${block.rounds} rounds</span>`).join('');
  const strengthHead = split
    ? `<div class="program-section-summary"><strong>Strength · ${strength.length} exercise${strength.length === 1 ? '' : 's'}${supersets.length ? ` · ${supersets.length} superset${supersets.length === 1 ? '' : 's'}` : ''} · ${formatMinutes(strengthSeconds(strength.map((entry) => entry.member)))}</strong>${supersetLines}</div>`
    : supersets.length ? `<div class="program-section-summary"><strong>${supersets.length} superset${supersets.length === 1 ? '' : 's'}</strong>${supersetLines}</div>` : '';
  const strengthSection = strength.length ? `${strengthHead}<div class="wk-ex-list">${strength.map(exerciseRow).join('')}</div>` : strengthHead;

  const emomHead = emomBlocks.length
    ? `<div class="program-section-summary"><strong>${split ? 'EMOM · ' : ''}${emomBlocks.length} ${split ? `section${emomBlocks.length === 1 ? '' : 's'}` : `EMOM section${emomBlocks.length === 1 ? '' : 's'}`} · ${formatMinutes(emomSeconds(emomBlocks))}</strong>${emomBlocks.map((block, index) => `<span>Section ${index + 1}: ${block.rounds} round${block.rounds === 1 ? '' : 's'} · ${formatMinutes(block.rounds * block.intervals.reduce((sum, interval) => sum + interval.durationSec, 0))}</span>`).join('')}</div>`
    : '';
  const emomSection = emomBlocks.length ? `${emomHead}${timed.length ? `<div class="wk-ex-list">${timed.map(exerciseRow).join('')}</div>` : ''}` : '';
  const total = formatMinutes(estimateProgramMin(program.exercises, program.blocks));
  const focus = programGroups(program, state.exercises).join(' · ') || `${program.exercises.length} exercise${program.exercises.length === 1 ? '' : 's'}`;
  const plan = emomBlocks.length
    ? `<div class="program-timeline">${emomBlocks.map((block, index) => `<span><strong>${formatMinutes(block.rounds * block.intervals.reduce((sum, interval) => sum + interval.durationSec, 0))}</strong><small>Section ${index + 1}</small></span>`).join('')}</div>`
    : '';
  const overview = `<div class="program-preview"><div class="program-preview-main"><strong>${total}</strong><span>${html(focus)}</span></div>${plan}</div>`;
  const zapStatus = programZapStatus(program, state);

  // Strength first, then EMOM: the same order the live runner trains them in.
  return `${overview}${zapStatus}${strengthSection}${emomSection}
    <div class="workout-card-actions">
      ${programActions(program, state)}
    </div>`;
}
