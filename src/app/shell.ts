import { nip19, SimplePool } from 'nostr-tools';
import { renderSVG } from 'uqr';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { clearCachedNip46Signer, createCachedNip46Signer, createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { canonMuscle } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft, type SheetWithExercises } from '../db/store';
import { copyNamespace, deleteNamespace, LOCAL_NAMESPACE, namespaceHasUserData } from '../db/adopt';
import { downloadExport, parseExport } from '../db/export';
import type { Exercise, Session, SessionSet, WorkstrSettings } from '../core/types';
import { displayWeightKg, formatWeightKg, normalizeWeightUnit, storeWeightInput } from '../core/units';
import { CANON_RELAYS, canonCacheSnapshot, fetchCanonExercises, fetchCanonPrograms, primeCanonCache, type RelayProgram } from '../nostr/canon';
import type { RelayProfile } from '../nostr/pool';
import { planProgramImport, programImportState } from '../nostr/programImport';
import type { Signer } from '../signer/types';
import type { ActiveSession, AppState, SessionExercise, SubView, View } from './state';
import { EX_PLACEHOLDER, exerciseImage, exerciseSourceLabel, filterExercises, html } from './format';
import { shellMarkup } from './layout';
import { createSessionRunner } from './session-runner';
import { paintBodyMapSvg } from './bodymap';
import { discoverImportable, discoverImportState } from '../features/discover/views';
import { getRecovery, type RecoveryGroup } from '../features/recovery/recovery';
import { getQuickWorkout } from '../features/recovery/quickWorkout';
import { sheetToProgram, type BuilderState } from '../features/sheets/views';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const DEFAULT_SETTINGS: WorkstrSettings = { unit: 'kg', publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'] };

function profileName(profile: RelayProfile | null): string | null {
  return profile?.name?.trim() || profile?.nip05?.trim() || null;
}

async function fetchProfile(pubkey: string, relays = CANON_RELAYS): Promise<RelayProfile | null> {
  const pool = new SimplePool();
  try {
    const event = await Promise.race([
      pool.get(relays, { kinds: [0], authors: [pubkey] }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000))
    ]);
    if (!event) return null;
    const profile = JSON.parse(event.content) as { display_name?: string; displayName?: string; name?: string; username?: string; picture?: string; image?: string; avatar?: string; nip05?: string };
    return {
      pubkey,
      name: profile.display_name?.trim() || profile.displayName?.trim() || profile.name?.trim() || profile.username?.trim() || profile.nip05?.trim() || undefined,
      picture: profile.picture?.trim() || profile.image?.trim() || profile.avatar?.trim() || undefined,
      nip05: profile.nip05?.trim() || undefined,
      createdAt: event.created_at
    };
  } catch {
    return null;
  } finally {
    pool.close(relays);
  }
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, profileNames: {}, authorProfiles: {}, store: null, settings: { ...DEFAULT_SETTINGS }, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], activeSession: null, finishedSessions: [], publishingSessionId: null, publishingStatus: null, editingId: null, filter: '', programFilter: '', expandedProgramAddress: null, exerciseStatus: 'loading the Workstr catalog from relays...', programStatus: '', signInStatus: null, expandedSessionId: null, qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false }, bodyEntries: [], sheets: [], library: [], librarySelect: { active: false, slugs: new Set<string>() }, discoverSelect: { active: false, addresses: new Set<string>() }, discoverExercises: [], exFilter: { cat: '', muscle: '', diff: '' }, discoverFilter: { q: '', cat: '', muscle: '', diff: '' } };

  async function boot(): Promise<void> {
    // Installs from before demo mode was removed may still have the fake
    // demo pubkey persisted; it is not valid hex and would crash npubEncode.
    if (state.pubkey === 'demo-local-pubkey') {
      state.pubkey = null;
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SIGNER_TYPE_KEY);
    }
    // Paint the shell immediately; data lands on the next render.
    render();
    if (state.pubkey) await openIdentity(state.pubkey, false);
    else await openLocal();
    render();
    await refreshExercises();
  }

  async function openIdentity(pubkey: string, persist = true, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    state.pubkey = pubkey;
    state.signerType = signerType;
    state.npub = nip19.npubEncode(pubkey);
    state.signInStatus = null;
    // Persist before the slow steps: reloading mid-sign-in must not lose the
    // session (the profile fetch alone can take its full 5s timeout).
    if (persist) {
      localStorage.setItem(SESSION_KEY, pubkey);
      if (signerType) localStorage.setItem(SIGNER_TYPE_KEY, signerType);
    }
    await loadNamespace(pubkey);
    state.profileName = profileName(await fetchProfile(pubkey));
  }

  // Anonymous local account — the default; no signer involved.
  async function openLocal(): Promise<void> {
    state.pubkey = null;
    state.npub = null;
    state.profileName = null;
    state.signerType = null;
    state.signInStatus = null;
    await loadNamespace(LOCAL_NAMESPACE);
  }

  async function loadNamespace(namespace: string): Promise<void> {
    state.store?.close();
    state.store = await WorkstrStore.open(namespace);
    state.settings = await state.store.getSettings();
    await state.store.removeStarterExercises();
    state.finishedSessions = await loadFinishedSessions();
    state.bodyEntries = await state.store.listBody();
    state.sheets = await state.store.listSheets();
    // Open Discover instantly from the persisted canon snapshot; the network
    // refresh replaces it in the background when relays answer.
    const cached = primeCanonCache(state.settings.canonCache);
    if (cached) {
      state.discoverExercises = cached.exercises;
      state.programs = cached.programs;
      state.exerciseStatus = `showing ${cached.exercises.length} Workstr exercises from the last sync`;
      state.programStatus = `showing ${cached.programs.length} Workstr programs from the last sync`;
      void refreshDiscoverProfiles();
    }
    await reloadLibrary();
    state.activeSession = await loadUnfinishedSession();
  }

  function render(): void {
    root.innerHTML = shellMarkup(state);
    bind();
    if (state.activeSession) void sessionRunner.openSessionOverlay(state.activeSession);
    if (pendingConnect) renderConnectModal();
    if (builder) renderBuilderModal();
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.view = button.dataset.view as View;
      state.editingId = null;
      render();
      if (state.view === 'exercises' && !state.discoverExercises.length) void refreshExercises();
      if (state.view === 'workouts' && !state.programs.length) void refreshPrograms();
    }));
    root.querySelectorAll<HTMLElement>('[data-subtab]').forEach((button) => button.addEventListener('click', () => {
      const parent = button.dataset.parent as keyof AppState['subState'];
      if (parent && parent in state.subState) {
        (state.subState[parent] as SubView) = button.dataset.subtab as SubView;
        state.view = parent as View;
        state.editingId = null;
        render();
        if (parent === 'exercises' && !state.discoverExercises.length) void refreshExercises();
        if (parent === 'workouts' && !state.programs.length) void refreshPrograms();
      }
    }));
    root.querySelector('#account-chip')?.addEventListener('click', () => { state.view = 'settings'; render(); });
    root.querySelector('#sign-in-settings')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-in-nip07')?.addEventListener('click', () => { void connectNip07(); });
    root.querySelector('#sign-out-settings')?.addEventListener('click', () => { void signOut(); });
    root.querySelector('#remove-account-data')?.addEventListener('click', () => { void signOutAndRemoveData(); });
    root.querySelector('#unit-select')?.addEventListener('change', (event) => { void saveUnitPreference((event.target as HTMLSelectElement).value); });
    root.querySelector('#export-data')?.addEventListener('click', () => { void exportUserData(); });
    root.querySelector('#import-data')?.addEventListener('click', () => root.querySelector<HTMLInputElement>('#import-file')?.click());
    root.querySelector('#import-file')?.addEventListener('change', (event) => { void importUserData(event.target as HTMLInputElement); });
    root.querySelectorAll('#refresh-exercises').forEach((button) => button.addEventListener('click', () => { void refreshExercises(); }));
    root.querySelectorAll('#refresh-programs').forEach((button) => button.addEventListener('click', () => { void refreshPrograms(); }));
    root.querySelector('#ex-search')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#ex-search'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    root.querySelector('#ex-cat')?.addEventListener('change', (event) => { state.exFilter.cat = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-muscle')?.addEventListener('change', (event) => { state.exFilter.muscle = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-diff')?.addEventListener('change', (event) => { state.exFilter.diff = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-grid')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-slug]');
      if (state.librarySelect.active) {
        const slug = card?.dataset.slug;
        if (!slug) return;
        if (state.librarySelect.slugs.has(slug)) state.librarySelect.slugs.delete(slug);
        else state.librarySelect.slugs.add(slug);
        render();
        return;
      }
      const fav = target.closest<HTMLElement>('[data-fav]');
      if (fav) { void toggleFavourite(fav.dataset.fav || ''); return; }
      if (!card) return;
      const exercise = state.library.find((entry) => entry.slug === card.dataset.slug);
      if (exercise) openExerciseDetail(exercise, 'library');
    });
    root.querySelector('#lib-select-toggle')?.addEventListener('click', () => { state.librarySelect = { active: true, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-cancel')?.addEventListener('click', () => { state.librarySelect = { active: false, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-all')?.addEventListener('click', () => {
      const visible = filterExercises(state.library, state.filter, state.exFilter.cat, state.exFilter.muscle, state.exFilter.diff).map((exercise) => exercise.slug);
      const allSelected = visible.length > 0 && visible.every((slug) => state.librarySelect.slugs.has(slug));
      state.librarySelect.slugs = allSelected ? new Set() : new Set(visible);
      render();
    });
    root.querySelector('#lib-delete-selected')?.addEventListener('click', () => { void deleteSelectedExercises(); });
    root.querySelector('#discover-refresh')?.addEventListener('click', () => { void refreshExercises(); });
    root.querySelector('#program-discover-refresh')?.addEventListener('click', () => { void refreshPrograms(); });
    root.querySelector('#discover-search')?.addEventListener('input', (event) => { state.discoverFilter.q = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#discover-search'); input?.focus(); input?.setSelectionRange(state.discoverFilter.q.length, state.discoverFilter.q.length); });
    root.querySelector('#discover-cat')?.addEventListener('change', (event) => { state.discoverFilter.cat = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-muscle')?.addEventListener('change', (event) => { state.discoverFilter.muscle = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-diff')?.addEventListener('change', (event) => { state.discoverFilter.diff = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-grid')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>('[data-address]');
      if (!card) return;
      const exercise = state.discoverExercises.find((entry) => (entry.nostr_address || entry.slug) === card.dataset.address);
      if (!exercise) return;
      if (state.discoverSelect.active) {
        if (discoverImportState(exercise, state.library) === 'in-library') return;
        const address = exercise.nostr_address || exercise.slug;
        if (state.discoverSelect.addresses.has(address)) state.discoverSelect.addresses.delete(address);
        else state.discoverSelect.addresses.add(address);
        render();
        return;
      }
      const importButton = target.closest<HTMLButtonElement>('[data-import-address]');
      if (importButton) { void importDiscovered(exercise, importButton); return; }
      openExerciseDetail(exercise, 'discover');
    });
    root.querySelector('#discover-select-toggle')?.addEventListener('click', () => { state.discoverSelect = { active: true, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-cancel')?.addEventListener('click', () => { state.discoverSelect = { active: false, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-all')?.addEventListener('click', () => {
      const visible = filterExercises(state.discoverExercises, state.discoverFilter.q, state.discoverFilter.cat, state.discoverFilter.muscle, state.discoverFilter.diff);
      const importable = discoverImportable(visible, state.library).map((exercise) => exercise.nostr_address || exercise.slug);
      const allSelected = importable.length > 0 && importable.every((address) => state.discoverSelect.addresses.has(address));
      state.discoverSelect.addresses = allSelected ? new Set() : new Set(importable);
      render();
    });
    root.querySelector('#discover-import-selected')?.addEventListener('click', () => { void importSelectedDiscovered(); });
    root.querySelector('#program-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelector('#program-discover-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-discover-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelectorAll<HTMLElement>('[data-toggle-program]').forEach((header) => header.addEventListener('click', () => {
      const address = header.dataset.toggleProgram || null;
      state.expandedProgramAddress = state.expandedProgramAddress === address ? null : address;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-toggle-exitem]').forEach((header) => header.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = header.dataset.toggleExitem;
      const item = key ? root.querySelector<HTMLElement>(`[data-exitem="${CSS.escape(key)}"]`) : null;
      item?.classList.toggle('open');
    }));
    root.querySelectorAll<HTMLElement>('[data-start-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const address = button.dataset.startProgram;
      const program = state.sheets.map(sheetToProgram).find((item) => item.address === address);
      if (program) void sessionRunner.startTrainingSession(program);
    }));
    root.querySelectorAll<HTMLElement>('[data-import-program]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const program = state.programs.find((item) => item.address === button.dataset.importProgram);
      if (program) await importProgram(program, button as HTMLButtonElement);
    }));
    root.querySelector('#new-program')?.addEventListener('click', () => { void openSheetBuilder(); });
    root.querySelectorAll<HTMLElement>('[data-edit-sheet]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const sheet = state.sheets.find((item) => item.id === Number(button.dataset.editSheet));
      if (sheet) void openSheetBuilder(sheet);
    }));
    root.querySelectorAll<HTMLElement>('[data-del-sheet]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!state.store || !window.confirm('Delete this program?')) return;
      await state.store.deleteSheet(Number(button.dataset.delSheet) || 0);
      state.sheets = await state.store.listSheets();
      render();
      toast('Program deleted');
    }));
    sessionRunner.bindSessionControls();
    root.querySelectorAll<HTMLElement>('[data-delete-session]').forEach((button) => button.addEventListener('click', () => { void deleteSession(Number(button.dataset.deleteSession)); }));
    root.querySelectorAll<HTMLButtonElement>('[data-publish-session]').forEach((button) => button.addEventListener('click', () => {
      const session = state.finishedSessions.find((item) => item.id === Number(button.dataset.publishSession));
      if (session) void sessionRunner.publishSessionSummary(session, button);
    }));
    root.querySelectorAll<HTMLElement>('[data-toggle-session]').forEach((head) => head.addEventListener('click', () => {
      const id = Number(head.dataset.toggleSession) || 0;
      state.expandedSessionId = state.expandedSessionId === id ? null : id;
      render();
    }));
    bindRecoveryControls();
    bindBodyControls();
  }

  async function openSheetBuilder(sheet: SheetWithExercises | null = null): Promise<void> {
    if (!state.store) { toast('Sign in to create programs.', 'bad'); return; }
    // Programs are built from the user's library only, never the relay catalog.
    const library = await state.store.listExercises();
    builder = {
      sheetId: sheet?.id,
      name: sheet?.name || '',
      desc: sheet?.notes || '',
      library,
      rows: sheet
        ? sheet.exercises.map((row) => ({
            exerciseSlug: row.exercise_slug || '',
            exerciseName: row.exercise_name || row.exercise_slug || 'Exercise',
            muscleGroup: row.muscle_group,
            imageUrl: row.image_url,
            sets: Number(row.sets) || 3,
            reps: String(row.reps ?? '8-12'),
            restSec: Number(row.rest) || 90,
            weight: row.weight ?? null,
            notes: row.notes || ''
          }))
        : []
    };
    renderBuilderModal();
  }

  function renderBuilderModal(): void {
    const current = builder;
    if (!current) return;
    openModal(`
      <h3>${current.sheetId ? 'Edit program' : 'New program'}</h3>
      <div class="form-grid">
        <label class="span-2">Name<input id="sheet-name" value="${html(current.name)}" placeholder="Push Day" /></label>
        <label class="span-2">Description<input id="sheet-desc" value="${html(current.desc)}" placeholder="optional" /></label>
      </div>
      <div class="subsection-head"><span>Add from your library</span></div>
      <div class="builder-search-wrap">
        <input id="builder-search" class="builder-search" placeholder="Filter your library..." autocomplete="off" />
      </div>
      <div id="builder-picker" class="builder-picker"></div>
      <div class="subsection-head"><span>Program exercises</span></div>
      <div id="builder-rows" class="builder-rows"></div>
      <div class="form-actions"><button class="button primary" id="sheet-save" type="button">${current.sheetId ? 'Save program' : 'Create program'}</button></div>`);
    renderBuilderRows();
    root.querySelector('#sheet-name')?.addEventListener('input', (event) => { current.name = (event.target as HTMLInputElement).value; });
    root.querySelector('#sheet-desc')?.addEventListener('input', (event) => { current.desc = (event.target as HTMLInputElement).value; });
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
          ${exerciseImage(exercise.image_url)}
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
      if (index >= 0) {
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
          notes: ''
        });
      }
      renderBuilderRows();
      renderPicker();
    });
    const rowsHost = root.querySelector<HTMLElement>('#builder-rows');
    rowsHost?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      const row = target.closest<HTMLElement>('[data-i]');
      const entry = row ? current.rows[Number(row.dataset.i)] : undefined;
      const field = target.dataset.f;
      if (!entry || !field) return;
      if (field === 'sets') entry.sets = Number(target.value) || 0;
      else if (field === 'restSec') entry.restSec = Number(target.value) || 0;
      else if (field === 'weight') entry.weight = storeWeightInput(target.value, normalizeWeightUnit(state.settings.unit));
      else if (field === 'reps') entry.reps = target.value;
    });
    rowsHost?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset.rm != null) { current.rows.splice(Number(target.dataset.rm), 1); renderBuilderRows(); renderPicker(); return; }
      if (target.dataset.move != null) {
        const index = Number(target.dataset.move);
        const next = index + Number(target.dataset.dir);
        if (next >= 0 && next < current.rows.length) {
          [current.rows[index], current.rows[next]] = [current.rows[next], current.rows[index]];
          renderBuilderRows();
        }
      }
    });
    root.querySelector('#sheet-save')?.addEventListener('click', async () => {
      if (!state.store || !builder) return;
      const name = builder.name.trim();
      if (!name) { toast('name is required', 'bad'); return; }
      await state.store.saveSheet({
        name,
        notes: builder.desc.trim(),
        exercises: builder.rows.map((row, index) => ({
          exercise_slug: row.exerciseSlug,
          exercise_name: row.exerciseName,
          muscle_group: row.muscleGroup,
          image_url: row.imageUrl,
          sets: row.sets,
          reps: row.reps,
          rest: row.restSec,
          weight: row.weight,
          notes: row.notes,
          position: index
        }))
      }, builder.sheetId);
      builder = null;
      state.sheets = await state.store.listSheets();
      closeModal();
      render();
      toast('Program saved');
    });
  }

  function renderBuilderRows(): void {
    const host = root.querySelector<HTMLElement>('#builder-rows');
    const current = builder;
    if (!host || !current) return;
    const unit = normalizeWeightUnit(state.settings.unit);
    if (!current.rows.length) { host.innerHTML = '<div class="empty" style="padding:8px 0">No exercises yet. Search above to add.</div>'; return; }
    host.innerHTML = current.rows.map((row, index) => {
      const src = row.imageUrl || current.library.find((exercise) => exercise.slug === row.exerciseSlug)?.image_url;
      const img = src
        ? `<img class="wex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wex-img placeholder'}))">`
        : `<div class="wex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
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
        </div>
        <button class="wex-remove" type="button" data-rm="${index}" title="Remove">✕</button>
      </div>`;
    }).join('');
  }

  function bindBodyControls(): void {
    root.querySelector('#body-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.store) { toast('Sign in to log weight.', 'bad'); return; }
      const form = event.target as HTMLFormElement;
      const weightKg = storeWeightInput((form.elements.namedItem('weightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit));
      if (weightKg == null) return;
      await state.store.logBody({ date: (form.elements.namedItem('date') as HTMLInputElement).value || undefined, weight_kg: weightKg, notes: '' });
      state.bodyEntries = await state.store.listBody();
      render();
      toast('Weight logged');
    });
    root.querySelectorAll<HTMLElement>('[data-del-body]').forEach((button) => button.addEventListener('click', async () => {
      if (!state.store) return;
      await state.store.deleteBody(Number(button.dataset.delBody) || 0);
      state.bodyEntries = await state.store.listBody();
      render();
    }));
    root.querySelector('#body-profile-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.store) { toast('Sign in to save your profile.', 'bad'); return; }
      const form = event.target as HTMLFormElement;
      const heightCm = Number((form.elements.namedItem('heightCm') as HTMLInputElement).value) || 0;
      const targetWeightKg = storeWeightInput((form.elements.namedItem('targetWeightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit)) || 0;
      state.settings = { ...state.settings, heightCm, targetWeightKg };
      await state.store.saveSettings(state.settings);
      render();
      toast('Profile saved');
    });
  }

  function toast(message: string, kind: 'ok' | 'bad' = 'ok'): void {
    const el = root.querySelector<HTMLElement>('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `show ${kind}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el.className = ''; }, 2600);
  }

  // Quick workout draws from the full library like self-hosted: local store
  // exercises plus the relay library, deduped by slug.
  function bindRecoveryControls(): void {
    const body = root.querySelector<SVGSVGElement>('#recovery-body');
    if (body) {
      const tip = root.querySelector<HTMLElement>('#recovery-tip');
      const byMuscle: Record<string, RecoveryGroup> = {};
      for (const group of getRecovery(state.finishedSessions, state.exercises).muscleGroups) byMuscle[group.name] = group;
      const highlight = (name: string | null) => body.querySelectorAll<SVGElement>('[data-muscle]').forEach((el) => el.classList.toggle('hl', name != null && el.getAttribute('data-muscle') === name));
      body.addEventListener('mousemove', (event) => {
        if (!tip) return;
        const poly = (event.target as Element).closest('[data-muscle]');
        if (!poly) { tip.hidden = true; highlight(null); return; }
        const name = poly.getAttribute('data-muscle') || '';
        const group = byMuscle[name];
        highlight(name);
        const rect = (body.parentElement as HTMLElement).getBoundingClientRect();
        tip.hidden = false;
        tip.style.left = `${event.clientX - rect.left}px`;
        tip.style.top = `${event.clientY - rect.top}px`;
        tip.innerHTML = group
          ? `<strong>${html(name)}</strong><small>${group.percent}% · ${group.status}${group.status !== 'untrained' && group.percent < 100 ? ` · ${group.hoursRemaining}h left` : ''}</small>`
          : `<strong>${html(name)}</strong><small>no data</small>`;
      });
      body.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; highlight(null); });
    }
    root.querySelectorAll<HTMLElement>('[data-qw-dur]').forEach((button) => button.addEventListener('click', () => {
      state.qw.duration = Number(button.dataset.qwDur) || 45;
      root.querySelectorAll<HTMLElement>('#qw-duration .qw-dur-btn').forEach((el) => el.classList.toggle('active', el === button));
    }));
    root.querySelector('#qw-generate')?.addEventListener('click', async () => {
      const data = getQuickWorkout(state.finishedSessions, state.store ? await state.store.listExercises() : [], state.qw.duration, 80);
      if (!data.exercises.length) {
        state.qw.visible = false; state.qw.exercises = []; state.qw.pool = {};
        render();
        toast('No recovered muscle groups with exercises yet — train or add exercises first.', 'bad');
        return;
      }
      state.qw.exercises = data.exercises;
      state.qw.pool = data.pool;
      state.qw.meta = `${data.exercises.length} exercises · ~${data.estimatedDurationMin} min · ${data.targetMuscleGroups.join(', ')}`;
      state.qw.visible = true;
      render();
    });
    root.querySelectorAll<HTMLElement>('[data-qw-swap]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.qwSwap) || 0;
      const exercise = state.qw.exercises[index];
      const pool = state.qw.pool[exercise?.muscleGroup || ''] || [];
      if (!exercise || !pool.length) return;
      const replacement = pool.shift()!;
      pool.push(exercise); // cycle the swapped-out exercise back in
      state.qw.pool[exercise.muscleGroup] = pool;
      state.qw.exercises[index] = replacement;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-qw-remove]').forEach((button) => button.addEventListener('click', () => {
      state.qw.exercises.splice(Number(button.dataset.qwRemove) || 0, 1);
      if (!state.qw.exercises.length) state.qw.visible = false;
      render();
    }));
    root.querySelector('#qw-start')?.addEventListener('click', () => {
      if (!state.qw.exercises.length) return;
      const groups = [...new Set(state.qw.exercises.map((exercise) => exercise.muscleGroup).filter(Boolean))];
      const name = 'Quick — ' + (groups.length ? groups.join(', ') : 'Mixed');
      const program: RelayProgram = {
        slug: 'quick-workout', name, description: '', tags: [], sourceLabel: '', muscleMapUrl: '', eventId: '', pubkey: '', address: '', createdAt: Date.now(),
        exercises: state.qw.exercises.map((exercise) => ({ address: '', name: exercise.name, muscleGroup: exercise.muscleGroup, sets: exercise.sets, reps: exercise.reps, restSec: exercise.restSec }))
      };
      state.qw.visible = false;
      void sessionRunner.startTrainingSession(program);
    });
  }

  async function deleteSession(id: number): Promise<void> {
    if (!state.store || !id) return;
    if (!window.confirm('Delete this session? All logged sets will be permanently removed from your history and stats.')) return;
    await state.store.deleteSession(id);
    if (state.expandedSessionId === id) state.expandedSessionId = null;
    state.finishedSessions = await loadFinishedSessions();
    render();
  }

  async function saveUnitPreference(value: string): Promise<void> {
    if (!state.store) return;
    state.settings = { ...state.settings, unit: normalizeWeightUnit(value) };
    await state.store.saveSettings(state.settings);
    render();
  }

  async function exportUserData(): Promise<void> {
    if (!state.store) return;
    try {
      downloadExport(await state.store.exportData(state.pubkey ?? LOCAL_NAMESPACE));
      toast('Exported your data');
    } catch (error) {
      toast(`Export failed: ${(error as Error).message}`, 'bad');
    }
  }

  async function importUserData(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file later
    if (!file || !state.store) return;
    try {
      const data = parseExport(await file.text());
      const confirmation = window.prompt('This ERASES all data in this account and replaces it with the file. Type REPLACE to confirm.');
      if (confirmation !== 'REPLACE') { toast('Import cancelled'); return; }
      await state.store.importData(data);
      window.location.reload();
    } catch (error) {
      toast(`Import failed: ${(error as Error).message}`, 'bad');
    }
  }

  async function loadFinishedSessions(): Promise<ActiveSession[]> {
    if (!state.store) return [];
    const sessions = (await state.store.listSessions()).filter((session) => session.finished_at);
    const result: ActiveSession[] = [];
    for (const session of sessions) {
      const sets = session.id ? await state.store.listSessionSets(session.id) : [];
      result.push(activeSessionFromStored(session, sets));
    }
    return result;
  }

  async function loadUnfinishedSession(): Promise<ActiveSession | null> {
    if (!state.store) return null;
    const session = (await state.store.listSessions()).find((item) => !item.finished_at);
    if (!session?.id) return null;
    return activeSessionFromStored(session, await state.store.listSessionSets(session.id));
  }

  function activeSessionFromStored(session: Session, sets: SessionSet[]): ActiveSession {
    const exercises = (session.exercises || []) as SessionExercise[];
    return {
      id: Number(session.id),
      sheetName: session.sheet_name || 'Workout',
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      nostrEventId: session.nostr_event_id,
      summaryImageUrl: session.summary_image_url,
      exercises,
      sets: sets.map((set) => ({
        exerciseSlug: set.exercise_slug || String(set.exercise_id || ''),
        exerciseName: set.exercise_name,
        setNumber: Number(set.set_number),
        reps: set.reps ?? null,
        weight: set.weight_kg ?? null,
        done: true,
        completedAt: set.completed_at
      }))
    };
  }

  // state.exercises is the merged lookup pool (local library first, then relay
  // finds); the Library tab renders state.library, Discover renders state.discoverExercises.
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
    } catch (error) {
      const cached = state.programs.length;
      state.programStatus = cached
        ? `offline — showing ${cached} Workstr programs from the last sync`
        : `program relay error: ${(error as Error).message}`;
    }
    render();
  }

  async function refreshDiscoverProfiles(): Promise<void> {
    state.authorProfiles ||= {};
    const pubkeys = [...new Set([
      ...state.discoverExercises.map((exercise) => exercise.nostr_pubkey).filter((pubkey): pubkey is string => Boolean(pubkey)),
      ...state.programs.map((program) => program.pubkey).filter((pubkey): pubkey is string => Boolean(pubkey))
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
  async function signOut(): Promise<void> {
    activeSigner = null;
    clearCachedNip46Signer();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SIGNER_TYPE_KEY);
    state.editingId = null;
    state.librarySelect = { active: false, slugs: new Set() };
    state.discoverSelect = { active: false, addresses: new Set() };
    await openLocal();
    render();
  }

  async function signOutAndRemoveData(): Promise<void> {
    const pubkey = state.pubkey;
    if (!pubkey) return;
    if (!window.confirm("Remove this identity's training data from this device and sign out? This cannot be undone.")) return;
    state.store?.close();
    state.store = null;
    await deleteNamespace(pubkey);
    await signOut();
  }

  // Sign-in always starts from the anonymous local account. Adoption policy
  // (plan decision 6): a fresh identity adopts the local data wholesale; an
  // identity that already has data on this device asks once — never merge.
  // A purely seeded local account has nothing worth adopting, so it skips
  // both the copy and the prompt.
  async function completeSignIn(pubkey: string, signerType: AppState['signerType']): Promise<void> {
    if (state.pubkey || !(await namespaceHasUserData(LOCAL_NAMESPACE))) {
      await openAndRender(pubkey, signerType);
      return;
    }
    if (await namespaceHasUserData(pubkey)) {
      askAdoptChoice(pubkey, signerType);
      return;
    }
    await adoptLocalAndOpen(pubkey, signerType);
  }

  async function adoptLocalAndOpen(pubkey: string, signerType: AppState['signerType']): Promise<void> {
    state.store?.close();
    state.store = null;
    await copyNamespace(LOCAL_NAMESPACE, pubkey);
    await deleteNamespace(LOCAL_NAMESPACE);
    await openAndRender(pubkey, signerType);
  }

  function askAdoptChoice(pubkey: string, signerType: AppState['signerType']): void {
    openModal(`<div class="page-title">Existing account data</div>
      <p class="section-help">This identity already has Workstr data on this device. Pick the dataset to continue with — the two are never merged. Keeping this device's data replaces the identity's copy on this device.</p>
      <div class="web-empty-actions">
        <button id="adopt-keep-device" class="button primary">Keep this device's data</button>
        <button id="adopt-use-account" class="button ghost">Use the account's data</button>
      </div>`);
    root.querySelector('#adopt-keep-device')?.addEventListener('click', () => { closeModal(); void adoptLocalAndOpen(pubkey, signerType); });
    root.querySelector('#adopt-use-account')?.addEventListener('click', () => { closeModal(); void openAndRender(pubkey, signerType); });
  }


  let activeSigner: Signer | null = null;
  let pendingConnect: { uri: string; mobile: boolean } | null = null;
  let toastTimer: number | undefined;
  let builder: BuilderState | null = null;

  const sessionRunner = createSessionRunner({
    root, state, render, toast, openModal, closeModal, wDisplay, wFmt, unitLabel,
    persistCanonCache, loadFinishedSessions, getActiveSigner
  });

  function unitLabel(): string { return normalizeWeightUnit(state.settings.unit); }

  function wDisplay(weight: number | null | undefined): number | null { return displayWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function wFmt(weight: number | null | undefined): string { return weight == null ? '—' : formatWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }


  // The live signer only survives the tab. Recreate a signer from the
  // persisted local client credentials instead of forcing a full reconnect
  // after the user closes and reopens the PWA.
  async function getActiveSigner(): Promise<Signer | null> {
    if (activeSigner) return activeSigner;
    if (state.signerType === 'nip07' && hasNip07()) {
      activeSigner = createNip07Signer();
      return activeSigner;
    }
    if (state.signerType === 'nip46') {
      activeSigner = createCachedNip46Signer({ onAuthUrl: launchSignerRequest });
      return activeSigner;
    }
    return null;
  }


  function openModal(content: string): void {
    const modal = root.querySelector('#modal');
    const host = root.querySelector('#modal-content');
    if (host) host.innerHTML = content;
    modal?.classList.add('open');
    root.querySelector('#modal-close')?.addEventListener('click', closeModal);
  }

  function closeModal(): void { pendingConnect = null; builder = null; root.querySelector('#modal')?.classList.remove('open'); }


  async function connectNip07(): Promise<void> {
    try {
      const signer = createNip07Signer();
      const pubkey = await signer.getPublicKey();
      activeSigner = signer;
      await completeSignIn(pubkey, 'nip07');
    } catch (error) {
      state.signInStatus = `extension signer error ${(error as Error).message}`;
      render();
    }
  }

  async function startRemoteSignerRequest(): Promise<void> {
    try {
      state.signInStatus = 'creating signer connect request...'; render();
      const request = createNostrConnectSignerRequest(defaultBunkerRelays(), { onAuthUrl: launchSignerRequest });
      const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
      state.signInStatus = `waiting for signer approval on ${request.relays.join(', ')}`;
      render();
      showSignerConnectModal(request.uri, mobile);
      if (mobile) launchSignerRequest(request.uri);
      const connected = await request.signer;
      activeSigner = connected.signer;
      closeModal();
      await completeSignIn(connected.pubkey, 'nip46');
    } catch (error) {
      closeModal();
      state.signInStatus = `signer error ${(error as Error).message}`;
      render();
    }
  }

  function showSignerConnectModal(uri: string, mobile: boolean): void {
    pendingConnect = { uri, mobile };
    renderConnectModal();
  }

  function renderConnectModal(): void {
    if (!pendingConnect) return;
    const { uri, mobile } = pendingConnect;
    openModal(`<div class="page-title">Connect signer</div>
      <p class="section-help">${mobile
        ? 'Approve the request in your signer app, then return to this tab. You can also scan the QR code from another device.'
        : 'Scan the QR code with your NIP-46 signer app (Clave, Amber, ...). Once you approve, this tab signs in automatically.'}</p>
      <div class="signer-qr">${renderSVG(uri, { border: 2 })}</div>
      <div class="web-empty-actions">
        <button id="connect-copy" class="button ghost" type="button">Copy connect link</button>
        <button id="connect-open" class="button ghost" type="button">Open signer app</button>
      </div>`);
    root.querySelector('#connect-copy')?.addEventListener('click', (event) => {
      void navigator.clipboard.writeText(uri);
      (event.currentTarget as HTMLButtonElement).textContent = 'Copied';
    });
    root.querySelector('#connect-open')?.addEventListener('click', () => launchSignerRequest(uri));
  }

  function launchSignerRequest(uri: string): void {
    const link = document.createElement('a');
    link.href = uri; link.target = '_blank'; link.rel = 'noreferrer'; link.style.display = 'none';
    document.body.appendChild(link); link.click(); link.remove();
  }

  async function openAndRender(pubkey: string, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    await openIdentity(pubkey, true, signerType);
    render();
  }

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

  void boot();
}
