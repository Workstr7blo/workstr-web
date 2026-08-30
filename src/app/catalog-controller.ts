import { canonMuscle } from '../core/muscles';
import type { Exercise } from '../core/types';
import { CANON_RELAYS, canonCacheSnapshot, fetchCanonExercises, fetchCanonPrograms, primeCanonCache, type RelayProgram } from '../nostr/canon';
import type { RelayProfile } from '../nostr/pool';
import { planProgramImport, programImportState } from '../nostr/programImport';
import { fetchProgramZapTotals } from '../nostr/zaps';
import { discoverImportState } from '../features/discover/views';
import { paintBodyMapSvg } from './bodymap';
import { EX_PLACEHOLDER, exerciseSourceLabel, html } from './format';
import type { AppState } from './state';

export interface CatalogControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  closeModal(): void;
  fetchProfile(pubkey: string, relays?: string[]): Promise<RelayProfile | null>;
}

export function createCatalogController(ctx: CatalogControllerContext) {
  const { root, state, render, toast, openModal, closeModal, fetchProfile } = ctx;

function refreshMergedExercises(): void {
  const seen = new Set(state.library.map((exercise) => exercise.slug));
  state.exercises = [...state.library, ...state.discoverExercises.filter((exercise) => !seen.has(exercise.slug))];
}

async function reloadLibrary(): Promise<void> {
  state.library = state.store ? await state.store.listExercises() : [];
  refreshMergedExercises();
}

// Persist the verified canon snapshot in settings so Discover opens
// instantly and works offline on the next launch.
async function persistCanonCache(): Promise<void> {
  if (!state.store) return;
  const snapshot = canonCacheSnapshot();
  if (!snapshot) return;
  state.settings = { ...state.settings, canonCache: snapshot };
  await state.store.saveSettings(state.settings);
}

async function refreshExercises(): Promise<void> {
  state.exerciseStatus = 'loading Workstr exercises from relays...';
  render();
  try {
    const exercises = await fetchCanonExercises();
    state.discoverExercises = exercises;
    state.exerciseStatus = `loaded ${exercises.length} Workstr exercises`;
    await persistCanonCache();
    void refreshDiscoverProfiles();
  } catch (error) {
    const cached = state.discoverExercises.length;
    state.exerciseStatus = cached
      ? `offline — showing ${cached} Workstr exercises from the last sync`
      : `catalog relay error: ${(error as Error).message}`;
  }
  refreshMergedExercises();
  render();
}

async function refreshPrograms(): Promise<void> {
  state.programStatus = 'loading Workstr programs from relays...';
  render();
  try {
    if (!state.exercises.length) {
      try { state.exercises = await fetchCanonExercises(); } catch { /* Program cards can still infer fallback muscles. */ }
    }
    const programs = await fetchCanonPrograms();
    state.programs = programs;
    state.programStatus = `loaded ${programs.length} Workstr programs`;
    await persistCanonCache();
    void refreshDiscoverProfiles();
    void refreshProgramZapTotals(programs);
  } catch (error) {
    const cached = state.programs.length;
    state.programStatus = cached
      ? `offline — showing ${cached} Workstr programs from the last sync`
      : `program relay error: ${(error as Error).message}`;
  }
  render();
}

async function refreshProgramZapTotals(programs = state.programs): Promise<void> {
  if (!programs.length) return;
  try {
    state.programZapTotals = await fetchProgramZapTotals(programs);
    render();
  } catch {
    // Zap totals are social proof, not core catalog loading. Keep Discover usable
    // when receipt relays are unavailable.
  }
}

// Opens Discover instantly from the persisted snapshot, before any relay answers. Called
// as a namespace loads, so the catalog is on screen while the network refresh runs behind
// it and replaces what it shows.
function primeFromCache(): void {
  const cached = primeCanonCache(state.settings.canonCache);
  if (!cached) return;
  state.discoverExercises = cached.exercises;
  state.programs = cached.programs;
  state.exerciseStatus = `showing ${cached.exercises.length} Workstr exercises from the last sync`;
  state.programStatus = `showing ${cached.programs.length} Workstr programs from the last sync`;
  void refreshDiscoverProfiles();
  void refreshProgramZapTotals(cached.programs);
}

async function refreshDiscoverProfiles(): Promise<void> {
  state.authorProfiles ||= {};
  const pubkeys = [...new Set([
    ...state.discoverExercises.map((exercise) => exercise.nostr_pubkey).filter((pubkey): pubkey is string => Boolean(pubkey)),
    ...state.programs.map((program) => program.pubkey).filter((pubkey): pubkey is string => Boolean(pubkey)),
    ...state.sheets.map((sheet) => sheet.nostr_pubkey).filter((pubkey): pubkey is string => Boolean(pubkey))
  ])].filter((pubkey) => !state.authorProfiles?.[pubkey]);
  if (!pubkeys.length) return;
  const entries = await Promise.all(pubkeys.map(async (pubkey) => [pubkey, await fetchProfile(pubkey, CANON_RELAYS)] as const));
  let changed = false;
  for (const [pubkey, profile] of entries) {
    if (profile) {
      state.authorProfiles[pubkey] = profile;
      if (profile.name) state.profileNames[pubkey] = profile.name;
      changed = true;
    }
  }
  if (changed) render();
}

// Sign out returns to the anonymous local account; the identity's database
// stays on the device unless explicitly removed.
function openExerciseDetail(exercise: Exercise, source: 'library' | 'discover'): void {
  const src = exercise.image_url || '';
  const muscles = (exercise.muscles || []).filter(Boolean);
  const equipment = (exercise.equipment || []).filter(Boolean);
  const tags = (exercise.tags || []).filter(Boolean);
  const pills = (list: string[]) => list.map((item) => `<span class="tag-pill">${html(item)}</span>`).join('');
  const muscleList = muscles.length ? muscles : (exercise.muscle_group ? [exercise.muscle_group] : []);
  const sourceLabel = exerciseSourceLabel(exercise);
  const instructions = (exercise.instructions || []).map((line) => line.trim()).filter(Boolean);
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  // Canon events carry instructions in the event content; older imports have that
  // same text copied into description — show it only when it adds something.
  const description = (exercise.description || '').trim();
  const showDescription = description && normalize(description) !== normalize(instructions.join(' '));
  const importState = discoverImportState(exercise, state.library);
  const importLabel = importState === 'update' ? 'Update' : importState === 'in-library' ? 'In library' : 'Import';
  const importCls = importState === 'update' ? 'gold' : importState === 'in-library' ? 'ghost' : 'primary';
  const actions = source === 'library'
    ? `<button class="button danger" id="ex-detail-delete">Delete</button>`
    : `<button class="button ${importCls}" id="ex-import"${importState === 'in-library' ? ' disabled' : ''}>${importLabel}</button>`;
  openModal(`
    <div class="detail-img${src ? '' : ' placeholder'}">${src ? `<img src="${html(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()">` : EX_PLACEHOLDER}</div>
    <h3 class="detail-title">${html(exercise.name)}</h3>
    <div class="detail-badges">
      ${exercise.difficulty ? `<span class="badge diff">${html(exercise.difficulty)}</span>` : ''}
      ${exercise.category ? `<span class="badge cat">${html(exercise.category)}</span>` : ''}
      <span class="badge">${html(sourceLabel)}</span>
    </div>
    ${showDescription ? `<p class="detail-desc">${html(description)}</p>` : ''}
    <div class="sets-info">
      <div class="sets-item"><div class="val">${exercise.default_sets ?? 3}</div><div class="lbl">Sets</div></div>
      <div class="sets-item"><div class="val">${html(String(exercise.default_reps || '8-12'))}</div><div class="lbl">Reps</div></div>
      <div class="sets-item"><div class="val">${exercise.default_rest ?? 90}s</div><div class="lbl">Rest</div></div>
    </div>
    ${muscleList.length ? `<div class="subsection-head"><span>Target muscles</span></div><div class="tag-row">${pills(muscleList)}</div><div id="detail-muscle-map" class="detail-muscle-map"></div>` : ''}
    ${equipment.length ? `<div class="subsection-head"><span>Equipment</span></div><div class="tag-row">${pills(equipment)}</div>` : ''}
    ${tags.length ? `<div class="subsection-head"><span>Tags</span></div><div class="tag-row">${pills(tags)}</div>` : ''}
    ${instructions.length ? `<div class="subsection-head"><span>Instructions</span></div><ol class="instruction-list">${instructions.map((line) => `<li>${html(line)}</li>`).join('')}</ol>` : ''}
    <div class="form-actions">${actions}</div>`);
  if (muscleList.length) {
    const primary = canonMuscle(exercise.muscle_group || '') || canonMuscle(muscleList[0]);
    const primarySet = new Set<string>(primary ? [primary] : []);
    const secondarySet = new Set<string>(muscleList.flatMap((muscle) => { const canonical = canonMuscle(muscle); return canonical && canonical !== primary ? [canonical] : []; }));
    const mapHost = root.querySelector<HTMLElement>('#detail-muscle-map');
    if (mapHost) mapHost.innerHTML = paintBodyMapSvg(primarySet, secondarySet);
  }
  root.querySelector('#ex-detail-delete')?.addEventListener('click', async () => {
    if (await deleteExerciseFromLibrary(exercise)) closeModal();
  });
  root.querySelector('#ex-import')?.addEventListener('click', async (event) => {
    await importDiscovered(exercise, event.currentTarget as HTMLButtonElement);
  });
}

async function importDiscovered(exercise: Exercise, button: HTMLButtonElement | null): Promise<void> {
  if (!state.store) { toast('Sign in to import exercises.', 'bad'); return; }
  const importState = discoverImportState(exercise, state.library);
  if (importState === 'in-library') { toast('Already in your library'); return; }
  if (button) { button.disabled = true; button.textContent = importState === 'update' ? 'Updating...' : 'Importing...'; }
  const local = exercise.nostr_address ? state.library.find((entry) => entry.nostr_address === exercise.nostr_address) : undefined;
  const { id: _ignored, ...rest } = exercise;
  await state.store.upsertExercise({ ...rest, favourite: local?.favourite ?? false, source_type: 'imported', status: 'active' });
  await reloadLibrary();
  render();
  toast(importState === 'update' ? 'Updated from the Workstr catalog' : 'Imported to library');
}

async function importSelectedDiscovered(): Promise<void> {
  if (!state.store) { toast('Sign in to import exercises.', 'bad'); return; }
  const selected = state.discoverExercises.filter((exercise) => state.discoverSelect.addresses.has(exercise.nostr_address || exercise.slug));
  let imported = 0;
  for (const exercise of selected) {
    if (discoverImportState(exercise, state.library) === 'in-library') continue;
    const local = exercise.nostr_address ? state.library.find((entry) => entry.nostr_address === exercise.nostr_address) : undefined;
    const { id: _ignored, ...rest } = exercise;
    await state.store.upsertExercise({ ...rest, favourite: local?.favourite ?? false, source_type: 'imported', status: 'active' });
    imported += 1;
  }
  state.discoverSelect = { active: false, addresses: new Set() };
  await reloadLibrary();
  render();
  toast(imported ? `Imported ${imported} exercise${imported === 1 ? '' : 's'} to library` : 'Nothing new to import');
}

async function importProgram(program: RelayProgram, button: HTMLButtonElement | null): Promise<void> {
  if (!state.store) { toast('Sign in to import programs.', 'bad'); return; }
  const importState = programImportState(program, state.sheets);
  if (importState === 'in-library') { toast('Already in your programs'); return; }
  if (button) { button.disabled = true; button.textContent = importState === 'update' ? 'Updating...' : 'Importing...'; }
  // The dependency walk resolves referenced exercises from the canon catalog;
  // fetch it first on a fresh install where no snapshot is primed yet.
  if (!state.discoverExercises.length) await refreshExercises();
  const plan = planProgramImport(program, state.library, state.discoverExercises);
  for (const exercise of plan.exercisesToImport) {
    const { id: _ignored, ...rest } = exercise;
    await state.store.upsertExercise({ ...rest, source_type: 'imported', status: 'active' });
  }
  const existing = state.sheets.find((sheet) => sheet.nostr_address === program.address);
  await state.store.saveSheet(plan.sheet, existing?.id);
  if (plan.exercisesToImport.length) await reloadLibrary();
  state.sheets = await state.store.listSheets();
  render();
  const count = plan.exercisesToImport.length;
  toast(importState === 'update'
    ? 'Program updated from the Workstr catalog'
    : `Program imported${count ? ` with ${count} exercise${count === 1 ? '' : 's'}` : ''}`);
  if (plan.unresolved.length) toast(`${plan.unresolved.length} referenced exercise${plan.unresolved.length === 1 ? '' : 's'} not found in the catalog`, 'bad');
}

async function deleteExerciseFromLibrary(exercise: Exercise): Promise<boolean> {
  if (!state.store || !exercise.id) return false;
  if (!window.confirm(`Delete "${exercise.name}" from your library? Programs and logged sessions keep their own copies.`)) return false;
  await state.store.deleteExercise(exercise.id);
  await reloadLibrary();
  render();
  toast('Exercise deleted');
  return true;
}

async function deleteSelectedExercises(): Promise<void> {
  if (!state.store) return;
  const slugs = [...state.librarySelect.slugs];
  if (!slugs.length) return;
  if (!window.confirm(`Delete ${slugs.length} exercise${slugs.length === 1 ? '' : 's'} from your library? Programs and logged sessions keep their own copies.`)) return;
  for (const slug of slugs) {
    const exercise = state.library.find((entry) => entry.slug === slug);
    if (exercise?.id) await state.store.deleteExercise(exercise.id);
  }
  state.librarySelect = { active: false, slugs: new Set() };
  await reloadLibrary();
  render();
  toast(`Deleted ${slugs.length} exercise${slugs.length === 1 ? '' : 's'}`);
}

async function toggleFavourite(slug: string): Promise<void> {
  if (!state.store) return;
  const exercise = state.library.find((entry) => entry.slug === slug);
  if (!exercise) return;
  await state.store.upsertExercise({ ...exercise, favourite: !exercise.favourite });
  await reloadLibrary();
  render();
}

  return {
    refreshMergedExercises, reloadLibrary, persistCanonCache, primeFromCache, refreshExercises, refreshPrograms,
    refreshDiscoverProfiles, openExerciseDetail, importDiscovered, importSelectedDiscovered,
    importProgram, deleteExerciseFromLibrary, deleteSelectedExercises, toggleFavourite
  };
}
