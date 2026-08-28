import type { StraightBlock } from '../core/types';
import { normalizeWeightUnit, storeWeightInput } from '../core/units';
import type { SheetWithExercises } from '../db/store';
import { builderRowsMarkup } from '../features/sheets/builder-views';
import { emomBlocksFromBuilder, inferProgramLabels, PROGRAM_GOALS, selectedProgramGoals, straightBlocksFromBuilder, type BuilderState } from '../features/sheets/views';
import { html } from './format';
import type { AppState } from './state';

const PROGRAM_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
function tagLabel(tag: string): string {
  return tag.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function builderProgram(current: BuilderState) {
  const normalRows = current.rows.filter((row) => row.sectionIndex < 0);
  const emomRows = current.rows.filter((row) => row.sectionIndex >= 0);
  const blocks = [
    ...(current.mode !== 'emom' ? straightBlocksFromBuilder(normalRows) : []),
    ...(current.mode !== 'normal' ? emomBlocksFromBuilder(emomRows, current.emomSections) : [])
  ];
  return {
    slug: 'preview',
    name: current.name || 'New program',
    description: current.desc,
    difficulty: current.difficulty,
    tags: current.tags,
    sourceLabel: 'local',
    eventId: '',
    pubkey: '',
    address: 'local:preview',
    createdAt: 0,
    blocks,
    exercises: current.rows.map((row) => ({ address: '', name: row.exerciseName, muscleGroup: row.muscleGroup, sets: row.sets, reps: row.reps, restSec: row.restSec, weight: row.weight != null ? String(row.weight) : undefined }))
  };
}

function builderAutoLabelMarkup(current: BuilderState): string {
  const autoLabels = inferProgramLabels(builderProgram(current), current.library).filter((tag) => !PROGRAM_GOALS.includes(tag));
  return autoLabels.length ? autoLabels.map((tag) => `<span class="tag-pill auto">${html(tag)}</span>`).join('') : '<span class="builder-auto-empty">Add exercises to detect split, equipment, and format.</span>';
}

function refreshAutoLabels(current: BuilderState): void {
  const host = document.getElementById('builder-auto-label-values');
  if (host) host.innerHTML = builderAutoLabelMarkup(current);
}

export interface ProgramBuilderContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  openModal(content: string): void;
  closeModal(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
}

export interface ProgramBuilderController {
  open(sheet?: SheetWithExercises | null): Promise<void>;
  renderIfOpen(): void;
  clear(): void;
}

export function createProgramBuilder(ctx: ProgramBuilderContext): ProgramBuilderController {
  const { root, state, render, openModal, closeModal, toast } = ctx;
  let builder: BuilderState | null = null;

async function open(sheet: SheetWithExercises | null = null): Promise<void> {
  if (!state.store) { toast('Sign in to create programs.', 'bad'); return; }
  // Programs are built from the user's library only, never the relay catalog.
  const library = await state.store.listExercises();
  const emomBlocks = sheet?.blocks?.filter((block) => block.type === 'emom') || [];
  const straightBlocks = sheet?.blocks?.filter((block): block is StraightBlock => block.type === 'straight' && block.steps.length > 1) || [];
  const supersetSlugs = new Set(straightBlocks.flatMap((block) => block.steps.slice(1).map((step) => step.exerciseSlug)));
  const straightExerciseSlugs = new Set(straightBlocks.flatMap((block) => block.steps.map((step) => step.exerciseSlug)));
  const emomExerciseSlugs = new Set(emomBlocks.flatMap((block) => block.intervals.flatMap((interval) => interval.steps.map((step) => step.exerciseSlug))));
  const emomRows = emomBlocks.flatMap((emom, sectionIndex) => emom.intervals.flatMap((interval, intervalIndex) => interval.steps.map((step) => {
    const row = sheet?.exercises.find((candidate) => candidate.exercise_slug === step.exerciseSlug);
    const exercise = library.find((candidate) => candidate.slug === step.exerciseSlug);
    return {
      exerciseSlug: step.exerciseSlug,
      exerciseName: step.exerciseName || row?.exercise_name || exercise?.name || step.exerciseSlug,
      muscleGroup: row?.muscle_group || exercise?.muscle_group,
      imageUrl: row?.image_url || exercise?.image_url,
      sets: emom.rounds,
      reps: step.targetReps || String(row?.reps ?? ''),
      restSec: interval.durationSec,
      weight: step.weight ?? row?.weight ?? null,
      notes: step.notes || row?.notes || '',
      sectionIndex,
      intervalIndex,
      durationSec: Number(step.targetDurationSec) || 0
    };
  })));
  const normalRows = sheet
    ? sheet.exercises.filter((row) => !emomExerciseSlugs.has(row.exercise_slug || '') || straightExerciseSlugs.has(row.exercise_slug || '')).map((row) => ({
        exerciseSlug: row.exercise_slug || '',
        exerciseName: row.exercise_name || row.exercise_slug || 'Exercise',
        muscleGroup: row.muscle_group,
        imageUrl: row.image_url,
        sets: Number(row.sets) || 3,
        reps: String(row.reps ?? '8-12'),
        restSec: Number(row.rest) || 90,
        weight: row.weight ?? null,
        notes: row.notes || '',
        sectionIndex: -1,
        intervalIndex: 0,
        durationSec: 0,
        supersetWithPrevious: supersetSlugs.has(row.exercise_slug || '')
      }))
    : [];
  builder = {
    sheetId: sheet?.id,
    name: sheet?.name || '',
    desc: sheet?.notes || '',
    difficulty: sheet?.difficulty || '',
    tags: sheet?.tags || [],
    mode: emomBlocks.length && normalRows.length ? 'mixed' : emomBlocks.length ? 'emom' : 'normal',
    emomSections: emomBlocks.length ? emomBlocks.map((emom) => ({ rounds: emom.rounds, intervalSec: 60 })) : [{ rounds: 10, intervalSec: 60 }],
    library,
    rows: [...normalRows, ...emomRows]
  };
  renderModal();
}

function renderModal(): void {
  const current = builder;
  if (!current) return;
  const difficultyOptions = [''].concat(PROGRAM_DIFFICULTIES).map((difficulty) => `<option value="${html(difficulty)}" ${current.difficulty === difficulty ? 'selected' : ''}>${difficulty ? html(difficulty) : 'Choose level'}</option>`).join('');
  const goals = selectedProgramGoals(current.tags);
  const goalChips = PROGRAM_GOALS.map((goal) => `<button class="goal-chip ${goals.includes(goal) ? 'active' : ''}" type="button" data-goal="${html(goal)}" aria-pressed="${goals.includes(goal) ? 'true' : 'false'}">${html(tagLabel(goal))}</button>`).join('');
  const autoLabelMarkup = builderAutoLabelMarkup(current);
  openModal(`
    <div class="program-builder">
    <h3>${current.sheetId ? 'Edit program' : 'New program'}</h3>
    <div class="form-grid program-builder-basics">
      <label class="span-2">Name<input id="sheet-name" value="${html(current.name)}" placeholder="Push Day" /></label>
      <label class="span-2">Description<input id="sheet-desc" value="${html(current.desc)}" placeholder="optional" /></label>
      <label>Difficulty<select id="sheet-difficulty">${difficultyOptions}</select></label>
      <label>Training mode<select id="sheet-mode"><option value="normal" ${current.mode === 'normal' ? 'selected' : ''}>Normal sets</option><option value="emom" ${current.mode === 'emom' ? 'selected' : ''}>EMOM</option><option value="mixed" ${current.mode === 'mixed' ? 'selected' : ''}>Mixed sections</option></select></label>
    </div>
    <div class="builder-goals"><div class="subsection-head"><span>Goal</span><small>Choose up to two. Workstr detects split and equipment.</small></div><div class="builder-goal-grid">${goalChips}</div></div>
    <div class="builder-auto-labels"><span>Auto labels</span><div id="builder-auto-label-values">${autoLabelMarkup}</div></div>
    ${current.mode !== 'emom'
      ? `<div class="subsection-head"><span>Add normal exercises from your library</span></div>
        <div class="builder-search-wrap"><input id="builder-search" class="builder-search" placeholder="Filter your library..." autocomplete="off" /></div>
        <div id="builder-picker" class="builder-picker"></div>
        <div class="subsection-head"><span>Normal strength section</span></div>`
      : `<div class="subsection-head"><span>EMOM sections</span></div>`}
    <div id="builder-rows" class="builder-rows"></div>
    ${current.mode !== 'normal' ? '<button class="button ghost emom-add-section" id="add-emom-section" type="button">+ Add EMOM section</button>' : ''}
    <div class="form-actions"><button class="button primary" id="sheet-save" type="button">${current.sheetId ? 'Save program' : 'Create program'}</button></div>
    </div>`);
  renderRows();
  root.querySelector('#sheet-name')?.addEventListener('input', (event) => { current.name = (event.target as HTMLInputElement).value; });
  root.querySelector('#sheet-desc')?.addEventListener('input', (event) => { current.desc = (event.target as HTMLInputElement).value; });
  root.querySelector('#sheet-difficulty')?.addEventListener('change', (event) => { current.difficulty = (event.target as HTMLSelectElement).value; });
  root.querySelectorAll<HTMLElement>('[data-goal]').forEach((button) => button.addEventListener('click', () => {
    const goal = button.dataset.goal || '';
    const selected = selectedProgramGoals(current.tags);
    current.tags = selected.includes(goal)
      ? selected.filter((tag) => tag !== goal)
      : [...selected, goal].slice(0, 2);
    renderModal();
  }));
  root.querySelector('#sheet-mode')?.addEventListener('change', (event) => {
    const mode = (event.target as HTMLSelectElement).value;
    current.mode = mode === 'emom' || mode === 'mixed' ? mode : 'normal';
    renderModal();
  });
  root.querySelector('#add-emom-section')?.addEventListener('click', () => { current.emomSections.push({ rounds: 10, intervalSec: 60 }); renderModal(); });
  const search = root.querySelector<HTMLInputElement>('#builder-search');
  const picker = root.querySelector<HTMLElement>('#builder-picker');
  const sorted = [...current.library].sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name));
  const renderPicker = () => {
    if (!picker) return;
    if (!sorted.length) { picker.innerHTML = '<div class="ex-search-empty">Your library is empty. Import exercises from the Discover tab.</div>'; return; }
    const query = (search?.value || '').trim().toLowerCase();
    const matches = query
      ? sorted.filter((exercise) => exercise.name.toLowerCase().includes(query) || (exercise.muscle_group || '').toLowerCase().includes(query))
      : sorted;
    if (!matches.length) { picker.innerHTML = '<div class="ex-search-empty">No exercises match.</div>'; return; }
    picker.innerHTML = matches.map((exercise) => {
      const added = current.rows.some((row) => row.exerciseSlug === exercise.slug && row.sectionIndex < 0);
      return `<div class="builder-pick-item${added ? ' added' : ''}" data-pick-slug="${html(exercise.slug)}">
        <div class="builder-pick-info">
          <div class="builder-pick-name">${html(exercise.name)}</div>
          ${exercise.muscle_group ? `<div class="builder-pick-muscle">${html(exercise.muscle_group)}</div>` : ''}
        </div>
        <span class="builder-pick-state">${added
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'}</span>
      </div>`;
    }).join('');
  };
  renderPicker();
  search?.addEventListener('input', renderPicker);
  picker?.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLElement>('[data-pick-slug]');
    if (!item) return;
    const exercise = current.library.find((entry) => entry.slug === item.dataset.pickSlug);
    if (!exercise) return;
    const index = current.rows.findIndex((row) => row.exerciseSlug === exercise.slug && row.sectionIndex < 0);
    if (index >= 0 && current.mode !== 'emom') {
      current.rows.splice(index, 1);
    } else if (current.mode !== 'emom' && current.rows.some((row) => row.exerciseSlug === exercise.slug && row.sectionIndex >= 0)) {
      toast(`${exercise.name} is already in an EMOM section`, 'bad');
      return;
    } else {
      current.rows.push({
        exerciseSlug: exercise.slug,
        exerciseName: exercise.name,
        muscleGroup: exercise.muscle_group,
        imageUrl: exercise.image_url,
        sets: Number(exercise.default_sets) || 3,
        reps: String(exercise.default_reps || '8-12'),
        restSec: Number(exercise.default_rest) || 90,
        weight: null,
        notes: '',
        sectionIndex: current.mode === 'emom' ? current.emomSections.length - 1 : -1,
        intervalIndex: current.mode === 'emom' ? Math.max(0, ...current.rows.filter((row) => row.sectionIndex === current.emomSections.length - 1).map((row) => row.intervalIndex), 0) : 0,
        durationSec: 0
      });
    }
    renderRows();
    renderPicker();
  });
  const rowsHost = root.querySelector<HTMLElement>('#builder-rows');
  rowsHost?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const sectionHost = target.closest<HTMLElement>('[data-section]');
    const section = sectionHost ? current.emomSections[Number(sectionHost.dataset.section)] : undefined;
    if (section && target.dataset.sectionField === 'rounds') { section.rounds = Math.max(1, Number(target.value) || 1); return; }
    if (section && target.dataset.sectionField === 'intervalSec') { section.intervalSec = Math.max(1, Number(target.value) || 60); return; }
    const row = target.closest<HTMLElement>('[data-i]');
    const entry = row ? current.rows[Number(row.dataset.i)] : undefined;
    const field = target.dataset.f;
    if (!entry || !field) return;
    if (field === 'sets') entry.sets = Number(target.value) || 0;
    else if (field === 'restSec') entry.restSec = Number(target.value) || 0;
    else if (field === 'intervalIndex') entry.intervalIndex = Math.max(0, (Number(target.value) || 1) - 1);
    else if (field === 'durationSec') entry.durationSec = Math.max(0, Number(target.value) || 0);
    else if (field === 'targetValue') {
      const type = target.dataset.targetType;
      if (type === 'seconds') { entry.durationSec = Math.max(0, Number(target.value) || 0); entry.reps = ''; }
      else if (type === 'reps') { entry.reps = target.value; entry.durationSec = 0; }
    }
    else if (field === 'weight') entry.weight = storeWeightInput(target.value, normalizeWeightUnit(state.settings.unit));
    else if (field === 'reps') entry.reps = target.value;
  });
  rowsHost?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    if (target.dataset.targetType == null) return;
    const entry = current.rows[Number(target.dataset.targetType)];
    if (!entry) return;
    if (target.value === 'seconds') { entry.durationSec = Number(entry.durationSec) || 40; entry.reps = ''; }
    else if (target.value === 'reps') { entry.reps = entry.reps || '5'; entry.durationSec = 0; }
    else { entry.reps = ''; entry.durationSec = 0; }
    renderRows();
  });
  rowsHost?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const pickerToggle = target.closest<HTMLElement>('[data-toggle-section-picker]');
    if (pickerToggle) {
      const picker = rowsHost.querySelector<HTMLElement>(`[data-section-picker="${pickerToggle.dataset.toggleSectionPicker}"]`);
      picker?.toggleAttribute('hidden');
      return;
    }
    const exerciseChoice = target.closest<HTMLElement>('[data-section-exercise]');
    if (exerciseChoice) {
      const sectionIndex = Number(exerciseChoice.dataset.sectionExercise);
      const exercise = current.library.find((entry) => entry.slug === exerciseChoice.dataset.slug);
      if (!exercise) return;
      // Sets are keyed by slug, so an exercise in both halves cannot be told apart at log time.
      if (current.rows.some((row) => row.exerciseSlug === exercise.slug && row.sectionIndex < 0)) {
        toast(`${exercise.name} is already in the strength section`, 'bad');
        return;
      }
      current.rows.push({ exerciseSlug: exercise.slug, exerciseName: exercise.name, muscleGroup: exercise.muscle_group, imageUrl: exercise.image_url,
        sets: 1, reps: String(exercise.default_reps || '5'), restSec: 60, weight: null, notes: '', sectionIndex,
        intervalIndex: Math.max(-1, ...current.rows.filter((row) => row.sectionIndex === sectionIndex).map((row) => row.intervalIndex)) + 1,
        durationSec: 0 });
      renderRows();
      return;
    }
    if (target.dataset.rm != null) { current.rows.splice(Number(target.dataset.rm), 1); renderRows(); renderPicker(); return; }
    if (target.dataset.toggleSuperset != null) {
      const index = Number(target.dataset.toggleSuperset);
      if (index > 0 && current.rows[index]) {
        current.rows[index].supersetWithPrevious = !current.rows[index].supersetWithPrevious;
        if (current.rows[index].supersetWithPrevious) current.rows[index].sets = current.rows[index - 1].sets;
        renderRows();
      }
      return;
    }
    if (target.dataset.removeSection != null) {
      const removed = Number(target.dataset.removeSection);
      current.emomSections.splice(removed, 1);
      current.rows = current.rows.filter((row) => row.sectionIndex !== removed).map((row) => ({ ...row, sectionIndex: row.sectionIndex > removed ? row.sectionIndex - 1 : row.sectionIndex }));
      renderRows();
    } else if (target.dataset.moveSection != null) {
      const from = Number(target.dataset.moveSection);
      const to = from + Number(target.dataset.dir);
      if (to < 0 || to >= current.emomSections.length) return;
      [current.emomSections[from], current.emomSections[to]] = [current.emomSections[to], current.emomSections[from]];
      current.rows.forEach((row) => { if (row.sectionIndex === from) row.sectionIndex = to; else if (row.sectionIndex === to) row.sectionIndex = from; });
      renderRows();
    } else if (target.dataset.move != null) {
      const index = Number(target.dataset.move);
      const sectionRows = current.rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row }) => row.sectionIndex === current.rows[index]?.sectionIndex);
      const position = sectionRows.findIndex(({ rowIndex }) => rowIndex === index);
      const next = sectionRows[position + Number(target.dataset.dir)]?.rowIndex;
      if (next != null) {
        [current.rows[index], current.rows[next]] = [current.rows[next], current.rows[index]];
        renderRows();
      }
    }
  });
  root.querySelector('#sheet-save')?.addEventListener('click', async () => {
    if (!state.store || !builder) return;
    const name = builder.name.trim();
    if (!name) { toast('name is required', 'bad'); return; }
    const normalRows = builder.rows.filter((row) => row.sectionIndex < 0);
    const emomRows = builder.rows.filter((row) => row.sectionIndex >= 0);
    const normalBlocks = builder.mode !== 'emom' ? straightBlocksFromBuilder(normalRows) : [];
    const emomBlocks = builder.mode !== 'normal' ? emomBlocksFromBuilder(emomRows, builder.emomSections) : [];
    const blocks = [...normalBlocks, ...emomBlocks].length ? [...normalBlocks, ...emomBlocks] : undefined;
    if (builder.mode !== 'normal') {
      if (!emomBlocks.length) { toast('Add an exercise to an EMOM section', 'bad'); return; }
      const invalid = emomBlocks.some((block) => block.intervals.some((interval) => interval.steps.reduce((sum, step) => sum + (Number(step.targetDurationSec) || 0), 0) > interval.durationSec));
      if (invalid) { toast('Timed steps cannot exceed the interval length', 'bad'); return; }
    }
    await state.store.saveSheet({
      name,
      notes: builder.desc.trim(),
      difficulty: builder.difficulty,
      tags: [...new Set([...selectedProgramGoals(builder.tags), ...inferProgramLabels(builderProgram(builder), builder.library)])],
      blocks,
      exercises: builder.rows.map((row, index) => ({
        exercise_slug: row.exerciseSlug,
        exercise_name: row.exerciseName,
        muscle_group: row.muscleGroup,
        image_url: row.imageUrl,
        sets: row.sectionIndex >= 0
          ? current.emomSections[row.sectionIndex]?.rounds || 1
          : normalBlocks.find((block) => block.steps.some((step) => step.exerciseSlug === row.exerciseSlug))?.rounds || row.sets,
        reps: row.reps,
        rest: row.restSec,
        weight: row.weight,
        notes: row.notes,
        position: index
      }))
    }, current.sheetId);
    builder = null;
    state.sheets = await state.store.listSheets();
    closeModal();
    render();
    toast('Program saved');
  });
}

function renderRows(): void {
  const host = root.querySelector<HTMLElement>('#builder-rows');
  const current = builder;
  if (!host || !current) return;
  host.innerHTML = builderRowsMarkup(current, normalizeWeightUnit(state.settings.unit));
  refreshAutoLabels(current);
}

  return { open, renderIfOpen: renderModal, clear: () => { builder = null; } };
}
