import { nip19, SimplePool } from 'nostr-tools';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { slugify } from '../core/ids';
import { CANONICAL_REGIONS } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft } from '../db/store';
import starterExercises from '../data/starter-exercises.json';
import type { Exercise } from '../core/types';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

type View = 'exercises' | 'programs' | 'train' | 'plan' | 'progress' | 'recovery' | 'discover' | 'settings';

interface AppState {
  pubkey: string | null;
  npub: string | null;
  profileName: string | null;
  store: WorkstrStore | null;
  signerType: 'nip07' | 'nip46' | 'demo' | null;
  view: View;
  exercises: Exercise[];
  editingId: number | null;
  filter: string;
  signInStatus: string | null;
}

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'programs', label: 'Programs', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'train', label: 'Train', icon: '<path d="M8 5v14M16 5v14M8 12h8M4 9h4M16 9h4M4 15h4M16 15h4"/>' },
  { view: 'plan', label: 'Plan', icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>' },
  { view: 'progress', label: 'Progress', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'recovery', label: 'Recovery', icon: '<path d="M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z"/>' },
  { view: 'discover', label: 'Discover', icon: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06A2 2 0 017.04 4.3l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.36.5.57 1.1.6 1.7H21a2 2 0 010 4h-.09c-.61.03-1.2.24-1.51.3z"/>' }
];

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
}

function displayNpub(pubkey: string): string {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  return shortNpub(pubkey);
}

function displayIdentity(state: AppState): string {
  if (!state.pubkey) return '';
  if (state.profileName) return state.profileName;
  return displayNpub(state.pubkey);
}

async function fetchProfileName(pubkey: string): Promise<string | null> {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  const pool = new SimplePool();
  try {
    const event = await pool.get(PROFILE_RELAYS, { kinds: [0], authors: [pubkey] });
    if (!event) return null;
    const profile = JSON.parse(event.content) as { display_name?: string; name?: string; nip05?: string };
    return profile.display_name?.trim() || profile.name?.trim() || profile.nip05?.trim() || null;
  } catch {
    return null;
  } finally {
    pool.close(PROFILE_RELAYS);
  }
}

