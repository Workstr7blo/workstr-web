import type { StraightBlock } from '../core/types';
import { displayWeightKg, normalizeWeightUnit, storeWeightInput } from '../core/units';
import type { SheetWithExercises } from '../db/store';
import { emomBlocksFromBuilder, straightBlocksFromBuilder, type BuilderState } from '../features/sheets/views';
import { formatMinutes, html } from './format';
import type { AppState } from './state';

const PROGRAM_DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'Beast Mode'];
const tagsFromCsv = (value: string): string[] => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];

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
  builder = {
    sheetId: sheet?.id,
    name: sheet?.name || '',
    desc: sheet?.notes || '',
    difficulty: sheet?.difficulty || '',
    tags: sheet?.tags || [],
    mode: emomBlocks.length ? 'emom' : 'normal',
    emomSections: emomBlocks.length ? emomBlocks.map((emom) => ({ rounds: emom.rounds, intervalSec: 60 })) : [{ rounds: 10, intervalSec: 60 }],
    library,
    rows: emomRows.length ? emomRows : sheet
      ? sheet.exercises.map((row) => ({
          exerciseSlug: row.exercise_slug || '',
          exerciseName: row.exercise_name || row.exercise_slug || 'Exercise',
          muscleGroup: row.muscle_group,
          imageUrl: row.image_url,
          sets: Number(row.sets) || 3,
          reps: String(row.reps ?? '8-12'),
          restSec: Number(row.rest) || 90,
          weight: row.weight ?? null,
          notes: row.notes || '',
          sectionIndex: 0,
          intervalIndex: 0,
          durationSec: 0,
          supersetWithPrevious: straightBlocks.some((block) => block.steps.findIndex((step) => step.exerciseSlug === row.exercise_slug) > 0)
        }))
      : []
  };
  renderModal();
}

