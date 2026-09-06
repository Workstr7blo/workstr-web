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
import { accountIdentity, updateAccountIdentity } from './account-chip';
import { appView, pageOverlays, shellFrame, updateNavigation } from './layout';
import { bindProgramBrowser } from './program-browser-controller';
import { bindExerciseBrowser } from './exercise-browser-controller';
import { exerciseResults } from './exercise-browser';
import { createSessionRunner } from './session-runner';
import { paintBodyMapSvg } from './bodymap';
import { createRenderTrace, rebuildRoot, type RenderOptions } from './root-rebuild';
import { discoverImportable, discoverImportState } from '../features/discover/views';
import { getRecovery, type RecoveryGroup } from '../features/recovery/recovery';
import { getQuickWorkout } from '../features/recovery/quickWorkout';
import { sheetToProgram } from '../features/sheets/views';
import { createUpdateController } from './update-controller';
import { createProgramBuilder } from './program-builder';
import { createSessionPersistence } from './session-persistence';
import { createCatalogController } from './catalog-controller';
import { migrateLegacyLocalSecret } from '../signer/local-key-storage';
import { createIdentityController, launchSignerUri } from './identity-controller';
import { createPreferencesController } from './preferences-controller';
import { createBackupController } from './backup-controller';
import { createNwcController } from './nwc-controller';
import { createMoneroAddressController } from './monero-address-controller';
import { createMoneroTipController } from './monero-tip-controller';
import { createProgramPublishController } from './program-publish-controller';
import type { ShellHandle, ShellOptions } from './shell-types';
export { launchSignerUri };
const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const DEFAULT_SETTINGS: WorkstrSettings = { unit: 'kg', paymentMode: 'lightning', publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'] };

function profileName(profile: RelayProfile | null): string | null { return profile?.name?.trim() || profile?.nip05?.trim() || null; }

export function renderShell(root: HTMLElement, options: ShellOptions = {}): ShellHandle {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, profilePicture: null, profileNames: {}, authorProfiles: {}, authorPaymentTargets: {}, store: null, settings: { ...DEFAULT_SETTINGS }, support: { status: 'idle', receipts: [] }, nwc: { active: false, status: 'idle' }, monero: { status: 'idle', address: '' }, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], programZapTotals: {}, programZapAttempts: [], activeSession: null, finishedSessions: [], publishingSessionId: null, publishingStatus: null, editingId: null, filter: '', programFilter: '', programFilters: { goal: '', focus: '', format: '', equipment: '' }, programFilterSheet: null, expandedProgramAddress: null, exerciseStatus: 'loading the Workstr catalog from relays...', programStatus: '', signInStatus: null, backup: { state: 'off', pending: 0 }, expandedSessionId: null, history: { monthKey: null, selectedDate: null }, qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false }, bodyEntries: [], sheets: [], library: [], librarySelect: { active: false, slugs: new Set<string>() }, discoverSelect: { active: false, addresses: new Set<string>() }, discoverExercises: [], exFilter: { cat: '', muscle: '', diff: '', equip: '' }, discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' } };

  const trace = createRenderTrace();
  async function boot(): Promise<void> {
    // Installs from before demo mode was removed may still have the fake
    // demo pubkey persisted; it is not valid hex and would crash npubEncode.
    if (state.pubkey === 'demo-local-pubkey') {
      state.pubkey = null;
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SIGNER_TYPE_KEY);
    }
    // Paint the shell immediately; data lands on the next render. Nothing above this line
    // may await, or the first paint slips to a microtask and the shell renders empty.
    mount();
    // Every boot, not on the first call that wants a signer: someone who only reads their
    // history would otherwise keep the plaintext key on disk forever. Cleanup, so it runs
    // after first paint and a failure is swallowed — the key just stays where it was.
    await migrateLegacyLocalSecret().catch(() => undefined);
    if (state.pubkey) await openIdentity(state.pubkey, false);
    else await openLocal();
    render({ reason: 'boot-account-open' });
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
    render({ reason: 'profile-cached' });
    void fetchProfile(pubkey, profileRelays(state.settings.publicRelays)).then((profile) => {
      if (!profile || state.pubkey !== pubkey) return;
      writeCachedProfile(profile);
      state.profileName = profileName(profile); state.profilePicture = profile.picture || null;
      // A name and a picture change the chip and the Settings Account card and nothing else,
      // and this lands seconds after launch, wherever the reader has got to by then.
      if (!updateAccountIdentity(root, accountIdentity(state))) render({ reason: 'profile-relay' });
    });
  }

  // Anonymous local account — the default; no signer involved.
  async function openLocal(): Promise<void> {
    state.pubkey = null; state.npub = null;
    state.profileName = null; state.profilePicture = null;
    state.signerType = null; state.signInStatus = null;
    await loadNamespace(LOCAL_NAMESPACE);
  }

  async function loadNamespace(namespace: string): Promise<void> {
    state.store?.close();
    // The Monero address belongs to whoever is signed in, so it is dropped with the
    // namespace rather than carried into the next account's Settings.
    state.monero = { status: 'idle', address: '' };
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
    await nwc.loadConnection(); render({ reason: 'store-reload' });
  }

  // Written once. The topbar, the navigation, the scroll pane, the live session overlay,
  // the modal host and the toast outlive every page after this.
  function mount(): void {
    applyPaymentMode();
    root.innerHTML = shellFrame(state);
    bindFrame();
    render({ reason: 'boot-first-paint' });
  }

  // Monero Mode is a token swap, and the tokens are declared on `:root`, so the flag has to
  // land there too — an override on `body` cannot win against a `:root` declaration.
  function applyPaymentMode(): void {
    if (state.settings.paymentMode === 'monero') document.documentElement.setAttribute('data-payment-mode', 'monero');
    else document.documentElement.removeAttribute('data-payment-mode');
  }

  // `render` means the page: the host and the sheets that belong to it. `toTop` is a new
  // page to the reader, not a redraw; `reason` is for the trace alone.
  function render(options: RenderOptions = {}): void {
    applyPaymentMode();
    rebuildRoot(root, state, () => {
      const host = root.querySelector('#page-host');
      if (host) host.innerHTML = appView(state);
      const overlays = root.querySelector('#page-overlays');
      if (overlays) overlays.innerHTML = pageOverlays(state);
      bind();
      updateNavigation(root, state);
      updateAccountIdentity(root, accountIdentity(state));
      // Only when it is not already open: the overlay is mounted with the frame now, so a
      // page render has nothing to put back. This is the restored-session case at boot.
      if (state.activeSession && !root.querySelector('#session-overlay')?.classList.contains('open')) void sessionRunner.openSessionOverlay(state.activeSession);
      // Both re-render modal content that a root wipe used to take away. #178 retires them
      // with the modal host now standing; they are harmless and behaviour-preserving here.
      identity.renderIfPending();
      programBuilder.renderIfOpen();
    }, { ...options, trace });
  }

  // Bound once, to elements a page render does not replace. Navigation is delegated from
  // the root because a page can carry a jump of its own - Statistics offers "Go to
  // Workouts", an empty library offers "Browse Discover" - and those buttons come and go.
  function bindFrame(): void {
    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const view = target.closest<HTMLElement>('[data-view]');
      if (view) return openView(view.dataset.view as View);
      const subtab = target.closest<HTMLElement>('[data-subtab]');
      const parent = subtab?.dataset.parent as keyof AppState['subState'] | undefined;
      if (!subtab || !parent || !(parent in state.subState)) return;
      (state.subState[parent] as SubView) = subtab.dataset.subtab as SubView;
      openView(parent as View, 'navigate-subtab');
    });
    root.querySelector('#account-chip')?.addEventListener('click', () => {
      if (!state.pubkey) return identity.startAccountChoice();
      openView('settings', 'navigate-account-chip');
    });
    // The close button belongs to the modal card, which is part of the frame. It used to be
    // bound on every open because the card was thrown away with the root; binding it there
    // now would stack one listener per modal opened.
    root.querySelector('#modal-close')?.addEventListener('click', closeModal);
  }

  function openView(view: View, reason = 'navigate-view'): void {
    state.view = view;
    state.editingId = null;
    render({ toTop: true, reason });
    if (view === 'exercises' && !state.discoverExercises.length) void catalog.refreshExercises();
    if (view === 'workouts' && !state.programs.length) void catalog.refreshPrograms();
    if (view === 'settings') { void preferences.refreshFunding(); moneroAddress.refreshIfNeeded(); }
  }

  // Everything a page render replaces, rebound with it.
  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) => button.addEventListener('click', () => {
      void navigator.clipboard.writeText(button.dataset.copy || '')
        .then(() => toast('Copied'), () => toast('Could not copy', 'bad'));
    }));
    identity.bindSettingsAuth();
    root.querySelector('#unit-select')?.addEventListener('change', (event) => { void preferences.saveUnitPreference((event.target as HTMLSelectElement).value); });
    root.querySelectorAll('input[name="payment-mode"]').forEach((input) => input.addEventListener('change', (event) => {
      const rail = event.target as HTMLInputElement;
      // Picking Monero reveals the payment-address section and makes Discover's authors
      // worth asking about, so both lookups start once the rerender has landed.
      if (rail.checked) void preferences.savePaymentMode(rail.value).then(() => { moneroAddress.refreshIfNeeded(); void catalog.refreshAuthorPaymentTargets(); });
    }));
    root.querySelectorAll('.equip-toggle').forEach((box) => box.addEventListener('change', () => { void preferences.saveOwnedEquipment(); }));
    root.querySelector('#auto-backup')?.addEventListener('change', (event) => { void backup.setEnabled((event.target as HTMLInputElement).checked); }); root.querySelector('#enable-sync')?.addEventListener('click', () => { void backup.setEnabled(true); });
    root.querySelector('#sync-now')?.addEventListener('click', () => { void backup.syncNow(); });
    root.querySelector('#export-data')?.addEventListener('click', () => { void preferences.exportUserData(); });
    root.querySelector('#import-data')?.addEventListener('click', () => root.querySelector<HTMLInputElement>('#import-file')?.click());
    root.querySelector('#import-file')?.addEventListener('change', (event) => { void preferences.importUserData(event.target as HTMLInputElement); });
    root.querySelectorAll('#refresh-exercises').forEach((button) => button.addEventListener('click', () => { void catalog.refreshExercises(); }));
    root.querySelectorAll('#refresh-programs').forEach((button) => button.addEventListener('click', () => { void catalog.refreshPrograms(); }));
    root.querySelector('#ex-search')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#ex-search'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    bindExerciseBrowser({ root, state, render, catalog });
    root.querySelector('#discover-refresh')?.addEventListener('click', () => { void catalog.refreshExercises(); });
    root.querySelector('#program-discover-refresh')?.addEventListener('click', () => { void catalog.refreshPrograms(); });
    root.querySelector('#discover-search')?.addEventListener('input', (event) => { state.discoverFilter.q = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#discover-search'); input?.focus(); input?.setSelectionRange(state.discoverFilter.q.length, state.discoverFilter.q.length); });
    root.querySelector('#program-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelector('#program-discover-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-discover-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    bindProgramBrowser({ root, state, render });
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
    bindHistoryCalendar(); nwc.bind(); moneroAddress.bind(); moneroTip.bind();
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
  const preferences = createPreferencesController({ root, state, render, toast, startTrainingSession: sessionRunner.startTrainingSession, loadFinishedSessions: sessionPersistence.loadFinished });
  const nwc = createNwcController({ root, state, render, toast, openModal, closeModal, getSigner: identity.getActiveSigner, refreshFunding: preferences.refreshFunding, refreshProgramZapTotals: catalog.refreshProgramZapTotals });
  const moneroAddress = createMoneroAddressController({ root, state, toast, getSigner: identity.getActiveSigner });
  const moneroTip = createMoneroTipController({ root, state, toast, openModal });
  const backup = createBackupController({ root, state, render, toast, getSigner: identity.getActiveSigner, onSignerStalled: identity.dropActiveSigner, onRestored: () => { void refreshFromStore(); }, requestSignIn: () => { identity.startAccountChoice(); } });

  function unitLabel(): string { return normalizeWeightUnit(state.settings.unit); }

  function wDisplay(weight: number | null | undefined): number | null { return displayWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function wFmt(weight: number | null | undefined): string { return weight == null ? '—' : formatWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function openModal(content: string): void {
    const modal = root.querySelector('#modal');
    const host = root.querySelector('#modal-content');
    if (host) host.innerHTML = content;
    modal?.classList.add('open');
  }

  function closeModal(): void {
    identity.clearPending();
    // Whatever route the modal closed by - the X, the backdrop, a cancel button - the
    // camera and the relay subscription stop with it. Release is idempotent.
    identity.releasePairing();
    programBuilder.clear();
    root.querySelector('#modal')?.classList.remove('open');
  }

  const ready = boot();
  return { state, ready, renders: trace, publishProgram: programPublish.publishProgram };
}