function html(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function shellMarkup(state: AppState): string {
  return `
    <div class="noise"></div>
    <div class="cyber-grid"></div>
    <header class="topbar">
      <div class="logo-zone">
        <div class="glyph">W</div>
        <div class="logo-text">
          <div class="logo-mark">Work<span>str</span></div>
          <div class="logo-tagline">sovereign training</div>
        </div>
      </div>
      <div class="topbar-actions">
        ${state.pubkey
          ? `<small id="live-status">${html(displayIdentity(state))}</small><button id="sign-out" class="button small ghost">Switch</button>`
          : '<button id="sign-in" class="button small primary">Sign in</button>'}
      </div>
    </header>
    <nav class="sidebar">
      <div class="nav-items">
        ${navItems.map((item, index) => `${index === navItems.length - 1 ? '<div class="nav-bottom">' : ''}<div class="nav-item ${state.view === item.view ? 'active' : ''}" data-view="${item.view}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span>${item.label}</span></div>${index === navItems.length - 1 ? '</div>' : ''}`).join('')}
      </div>
    </nav>
    <main class="content">
      ${appView(state)}
    </main>
    <div id="toast"></div>`;
}

function appView(state: AppState): string {
  if (state.view === 'programs') return programsView();
  if (state.view === 'train') return trainView();
  if (state.view === 'plan') return planView();
  if (state.view === 'progress') return progressView();
  if (state.view === 'recovery') return recoveryView();
  if (state.view === 'discover') return discoverView();
  if (state.view === 'settings') return settingsView(state);
  return exercisesView(state);
}

function authNotice(state: AppState): string {
  if (state.pubkey) return '';
  return `<div class="panel web-status-note"><div class="panel-head"><span>Signer required</span><span class="status-pill bad">not signed in</span></div><p class="section-help">Sign in with your Nostr signer to open the local IndexedDB namespace for your training data. Keys stay in your signer.</p>${state.signInStatus ? `<div class="terminal-mini">${html(state.signInStatus)}</div>` : ''}</div>`;
}

function exercisesView(state: AppState): string {
  const query = state.filter.toLowerCase();
  const exercises = state.exercises.filter((exercise) => {
    const haystack = [exercise.name, exercise.description, exercise.muscle_group, exercise.difficulty, ...exercise.muscles, ...exercise.equipment, ...exercise.tags].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const editing = state.editingId ? state.exercises.find((exercise) => exercise.id === state.editingId) : undefined;
  return `<div class="page active" id="page-exercises">
    <div class="page-title">Exercises</div>
    <div class="sub-tabs"><div class="sub-tab active">Library</div><div class="sub-tab">Discover</div></div>
    ${authNotice(state)}
    <div class="sub-panel active">
      <div class="panel">
        <div class="panel-head"><span>Exercise library</span><span class="head-actions"><button class="button ghost small">Select</button><button class="button primary small" id="new-exercise">+ New exercise</button></span></div>
        <div class="filter-bar"><input class="grow" id="exercise-filter" placeholder="Search exercises..." autocomplete="off" value="${html(state.filter)}" /><select><option>All categories</option></select><select><option>All muscles</option></select><select><option>All levels</option></select></div>
        <div class="ex-grid">${exercises.map(exerciseCard).join('') || '<div class="empty">No exercises match.</div>'}</div>
      </div>
      ${state.pubkey ? `<div class="panel"><div class="panel-head"><span>${editing ? 'Edit exercise' : 'New exercise'}</span></div>${exerciseForm(editing)}</div>` : ''}
    </div>
  </div>`;
}

function exerciseCard(exercise: Exercise): string {
  return `<div class="ex-card" data-id="${exercise.id}">
    <div class="card-img"><div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div><span class="source-badge badge-${exercise.source_type === 'imported' ? 'nostr' : 'manual'}">${html(exercise.source_type)}</span>${exercise.difficulty ? `<span class="diff-badge diff-${html(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}</div>
    <div class="card-body"><div class="card-name">${html(exercise.name)}<button class="fav ${exercise.favourite ? 'on' : ''}" title="Favourite">${exercise.favourite ? '★' : '☆'}</button></div><div class="card-meta"><span class="muscle">${html(exercise.muscle_group || exercise.muscles[0] || 'Muscle')}</span>${exercise.category ? `<span class="card-tag">${html(exercise.category)}</span>` : ''}</div><div class="row-actions"><button class="button small ghost" data-edit="${exercise.id}">Edit</button><button class="button small danger" data-delete="${exercise.id}">Delete</button></div></div>
  </div>`;
}

function exerciseForm(exercise?: Exercise): string {
  const muscle = exercise?.muscle_group || exercise?.muscles[0] || 'Chest';
  return `<form id="exercise-form" class="form-grid">
    <input type="hidden" name="id" value="${html(exercise?.id ?? '')}" />
    <label class="span-2">Name<input name="name" required value="${html(exercise?.name ?? '')}" /></label>
    <label>Category<input name="category" value="${html(exercise?.category ?? 'strength')}" /></label>
    <label>Muscle group<select name="muscle_group">${CANONICAL_REGIONS.map((region) => `<option ${region === muscle ? 'selected' : ''}>${region}</option>`).join('')}</select></label>
    <label>Difficulty<select name="difficulty">${['beginner', 'intermediate', 'advanced'].map((level) => `<option ${level === exercise?.difficulty ? 'selected' : ''}>${level}</option>`).join('')}</select></label>
    <label>Equipment (comma)<input name="equipment" value="${html(exercise?.equipment.join(', ') ?? '')}" /></label>
    <label>Default sets<input name="sets" type="number" min="1" value="${html(exercise?.default_sets ?? 3)}" /></label>
    <label>Default reps<input name="reps" value="${html(exercise?.default_reps ?? 10)}" /></label>
    <label>Default rest (sec)<input name="rest" type="number" min="0" value="${html(exercise?.default_rest ?? 90)}" /></label>
    <label class="span-2">Description<textarea name="description" rows="3">${html(exercise?.description ?? '')}</textarea></label>
    <label class="span-2">Instructions (one per line)<textarea name="instructions" rows="3">${html(exercise?.instructions.join('\n') ?? '')}</textarea></label>
    <div class="form-actions span-2"><button class="button primary" type="submit">${exercise ? 'Save' : 'Create'}</button>${exercise ? '<button id="cancel-edit" class="button ghost" type="button">Cancel</button>' : ''}</div>
  </form>`;
}

function programsView(): string {
  return featurePage('Programs', ['Programs', 'Discover', 'History'], 'Programs', 'A program is the routine you take to the gym. Build ordered exercises with set, rep, rest, and weight targets. Public programs become NIP-101e kind 33402 templates.');
}
function trainView(): string { return featurePage('Train', ['Session runner'], 'Live session', 'Start from a program, log sets, run rest timers, keep the screen awake, then finish and review.'); }
function planView(): string { return featurePage('Plan', ['Weekly grid', 'Mesocycle'], 'Training plan', 'Plan the week and organize mesocycle blocks. This mirrors the self-hosted Workstr planning surface.'); }
function progressView(): string { return featurePage('Progress', ['Training', 'Body'], 'Training statistics', 'Weekly volume, muscle distribution, estimated 1RM records, streaks, and body-weight logs.'); }
function recoveryView(): string { return featurePage('Recovery', ['Muscle map', 'Quick workout'], 'Muscle recovery', 'Readiness by muscle group from recent session history, with quick workout generation from recovered muscles.'); }
function discoverView(): string { return featurePage('Discover', ['Exercises', 'Programs'], 'Discover on relays', 'Browse/import NIP-101e exercises and programs from public relays with author profile display and spam filtering.'); }

function featurePage(title: string, tabs: string[], panelTitle: string, help: string): string {
  return `<div class="page active"><div class="page-title">${html(title)}</div><div class="sub-tabs">${tabs.map((tab, index) => `<div class="sub-tab ${index === 0 ? 'active' : ''}">${html(tab)}</div>`).join('')}</div><div class="panel"><div class="panel-head"><span>${html(panelTitle)}</span><span class="status-pill">phase 1</span></div><p class="section-help">${html(help)}</p><div class="list empty">This surface is wired into the Workstr Web menu and ready for the next data-module port.</div></div></div>`;
}

function settingsView(state: AppState): string {
  return `<div class="page active"><div class="page-title">Settings</div><div class="panel"><div class="panel-head"><span>Nostr signer</span><span class="status-pill ${state.pubkey ? 'ok' : 'bad'}">${state.pubkey ? 'connected' : 'not signed in'}</span></div><p class="section-help">Workstr Web replaces self-hosted Idenstr with a user-owned NIP-46 signer. Press Sign in in the top-right; the app launches the signer request directly.</p><div class="terminal-mini">secure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'not signed in')}\n${state.signInStatus ? html(state.signInStatus) : ''}</div><div class="web-empty-actions">${state.pubkey ? '<button id="sign-out-settings" class="button ghost">Switch signer</button>' : '<button id="sign-in-settings" class="button primary">Sign in</button>'}<button id="open-demo" class="button ghost">Open local demo</button></div></div><div class="panel"><div class="panel-head"><span>Preferences</span></div><label style="max-width:240px">Weight unit<select><option>Kilograms (kg)</option><option>Pounds (lbs)</option></select></label></div></div>`;
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, store: null, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', exercises: [], editingId: null, filter: '', signInStatus: null };

  async function boot(): Promise<void> {
    if (state.pubkey) await openIdentity(state.pubkey, false);
    render();
  }

  async function openIdentity(pubkey: string, persist = true, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    state.pubkey = pubkey;
    state.signerType = signerType;
    state.npub = pubkey === 'demo-local-pubkey' ? 'demo-local-pubkey' : nip19.npubEncode(pubkey);
    state.profileName = await fetchProfileName(pubkey);
    state.signInStatus = null;
    state.store = await WorkstrStore.open(pubkey);
    await state.store.seedExercises(starterExercises as ExerciseDraft[]);
    state.exercises = await state.store.listExercises();
    if (persist) {
      localStorage.setItem(SESSION_KEY, pubkey);
      if (signerType) localStorage.setItem(SIGNER_TYPE_KEY, signerType);
    }
  }

  function render(): void {
    root.innerHTML = shellMarkup(state);
    bind();
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view as View; state.editingId = null; render(); }));
    root.querySelector('#sign-in')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-in-settings')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-out')?.addEventListener('click', signOut);
    root.querySelector('#sign-out-settings')?.addEventListener('click', signOut);
    root.querySelector('#open-demo')?.addEventListener('click', () => openAndRender('demo-local-pubkey'));
    root.querySelector('#new-exercise')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#cancel-edit')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#exercise-filter')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#exercise-filter'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    root.querySelector('#exercise-form')?.addEventListener('submit', saveExercise);
    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = Number(button.dataset.edit); render(); }));
    root.querySelectorAll<HTMLElement>('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteExercise(Number(button.dataset.delete))));
  }

  function signOut(): void {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SIGNER_TYPE_KEY);
    state.pubkey = null; state.npub = null; state.profileName = null; state.store = null; state.signerType = null; state.exercises = []; state.editingId = null; state.signInStatus = null;
    render();
  }

  async function connectNip07(): Promise<void> {
    try {
      const signer = createNip07Signer();
      const pubkey = await signer.getPublicKey();
      await openAndRender(pubkey, 'nip07');
    } catch (error) {
      state.signInStatus = `extension signer error ${(error as Error).message}`;
      render();
    }
  }

  async function startRemoteSignerRequest(): Promise<void> {
    try {
      state.signInStatus = 'creating open signer request...'; render();
      const request = createNostrConnectSignerRequest(defaultBunkerRelays(), { onAuthUrl: launchSignerRequest });
      state.signInStatus = `launching signer request; approve it, then return to this tab; waiting on ${request.relays.join(', ')}`;
      launchSignerRequest(request.uri); render();
      const connected = await request.signer;
      await openAndRender(connected.pubkey, 'nip46');
    } catch (error) {
      state.signInStatus = `signer error ${(error as Error).message}`;
      render();
    }
  }

  function launchSignerRequest(uri: string): void {
    const link = document.createElement('a');
    link.href = uri; link.target = '_blank'; link.rel = 'noreferrer'; link.style.display = 'none';
    document.body.appendChild(link); link.click(); link.remove();
  }

  async function openAndRender(pubkey: string, signerType: AppState['signerType'] = pubkey === 'demo-local-pubkey' ? 'demo' : state.signerType): Promise<void> {
    await openIdentity(pubkey, true, signerType);
    render();
  }

  async function saveExercise(event: Event): Promise<void> {
    event.preventDefault();
    if (!state.store) return;
    const data = new FormData(event.target as HTMLFormElement);
    const name = String(data.get('name') || '').trim();
    const id = Number(data.get('id')) || undefined;
    const primary = String(data.get('muscle_group') || 'Chest');
    await state.store.upsertExercise({
      id,
      slug: id ? state.exercises.find((exercise) => exercise.id === id)?.slug || slugify(name) : slugify(name),
      name,
      description: String(data.get('description') || '').trim(),
      category: String(data.get('category') || 'strength').trim(),
      muscle_group: primary,
      muscles: [primary],
      equipment: splitList(data.get('equipment')),
      difficulty: String(data.get('difficulty') || 'beginner'),
      tags: [],
      instructions: String(data.get('instructions') || '').split('\n').map((line) => line.trim()).filter(Boolean),
      favourite: false,
      default_sets: Number(data.get('sets')) || undefined,
      default_reps: Number(data.get('reps')) || undefined,
      default_rest: Number(data.get('rest')) || undefined,
      source_type: 'manual',
      status: 'active'
    });
    state.exercises = await state.store.listExercises();
    state.editingId = null;
    render();
  }

  async function deleteExercise(id: number): Promise<void> {
    if (!state.store) return;
    await state.store.deleteExercise(id);
    state.exercises = await state.store.listExercises();
    render();
  }

  void connectNip07;
  void boot();
}