function renderModal(): void {
  const current = builder;
  if (!current) return;
  const difficultyOptions = [''].concat(PROGRAM_DIFFICULTIES).map((difficulty) => `<option value="${html(difficulty)}" ${current.difficulty === difficulty ? 'selected' : ''}>${difficulty ? html(difficulty) : 'Choose level'}</option>`).join('');
  openModal(`
    <div class="program-builder">
    <h3>${current.sheetId ? 'Edit program' : 'New program'}</h3>
    <div class="form-grid program-builder-basics">
      <label class="span-2">Name<input id="sheet-name" value="${html(current.name)}" placeholder="Push Day" /></label>
      <label class="span-2">Description<input id="sheet-desc" value="${html(current.desc)}" placeholder="optional" /></label>
      <label>Difficulty<select id="sheet-difficulty">${difficultyOptions}</select></label>
      <label>Tags (comma)<input id="sheet-tags" value="${html(current.tags.join(', '))}" placeholder="strength, hypertrophy" /></label>
      <label>Training mode<select id="sheet-mode"><option value="normal" ${current.mode === 'normal' ? 'selected' : ''}>Normal sets</option><option value="emom" ${current.mode === 'emom' ? 'selected' : ''}>EMOM</option></select></label>
    </div>
    ${current.mode === 'emom'
      ? `<div class="subsection-head"><span>EMOM sections</span></div>`
      : `<div class="subsection-head"><span>Add from your library</span></div>
        <div class="builder-search-wrap"><input id="builder-search" class="builder-search" placeholder="Filter your library..." autocomplete="off" /></div>
        <div id="builder-picker" class="builder-picker"></div>
        <div class="subsection-head"><span>Program exercises</span></div>`}
    <div id="builder-rows" class="builder-rows"></div>
    ${current.mode === 'emom' ? '<button class="button ghost emom-add-section" id="add-emom-section" type="button">+ Add EMOM section</button>' : ''}
    <div class="form-actions"><button class="button primary" id="sheet-save" type="button">${current.sheetId ? 'Save program' : 'Create program'}</button></div>
    </div>`);
  renderRows();
  root.querySelector('#sheet-name')?.addEventListener('input', (event) => { current.name = (event.target as HTMLInputElement).value; });
  root.querySelector('#sheet-desc')?.addEventListener('input', (event) => { current.desc = (event.target as HTMLInputElement).value; });
  root.querySelector('#sheet-difficulty')?.addEventListener('change', (event) => { current.difficulty = (event.target as HTMLSelectElement).value; });
  root.querySelector('#sheet-tags')?.addEventListener('input', (event) => { current.tags = tagsFromCsv((event.target as HTMLInputElement).value); });
  root.querySelector('#sheet-mode')?.addEventListener('change', (event) => {
    current.mode = (event.target as HTMLSelectElement).value === 'emom' ? 'emom' : 'normal';
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
      const added = current.rows.some((row) => row.exerciseSlug === exercise.slug);
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
    const index = current.rows.findIndex((row) => row.exerciseSlug === exercise.slug);
    if (index >= 0 && current.mode === 'normal') {
      current.rows.splice(index, 1);
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
        sectionIndex: current.mode === 'emom' ? current.emomSections.length - 1 : 0,
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
      current.rows.push({ exerciseSlug: exercise.slug, exerciseName: exercise.name, muscleGroup: exercise.muscle_group, imageUrl: exercise.image_url,
        sets: 1, reps: String(exercise.default_reps || '5'), restSec: 60, weight: null, notes: '', sectionIndex, intervalIndex: 0, durationSec: 0 });
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
    const normalBlocks = builder.mode === 'normal' ? straightBlocksFromBuilder(builder.rows) : [];
    const blocks = builder.mode === 'emom' ? emomBlocksFromBuilder(builder.rows, builder.emomSections) : normalBlocks.length ? normalBlocks : undefined;
    if (builder.mode === 'emom') {
      if (!blocks?.length) { toast('Add an exercise to an EMOM section', 'bad'); return; }
      const invalid = blocks.some((block) => block.type === 'emom' && block.intervals.some((interval) => interval.steps.reduce((sum, step) => sum + (Number(step.targetDurationSec) || 0), 0) > interval.durationSec));
      if (invalid) { toast('Timed steps cannot exceed the interval length', 'bad'); return; }
    }
    await state.store.saveSheet({
      name,
      notes: builder.desc.trim(),
      difficulty: builder.difficulty,
      tags: builder.tags,
      blocks,
      exercises: builder.rows.map((row, index) => ({
        exercise_slug: row.exerciseSlug,
        exercise_name: row.exerciseName,
        muscle_group: row.muscleGroup,
        image_url: row.imageUrl,
        sets: current.mode === 'emom'
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
  const unit = normalizeWeightUnit(state.settings.unit);
  const rowMarkup = (row: BuilderState['rows'][number], index: number): string => {
    const targetType = row.durationSec ? 'seconds' : row.reps ? 'reps' : 'open';
    const targetValue = targetType === 'seconds' ? row.durationSec : targetType === 'reps' ? row.reps : '';
    if (current.mode === 'emom') {
      return `<div class="emom-prescription-row" data-i="${index}">
        <div class="emom-rx-name">
          <strong>${html(row.exerciseName)}</strong>
          ${row.muscleGroup ? `<small>${html(row.muscleGroup)}</small>` : ''}
        </div>
        <div class="emom-rx-target">
          <select class="emom-rx-type" aria-label="Target type for ${html(row.exerciseName)}" data-target-type="${index}">
            <option value="reps" ${targetType === 'reps' ? 'selected' : ''}>Reps</option>
            <option value="seconds" ${targetType === 'seconds' ? 'selected' : ''}>Seconds</option>
            <option value="open" ${targetType === 'open' ? 'selected' : ''}>Open</option>
          </select>
          ${targetType !== 'open' ? `<input class="emom-rx-value" aria-label="${targetType === 'reps' ? 'Repetitions' : 'Work seconds'} for ${html(row.exerciseName)}" type="number" min="1" max="999" data-f="targetValue" data-target-type="${targetType}" value="${html(String(targetValue))}">` : '<span class="emom-rx-open">open</span>'}
        </div>
        <button class="emom-rx-remove" type="button" data-rm="${index}" title="Remove ${html(row.exerciseName)}">✕</button>
      </div>`;
    }
    const src = row.imageUrl || current.library.find((exercise) => exercise.slug === row.exerciseSlug)?.image_url;
    const img = src
      ? `<img class="wex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wex-img placeholder'}))">`
      : `<div class="wex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg></div>`;
    return `<div class="wex-row" data-i="${index}">
      <div class="wex-move-btns">
        <button class="wex-move-btn" type="button" data-move="${index}" data-dir="-1" title="Move up">↑</button>
        <button class="wex-move-btn" type="button" data-move="${index}" data-dir="1" title="Move down">↓</button>
      </div>
      ${img}
      <div class="wex-info">
        <div class="wex-name">${html(row.exerciseName)}${row.muscleGroup ? `<span class="wex-muscle">${html(row.muscleGroup)}</span>` : ''}</div>
        <div class="wex-params">
          <div class="wex-param-group"><div class="wex-param-label">Sets</div><input class="wex-param-input" type="number" min="1" max="20" data-f="sets" value="${row.sets}"></div>
          <div class="wex-param-group"><div class="wex-param-label">Reps</div><input class="wex-param-input reps" data-f="reps" value="${html(row.reps)}"></div>
          <div class="wex-param-group"><div class="wex-param-label">${unit}</div><input class="wex-param-input" type="number" min="0" step="0.5" data-f="weight" placeholder="—" value="${row.weight != null ? displayWeightKg(row.weight, unit) : ''}"></div>
          <div class="wex-param-group"><div class="wex-param-label">Rest</div><input class="wex-param-input" type="number" min="0" step="5" data-f="restSec" value="${row.restSec}"></div>
        </div>
        ${index > 0 ? `<button class="wex-superset-toggle ${row.supersetWithPrevious ? 'active' : ''}" type="button" data-toggle-superset="${index}" aria-pressed="${row.supersetWithPrevious ? 'true' : 'false'}">${row.supersetWithPrevious ? 'Linked in superset' : 'Pair with previous'}</button>` : ''}
      </div>
      <button class="wex-remove" type="button" data-rm="${index}" title="Remove">✕</button>
    </div>`;
  };
  if (current.mode === 'normal') {
    host.innerHTML = current.rows.length ? current.rows.map(rowMarkup).join('') : '<div class="empty" style="padding:8px 0">No exercises yet. Search above to add.</div>';
    return;
  }
  const exerciseOptions = [...current.library]
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))
    .map((exercise) => `<button type="button" data-section-exercise="SECTION_INDEX" data-slug="${html(exercise.slug)}">${html(exercise.name)}</button>`).join('');
  host.innerHTML = `<div class="emom-section-list">${current.emomSections.map((section, sectionIndex) => {
    const rows = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sectionIndex === sectionIndex);
    const sectionSeconds = section.rounds * section.intervalSec;
    const summary = `${section.rounds} min · every ${formatMinutes(section.intervalSec / 60) || '1 min'} · ${rows.length} move${rows.length === 1 ? '' : 's'}`;
    const sectionActions = current.emomSections.length > 1
      ? `<div class="emom-section-actions">
          <button type="button" data-move-section="${sectionIndex}" data-dir="-1" title="Move section up" ${sectionIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move-section="${sectionIndex}" data-dir="1" title="Move section down" ${sectionIndex === current.emomSections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-remove-section="${sectionIndex}" title="Remove section">✕</button>
        </div>`
      : '';
    return `<section class="emom-section-card" data-section="${sectionIndex}">
      <div class="emom-section-header">
        <div class="emom-section-title"><strong>Section ${sectionIndex + 1}</strong><span>${html(summary)}</span></div>
        ${sectionActions}
      </div>
      <div class="emom-section-settings">
        <label class="emom-duration-inline"><span>Duration</span><input data-section-field="rounds" type="number" min="1" max="999" value="${section.rounds}"><strong>min</strong></label>
        <small>${Math.ceil(sectionSeconds / 60)} rounds · every 1:00</small>
      </div>
      <div class="emom-section-exercises">
        <div class="emom-section-exercise-head"><span>Every minute</span><button class="button ghost small" type="button" data-toggle-section-picker="${sectionIndex}">+ Add move</button></div>
        <div class="emom-library-picker" data-section-picker="${sectionIndex}" hidden>${exerciseOptions.replaceAll('SECTION_INDEX', String(sectionIndex)) || '<div class="empty">Your library is empty.</div>'}</div>
        ${rows.length ? `<div class="emom-rx-list">${rows.map(({ row, index }) => rowMarkup(row, index)).join('')}</div>` : '<div class="empty emom-section-empty">Choose one exercise for this section.</div>'}
      </div>
    </section>`;
  }).join('')}</div>`;
}

  return { open, renderIfOpen: renderModal, clear: () => { builder = null; } };
}
