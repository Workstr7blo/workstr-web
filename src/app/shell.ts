import { nip19 } from 'nostr-tools';
import { canonMuscle } from '../core/muscles';
import { mergeOwnedEquipment, MY_EQUIPMENT, ownedEquipmentKeys } from '../core/equipment';
import { WorkstrStore, type ExerciseDraft } from '../db/store';
import { LOCAL_NAMESPACE } from '../db/adopt';
import { downloadExport, parseExport } from '../db/export';
import { applyStarterSeed } from '../db/seed';
import { fetchMonthlyZapReceipts } from '../nostr/zaps';
import type { Exercise, WorkstrSettings } from '../core/types';
import { displayWeightKg, formatWeightKg, normalizeWeightUnit, storeWeightInput } from '../core/units';
import { addMonths, dateKeyFromDate, isDateKey, monthKeyOf } from '../core/dates';
import { CANON_RELAYS, canonCacheSnapshot, fetchCanonExercises, fetchCanonPrograms, type RelayProgram } from '../nostr/canon';
import type { RelayProfile } from '../nostr/pool';
import { fetchProfile, profileRelays, readCachedProfile, writeCachedProfile } from '../nostr/profile';
import { planProgramImport, programImportState } from '../nostr/programImport';
import type { ActiveSession, AppState, SubView, View } from './state';
import { EX_PLACEHOLDER, exerciseImage, exerciseSourceLabel, filterExercises, formatMinutes, html } from './format';
import { shellMarkup } from './layout';
import { createSessionRunner } from './session-runner';
import { paintBodyMapSvg } from './bodymap';
import { preservingScroll } from './scroll';
import { discoverImportable, discoverImportState } from '../features/discover/views';
import { getRecovery, type RecoveryGroup } from '../features/recovery/recovery';
import { getQuickWorkout } from '../features/recovery/quickWorkout';
import { sheetToProgram } from '../features/sheets/views';
import { createUpdateController } from './update-controller';
import { createProgramBuilder } from './program-builder';
import { createSessionPersistence } from './session-persistence';
import { createCatalogController } from './catalog-controller';
import { createIdentityController, launchSignerUri } from './identity-controller';
import { createPreferencesController } from './preferences-controller';
import { createBackupController } from './backup-controller';
import { createNwcController } from './nwc-controller';
import { createProgramPublishController } from './program-publish-controller';
import type { ShellHandle, ShellOptions } from './shell-types';
export { launchSignerUri };
const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const DEFAULT_SETTINGS: WorkstrSettings = { unit: 'kg', publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'] };

function profileName(profile: RelayProfile | null): string | null {
  return profile?.name?.trim() || profile?.nip05?.trim() || null;
}

export function renderShell(root: HTMLElement, options: ShellOptions = {}): ShellHandle {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, profilePicture: null, profileNames: {}, authorProfiles: {}, store: null, settings: { ...DEFAULT_SETTINGS }, support: { status: 'idle', receipts: [] }, nwc: { active: false, status: 'idle' }, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], programZapTotals: {}, programZapAttempts: [], activeSession: null, finishedSessions: [], publishingSessionId: null, publishingStatus: null, editingId: null, filter: '', programFilter: '', programFilters: { goal: '', focus: '', format: '', equipment: '' }, expandedProgramAddress: null, exerciseStatus: 'loading the Workstr catalog from relays...', programStatus: '', signInStatus: null, backup: { state: 'off', pending: 0 }, expandedSessionId: null, history: { monthKey: null, selectedDate: null }, qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false }, bodyEntries: [], sheets: [], library: [], librarySelect: { active: false, slugs: new Set<string>() }, discoverSelect: { active: false, addresses: new Set<string>() }, discoverExercises: [], exFilter: { cat: '', muscle: '', diff: '', equip: '' }, discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' } };

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
    if (!options.skipCatalogRefresh) await catalog.refreshExercises();
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
    const cached = readCachedProfile(pubkey);
    state.profileName = profileName(cached); state.profilePicture = cached?.picture || null;
    render();
    void fetchProfile(pubkey, profileRelays(state.settings.publicRelays)).then((profile) => {
      if (!profile || state.pubkey !== pubkey) return;
      writeCachedProfile(profile);
      state.profileName = profileName(profile); state.profilePicture = profile.picture || null;
      render();
    });
  }

  // Anonymous local account — the default; no signer involved.
  async function openLocal(): Promise<void> {
    state.pubkey = null;
    state.npub = null;
    state.profileName = null; state.profilePicture = null;
    state.signerType = null;
    state.signInStatus = null;
    await loadNamespace(LOCAL_NAMESPACE);
  }

  async function loadNamespace(namespace: string): Promise<void> {
    state.store?.close();
    state.store = await WorkstrStore.open(namespace);
    state.settings = await state.store.getSettings();
    // A saved kit is the useful default view; without one the option does not
    // exist yet and both grids stay on "All equipment".
    if (ownedEquipmentKeys(state.settings.ownedEquipment).length) {
      state.exFilter.equip = MY_EQUIPMENT;
      state.discoverFilter.equip = MY_EQUIPMENT;
    }
    // Backfills the starter programs on a fresh namespace, and is a no-op
    // afterwards. Also retires any pre-seed bundled rows on first run.
    if ((await applyStarterSeed(state.store)).applied) state.settings = await state.store.getSettings();
    catalog.primeFromCache();
    await refreshFromStore();
    // Last: the engine attaches a change listener to this store, and every load step
    // above is a write it must not mistake for something the user did.
    void backup.resume();
  }

  // Re-reads everything the screen draws from the database after restore/sync writes;
  // without this the UI can look empty until a manual reload.
  async function refreshFromStore(): Promise<void> {
    if (!state.store) return;
    state.settings = await state.store.getSettings();
    state.finishedSessions = await sessionPersistence.loadFinished();
    state.bodyEntries = await state.store.listBody();
    state.sheets = await state.store.listSheets();
    state.programZapAttempts = await state.store.listWorkoutProgramZapAttempts();
    await catalog.reloadLibrary();
    state.activeSession = await sessionPersistence.loadUnfinished();
    await nwc.loadConnection(); render();
  }

  // `toTop`: moving to another view is a new page to the reader, not a redraw.
  function render(options: { toTop?: boolean } = {}): void {
    preservingScroll(root, () => {
      root.innerHTML = shellMarkup(state);
      bind();
      if (state.activeSession) void sessionRunner.openSessionOverlay(state.activeSession);
      identity.renderIfPending();
      programBuilder.renderIfOpen();
    }, options.toTop);
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.view = button.dataset.view as View;
      state.editingId = null;
      render({ toTop: true });
      if (state.view === 'exercises' && !state.discoverExercises.length) void catalog.refreshExercises();
      if (state.view === 'workouts' && !state.programs.length) void catalog.refreshPrograms();
      if (state.view === 'settings') void preferences.refreshFunding();
    }));
    root.querySelectorAll<HTMLElement>('[data-subtab]').forEach((button) => button.addEventListener('click', () => {
      const parent = button.dataset.parent as keyof AppState['subState'];
      if (parent && parent in state.subState) {
        (state.subState[parent] as SubView) = button.dataset.subtab as SubView;
        state.view = parent as View;
        state.editingId = null;
        render({ toTop: true });
        if (parent === 'exercises' && !state.discoverExercises.length) void catalog.refreshExercises();
        if (parent === 'workouts' && !state.programs.length) void catalog.refreshPrograms();
      }
    }));
    root.querySelector('#account-chip')?.addEventListener('click', () => { if (!state.pubkey) { identity.startAccountChoice(); return; } state.view = 'settings'; render({ toTop: true }); void preferences.refreshFunding(); });
    root.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) => button.addEventListener('click', () => {
      void navigator.clipboard.writeText(button.dataset.copy || '')
        .then(() => toast('Copied'), () => toast('Could not copy', 'bad'));
    }));
    root.querySelector('#sign-in-settings')?.addEventListener('click', () => identity.startAccountChoice());
    root.querySelector('#sign-in-nip07')?.addEventListener('click', () => { void identity.connectNip07(); });
    root.querySelector('#sign-out-settings')?.addEventListener('click', () => { void identity.signOut(); });
    root.querySelector('#remove-account-data')?.addEventListener('click', () => { void identity.signOutAndRemoveData(); });
    root.querySelector('#unit-select')?.addEventListener('change', (event) => { void preferences.saveUnitPreference((event.target as HTMLSelectElement).value); });
    root.querySelectorAll('.equip-toggle').forEach((box) => box.addEventListener('change', () => { void preferences.saveOwnedEquipment(); }));
    root.querySelector('#auto-backup')?.addEventListener('change', (event) => { void backup.setEnabled((event.target as HTMLInputElement).checked); }); root.querySelector('#enable-sync')?.addEventListener('click', () => { void backup.setEnabled(true); });
    root.querySelector('#sync-now')?.addEventListener('click', () => { void backup.syncNow(); });
    root.querySelector('#export-data')?.addEventListener('click', () => { void preferences.exportUserData(); });
    root.querySelector('#import-data')?.addEventListener('click', () => root.querySelector<HTMLInputElement>('#import-file')?.click());
    root.querySelector('#import-file')?.addEventListener('change', (event) => { void preferences.importUserData(event.target as HTMLInputElement); });
    root.querySelectorAll('#refresh-exercises').forEach((button) => button.addEventListener('click', () => { void catalog.refreshExercises(); }));
    root.querySelectorAll('#refresh-programs').forEach((button) => button.addEventListener('click', () => { void catalog.refreshPrograms(); }));
    root.querySelector('#ex-search')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#ex-search'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    root.querySelector('#ex-cat')?.addEventListener('change', (event) => { state.exFilter.cat = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-muscle')?.addEventListener('change', (event) => { state.exFilter.muscle = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-diff')?.addEventListener('change', (event) => { state.exFilter.diff = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#ex-equip')?.addEventListener('change', (event) => { state.exFilter.equip = (event.target as HTMLSelectElement).value; render(); });
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
      if (fav) { void catalog.toggleFavourite(fav.dataset.fav || ''); return; }
      if (!card) return;
      const exercise = state.library.find((entry) => entry.slug === card.dataset.slug);
      if (exercise) catalog.openExerciseDetail(exercise, 'library');
    });
    root.querySelector('#lib-select-toggle')?.addEventListener('click', () => { state.librarySelect = { active: true, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-cancel')?.addEventListener('click', () => { state.librarySelect = { active: false, slugs: new Set() }; render(); });
    root.querySelector('#lib-select-all')?.addEventListener('click', () => {
      const visible = filterExercises(state.library, { ...state.exFilter, q: state.filter, ownedEquipment: state.settings.ownedEquipment }).map((exercise) => exercise.slug);
      const allSelected = visible.length > 0 && visible.every((slug) => state.librarySelect.slugs.has(slug));
      state.librarySelect.slugs = allSelected ? new Set() : new Set(visible);
      render();
    });
    root.querySelector('#lib-delete-selected')?.addEventListener('click', () => { void catalog.deleteSelectedExercises(); });
    root.querySelector('#discover-refresh')?.addEventListener('click', () => { void catalog.refreshExercises(); });
    root.querySelector('#program-discover-refresh')?.addEventListener('click', () => { void catalog.refreshPrograms(); });
    root.querySelector('#discover-search')?.addEventListener('input', (event) => { state.discoverFilter.q = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#discover-search'); input?.focus(); input?.setSelectionRange(state.discoverFilter.q.length, state.discoverFilter.q.length); });
    root.querySelector('#discover-cat')?.addEventListener('change', (event) => { state.discoverFilter.cat = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-muscle')?.addEventListener('change', (event) => { state.discoverFilter.muscle = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-diff')?.addEventListener('change', (event) => { state.discoverFilter.diff = (event.target as HTMLSelectElement).value; render(); });
    root.querySelector('#discover-equip')?.addEventListener('change', (event) => { state.discoverFilter.equip = (event.target as HTMLSelectElement).value; render(); });
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
      if (importButton) { void catalog.importDiscovered(exercise, importButton); return; }
      catalog.openExerciseDetail(exercise, 'discover');
    });
    root.querySelector('#discover-select-toggle')?.addEventListener('click', () => { state.discoverSelect = { active: true, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-cancel')?.addEventListener('click', () => { state.discoverSelect = { active: false, addresses: new Set() }; render(); });
    root.querySelector('#discover-select-all')?.addEventListener('click', () => {
      const visible = filterExercises(state.discoverExercises, { ...state.discoverFilter, ownedEquipment: state.settings.ownedEquipment });
      const importable = discoverImportable(visible, state.library).map((exercise) => exercise.nostr_address || exercise.slug);
      const allSelected = importable.length > 0 && importable.every((address) => state.discoverSelect.addresses.has(address));
      state.discoverSelect.addresses = allSelected ? new Set() : new Set(importable);
      render();
    });
    root.querySelector('#discover-import-selected')?.addEventListener('click', () => { void catalog.importSelectedDiscovered(); });
    root.querySelector('#program-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelector('#program-discover-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-discover-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelectorAll<HTMLSelectElement>('[data-program-filter]').forEach((select) => select.addEventListener('change', () => { const key = select.dataset.programFilter as keyof NonNullable<AppState['programFilters']>; state.programFilters ||= { goal: '', focus: '', format: '', equipment: '' }; state.programFilters[key] = select.value; render(); }));
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
      if (program) await catalog.importProgram(program, button as HTMLButtonElement);
    }));
    programPublish.bind();
    root.querySelector('#new-program')?.addEventListener('click', () => { void programBuilder.open(); });
    root.querySelectorAll<HTMLElement>('[data-edit-sheet]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const sheet = state.sheets.find((item) => item.id === Number(button.dataset.editSheet));
      if (sheet) void programBuilder.open(sheet);
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
    root.querySelectorAll<HTMLElement>('[data-delete-session]').forEach((button) => button.addEventListener('click', () => { void preferences.deleteSession(Number(button.dataset.deleteSession)); }));
    root.querySelectorAll<HTMLElement>('[data-repeat-session]').forEach((button) => button.addEventListener('click', () => {
      const source = state.finishedSessions.find((item) => item.id === Number(button.dataset.repeatSession));
      if (source) void sessionRunner.repeatSession(source);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-publish-session]').forEach((button) => button.addEventListener('click', () => {
      const session = state.finishedSessions.find((item) => item.id === Number(button.dataset.publishSession));
      if (session) void sessionRunner.publishSessionSummary(session, button);
    }));
    root.querySelectorAll<HTMLElement>('[data-toggle-session]').forEach((head) => head.addEventListener('click', () => {
      const id = Number(head.dataset.toggleSession) || 0;
      state.expandedSessionId = state.expandedSessionId === id ? null : id;
      render();
    }));
    bindHistoryCalendar(); nwc.bind();
    preferences.bindRecoveryControls();
    preferences.bindBodyControls();
  }

  // Month navigation and day selection are transient view state, so both just mutate the
  // history slice and rerender. "Today" clears the month override rather than pinning the
  // current month, so the calendar keeps following the clock over a midnight boundary.
  function bindHistoryCalendar(): void {
    root.querySelectorAll<HTMLElement>('[data-history-month]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.historyMonth;
      const current = state.history.monthKey || monthKeyOf(dateKeyFromDate(new Date()));
      if (action === 'today') {
        state.history.monthKey = null;
      } else {
        state.history.monthKey = addMonths(current, action === 'next' ? 1 : -1);
      }
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-history-date]').forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.historyDate || '';
      if (!isDateKey(key)) return;
      state.history.selectedDate = state.history.selectedDate === key ? null : key;
      render();
    }));
    const clearFilter = root.querySelector<HTMLButtonElement>('#history-clear-filter');
    if (clearFilter) clearFilter.onclick = () => { state.history.selectedDate = null; render(); };
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
  let toastTimer: number | undefined;

  createUpdateController({ root, state, toast });
  const programBuilder = createProgramBuilder({ root, state, render, openModal, closeModal, toast });
  const catalog = createCatalogController({ root, state, render, toast, openModal, closeModal, fetchProfile });
  const sessionPersistence = createSessionPersistence(state);
  const identity = createIdentityController({ root, state, render, openModal, closeModal, openLocal, openIdentity });
  const programPublish = createProgramPublishController({ root, state, render, toast, openModal, getSigner: options.programPublish?.getSigner || identity.getActiveSigner, publishCreatorProgram: options.programPublish?.publishCreatorProgram, programPublishRelays: options.programPublish?.programPublishRelays });

  const sessionRunner = createSessionRunner({
    root, state, render, toast, openModal, closeModal, wDisplay, wFmt, unitLabel,
    persistCanonCache: catalog.persistCanonCache, loadFinishedSessions: sessionPersistence.loadFinished, getActiveSigner: identity.getActiveSigner
  });
  const preferences = createPreferencesController({
    root, state, render, toast,
    startTrainingSession: sessionRunner.startTrainingSession,
    loadFinishedSessions: sessionPersistence.loadFinished
  });
  const nwc = createNwcController({ root, state, render, toast, openModal, closeModal, getSigner: identity.getActiveSigner, refreshFunding: preferences.refreshFunding, refreshProgramZapTotals: catalog.refreshProgramZapTotals });
  const backup = createBackupController({ state, render, toast, getSigner: identity.getActiveSigner, onSignerStalled: identity.dropActiveSigner, onRestored: () => { void refreshFromStore(); }, requestSignIn: () => { identity.startAccountChoice(); } });

  function unitLabel(): string { return normalizeWeightUnit(state.settings.unit); }

  function wDisplay(weight: number | null | undefined): number | null { return displayWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function wFmt(weight: number | null | undefined): string { return weight == null ? '—' : formatWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function openModal(content: string): void {
    const modal = root.querySelector('#modal');
    const host = root.querySelector('#modal-content');
    if (host) host.innerHTML = content;
    modal?.classList.add('open');
    root.querySelector('#modal-close')?.addEventListener('click', closeModal);
  }

  function closeModal(): void {
    identity.clearPending();
    programBuilder.clear();
    root.querySelector('#modal')?.classList.remove('open');
  }

  const ready = boot();
  return { state, ready, publishProgram: programPublish.publishProgram };
}
