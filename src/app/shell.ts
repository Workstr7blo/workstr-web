import { nip19, SimplePool } from 'nostr-tools';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { slugify } from '../core/ids';
import { CANONICAL_REGIONS } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft } from '../db/store';
import starterExercises from '../data/starter-exercises.json';
import type { Exercise } from '../core/types';
import { fetchRelayExercises, fetchRelayPrograms, WORKSTR_LIBRARY_RELAY, type RelayProgram } from '../nostr/powrLibrary';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

type View = 'exercises' | 'workouts' | 'statistics' | 'settings';
type SubView = 'library' | 'discover' | 'programs' | 'history' | 'recovery' | 'training' | 'body';

interface AppState {
  pubkey: string | null;
  npub: string | null;
  profileName: string | null;
  store: WorkstrStore | null;
  signerType: 'nip07' | 'nip46' | 'demo' | null;
  view: View;
  subState: { exercises: 'library' | 'discover'; workouts: 'programs' | 'discover' | 'history' | 'recovery'; statistics: 'training' | 'body' };
  exercises: Exercise[];
  programs: RelayProgram[];
  editingId: number | null;
  filter: string;
  programFilter: string;
  expandedProgramAddress: string | null;
  exerciseStatus: string;
  programStatus: string;
  signInStatus: string | null;
}

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'workouts', label: 'Workouts', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'statistics', label: 'Statistics', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' }
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

function sourceBadge(exercise: Exercise): string {
  if (exercise.nostr_address) return 'workstr';
  return exercise.source_type;
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
  if (state.view === 'workouts') return workoutsView(state);
  if (state.view === 'statistics') return statisticsView(state);
  if (state.view === 'settings') return settingsView(state);
  return exercisesView(state);
}

function authNotice(state: AppState): string {
  if (state.pubkey) return '';
  return `<div class="panel web-status-note"><div class="panel-head"><span>Signer required</span><span class="status-pill bad">not signed in</span></div><p class="section-help">Sign in with your Nostr signer to open the local IndexedDB namespace for your training data. Keys stay in your signer.</p>${state.signInStatus ? `<div class="terminal-mini">${html(state.signInStatus)}</div>` : ''}</div>`;
}

function subTabs(parent: View, active: string, tabs: string[]): string {
  return `<div class="sub-tabs">${tabs.map((tab) => {
    const value = tab.toLowerCase();
    return `<div class="sub-tab ${active === value ? 'active' : ''}" data-parent="${parent}" data-subtab="${value}">${html(tab)}</div>`;
  }).join('')}</div>`;
}

function exercisesView(state: AppState): string {
  const query = state.filter.toLowerCase();
  const exercises = state.exercises.filter((exercise) => {
    const haystack = [exercise.name, exercise.description, exercise.muscle_group, exercise.difficulty, ...exercise.muscles, ...exercise.equipment, ...exercise.tags].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const active = state.subState.exercises;
  return `<div class="page active" id="page-exercises">
    <div class="page-title">Exercises</div>
    ${subTabs('exercises', active, ['Library', 'Discover'])}
    ${authNotice(state)}
    <div class="sub-panel ${active === 'library' ? 'active' : ''}" id="sub-exercises-library">
      <div class="panel">
        <div class="filter-bar"><input class="grow" id="exercise-filter" placeholder="Search exercises..." autocomplete="off" value="${html(state.filter)}" /><select><option>All categories</option></select><select><option>All muscles</option></select><select><option>All levels</option></select></div>
        <div class="ex-grid">${exercises.map(exerciseCard).join('') || '<div class="empty">No exercises match.</div>'}</div>
      </div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-exercises-discover">
      <div class="panel">
        <div class="filter-bar"><input class="grow" placeholder="Search exercises..." autocomplete="off" /><select><option>All categories</option></select><select><option>All muscles</option></select><select><option>All levels</option></select></div>
        <div class="ex-grid"></div>
      </div>
    </div>
  </div>`;
}

function exerciseCard(exercise: Exercise): string {
  return `<div class="ex-card" data-id="${exercise.id ?? exercise.nostr_event_id ?? exercise.slug}">
    <div class="card-img">${exercise.image_url ? `<img src="${html(exercise.image_url)}" alt="${html(exercise.name)}" loading="lazy" />` : '<div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>'}<span class="source-badge badge-nostr">${html(sourceBadge(exercise))}</span>${exercise.difficulty ? `<span class="diff-badge diff-${html(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}</div>
    <div class="card-body"><div class="card-name">${html(exercise.name)}<button class="fav ${exercise.favourite ? 'on' : ''}" title="Favourite">${exercise.favourite ? '★' : '☆'}</button></div><div class="card-meta"><span class="muscle">${html(exercise.muscle_group || exercise.muscles[0] || 'Muscle')}</span>${exercise.category ? `<span class="card-tag">${html(exercise.category)}</span>` : ''}</div><div class="detail-nostr"><code>${html(exercise.nostr_address || '')}</code></div></div>
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

function workoutsView(state: AppState): string {
  const active = state.subState.workouts;
  const query = state.programFilter.toLowerCase();
  const programs = state.programs.filter((program) => [program.name, program.description, ...program.tags].join(' ').toLowerCase().includes(query));
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      <div class="panel"><div class="filter-bar"><input class="grow" id="program-filter" placeholder="Search programs..." autocomplete="off" value="${html(state.programFilter)}" /></div><div class="program-list">${programs.map((program) => programCard(program, state)).join('') || '<div class="empty">No workouts match.</div>'}</div></div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      <div class="panel"><div class="filter-bar"><input class="grow" placeholder="Search programs..." autocomplete="off" /></div><div class="program-list">${state.programs.map((program) => programCard(program, state)).join('')}</div></div>
    </div>
    <div class="sub-panel ${active === 'history' ? 'active' : ''}" id="sub-workouts-history">
      <div class="panel"><div class="panel-head"><span>Workout history</span></div><p class="section-help">Every completed session, newest first. Expand one to see the exercises and sets you logged; delete it to remove it from your history and stats.</p><div class="list empty">No completed sessions yet.</div></div>
    </div>
    <div class="sub-panel ${active === 'recovery' ? 'active' : ''}" id="sub-workouts-recovery">
      <div class="panel"><div class="panel-head"><span>Muscle recovery</span><strong>—</strong></div><p class="section-help">Estimated readiness per muscle group from your completed sessions over the last 10 days. Bigger groups recover slower; higher training volume extends recovery.</p><div class="recovery empty">No completed sessions yet — train to see recovery.</div></div>
      <div class="panel"><div class="panel-head"><span>Quick workout</span><div class="qw-duration"><button class="qw-dur-btn">20</button><button class="qw-dur-btn">30</button><button class="qw-dur-btn active">45</button><button class="qw-dur-btn">60</button><span class="qw-dur-unit">min</span></div></div><p class="section-help">Generates a balanced session from exercises whose muscle groups are recovered. Pick a duration, then swap or drop any exercise before you start.</p><button class="button primary" style="width:100%">Generate from recovered muscles</button></div>
    </div>
  </div>`;
}

function estimateProgramMin(exercises: RelayProgram['exercises']): number {
  return exercises.reduce((total, exercise) => {
    const sets = Number(exercise.sets) || 3;
    const rest = Number(exercise.restSec || exercise.rest) || 90;
    return total + sets * 45 + Math.max(0, sets - 1) * rest;
  }, 0);
}

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function resolveProgramExercise(member: RelayProgram['exercises'][number], exercises: Exercise[]): Exercise | null {
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

function programMuscleLabel(raw?: string): string {
  const value = String(raw || '').trim();
  const key = value.toLowerCase();
  if (['biceps', 'triceps', 'brachialis', 'brachioradialis', 'forearms', 'forearm'].includes(key)) return 'Arms';
  if (['shoulder', 'shoulders', 'deltoid', 'deltoids', 'lateral deltoid', 'anterior deltoid', 'posterior deltoid', 'supraspinatus'].includes(key)) return 'Shoulders';
  return value;
}

function programGroups(program: RelayProgram, exercises: Exercise[]): string[] {
  const groups = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const primary = programMuscleLabel(member.muscleGroup || full?.muscle_group);
    if (primary) groups.add(primary);
  }
  return [...groups];
}

function exerciseImage(src?: string): string {
  return src
    ? `<img class="wk-ex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wk-ex-img placeholder'}))">`
    : `<div class="wk-ex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
}

function programExerciseName(member: RelayProgram['exercises'][number], full: Exercise | null): string {
  const slugName = member.address ? member.address.split(':').pop()?.replace(/^workstr:exercise:/, '').replace(/[-_]+/g, ' ') : '';
  return member.name || full?.name || slugName || 'Exercise';
}

function programCard(program: RelayProgram, state: AppState): string {
  const exerciseCount = program.exercises.length;
  const time = formatMinutes(estimateProgramMin(program.exercises));
  const groups = programGroups(program, state.exercises);
  const meta = [`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`, program.description ? html(program.description) : '', time ? `~${time}` : ''].filter(Boolean).join(' · ');
  const isExpanded = state.expandedProgramAddress === program.address;
  return `<div class="workout-card ${isExpanded ? 'expanded' : ''}" data-program-address="${html(program.address)}">
    <div class="workout-card-header" data-toggle-program="${html(program.address)}">
      <div class="workout-card-map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(program.name)}<span class="program-status published">${html(program.sourceLabel || 'Workstr')}</span></div>
        <div class="workout-card-meta">${meta}</div>
        <div class="workout-card-author">${html(program.pubkey ? `${program.pubkey.slice(0, 8)}…` : 'unknown')}</div>
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body">${isExpanded ? programBody(program, state.exercises) : ''}</div>
  </div>`;
}

function programBody(program: RelayProgram, exercises: Exercise[]): string {
  const exHtml = program.exercises.length ? program.exercises.map((member, index) => {
    const full = resolveProgramExercise(member, exercises);
    const name = programExerciseName(member, full);
    const muscle = programMuscleLabel(member.muscleGroup || full?.muscle_group);
    const image = exerciseImage(member.imageUrl || full?.image_url);
    const sets = Number(member.sets) || 3;
    const reps = member.reps || String(full?.default_reps || '8-12');
    const weight = member.weight != null && member.weight !== '' ? ` @ ${html(member.weight)}` : '';
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
          <div class="wk-ex-detail-cell"><div class="val">${member.weight != null && member.weight !== '' ? html(member.weight) : '—'}</div><div class="lbl">Weight</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${rest}s</div><div class="lbl">Rest</div></div>
        </div>
        ${member.notes ? `<div class="wk-ex-detail-note">${html(member.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="empty" style="padding:10px 0">No exercises yet.</p>';
  return `<div class="wk-ex-list">${exHtml}</div>
    <div class="workout-card-actions">
      <button class="button gold small" type="button">Start workout</button>
    </div>`;
}

function statisticsView(state: AppState): string {
  const active = state.subState.statistics;
  return `<div class="page active" id="page-statistics">
    <div class="page-title">Statistics</div>
    ${subTabs('statistics', active, ['Training', 'Body'])}
    <div class="sub-panel ${active === 'training' ? 'active' : ''}" id="sub-statistics-training">
      <div class="stats-hero"><div class="summary-stat"><div class="ss-val">0</div><div class="ss-label">Day streak</div></div><div class="summary-stat"><div class="ss-val">0</div><div class="ss-label">Total sessions</div></div><div class="summary-stat"><div class="ss-val">0<small class="ss-unit">kg</small></div><div class="ss-label">Total volume</div></div></div>
      <div class="panel"><div class="panel-head"><span>Weekly volume</span></div><div class="bars"></div><div class="subsection-head"><span>Muscle distribution</span><small>by working sets</small></div><div class="dist empty">No logged sets yet.</div><div class="subsection-head"><span>Personal records</span><small>best estimated 1RM (Epley)</small></div><div class="list empty">No records yet.</div></div>
    </div>
    <div class="sub-panel ${active === 'body' ? 'active' : ''}" id="sub-statistics-body">
      <div class="panel"><div class="panel-head"><span>Body weight</span><span class="section-label">kg</span></div><div class="empty">No entries yet. Log your weight below to start tracking.</div><div class="subsection-head"><span>Log weight</span></div><form class="form-grid"><label>Date<input type="date" /></label><label>Weight (kg)<input type="number" step="0.1" placeholder="e.g. 80" /></label><div class="form-actions span-2"><button class="button primary" type="button">Log weight</button></div></form><div class="subsection-head"><span>Profile</span><small>for BMI &amp; goal</small></div><form class="form-grid"><label>Height (cm)<input type="number" step="1" min="100" max="250" placeholder="e.g. 175" /></label><label>Target weight (kg)<input type="number" step="0.1" min="0" placeholder="e.g. 75" /></label><div class="form-actions span-2"><button class="button" type="button">Save profile</button></div></form></div>
    </div>
  </div>`;
}

function settingsView(state: AppState): string {
  return `<div class="page active"><div class="page-title">Settings</div><div class="panel"><div class="panel-head"><span>Nostr signer</span><span class="status-pill ${state.pubkey ? 'ok' : 'bad'}">${state.pubkey ? 'connected' : 'not signed in'}</span></div><p class="section-help">Workstr Web replaces self-hosted Idenstr with a user-owned NIP-46 signer. Press Sign in in the top-right; the app launches the signer request directly.</p><div class="terminal-mini">secure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'not signed in')}\n${state.signInStatus ? html(state.signInStatus) : ''}</div><div class="web-empty-actions">${state.pubkey ? '<button id="sign-out-settings" class="button ghost">Switch signer</button>' : '<button id="sign-in-settings" class="button primary">Sign in</button>'}<button id="open-demo" class="button ghost">Open local demo</button></div></div><div class="panel"><div class="panel-head"><span>Preferences</span></div><label style="max-width:240px">Weight unit<select><option>Kilograms (kg)</option><option>Pounds (lbs)</option></select></label></div></div>`;
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, store: null, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], editingId: null, filter: '', programFilter: '', expandedProgramAddress: null, exerciseStatus: `loading exercises from ${WORKSTR_LIBRARY_RELAY}...`, programStatus: '', signInStatus: null };

  async function boot(): Promise<void> {
    if (state.pubkey) await openIdentity(state.pubkey, false);
    render();
    await refreshExercises();
  }

  async function openIdentity(pubkey: string, persist = true, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    state.pubkey = pubkey;
    state.signerType = signerType;
    state.npub = pubkey === 'demo-local-pubkey' ? 'demo-local-pubkey' : nip19.npubEncode(pubkey);
    state.profileName = await fetchProfileName(pubkey);
    state.signInStatus = null;
    state.store = await WorkstrStore.open(pubkey);
    await state.store.seedExercises(starterExercises as ExerciseDraft[]);
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
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.view = button.dataset.view as View;
      state.editingId = null;
      render();
      if (state.view === 'exercises' && !state.exercises.length) void refreshExercises();
      if (state.view === 'workouts' && !state.programs.length) void refreshPrograms();
    }));
    root.querySelectorAll<HTMLElement>('[data-subtab]').forEach((button) => button.addEventListener('click', () => {
      const parent = button.dataset.parent as keyof AppState['subState'];
      if (parent && parent in state.subState) {
        (state.subState[parent] as SubView) = button.dataset.subtab as SubView;
        state.view = parent as View;
        state.editingId = null;
        render();
        if (parent === 'exercises' && !state.exercises.length) void refreshExercises();
        if (parent === 'workouts' && !state.programs.length) void refreshPrograms();
      }
    }));
    root.querySelector('#sign-in')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-in-settings')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-out')?.addEventListener('click', signOut);
    root.querySelector('#sign-out-settings')?.addEventListener('click', signOut);
    root.querySelector('#open-demo')?.addEventListener('click', () => openAndRender('demo-local-pubkey'));
    root.querySelectorAll('#refresh-exercises').forEach((button) => button.addEventListener('click', () => { void refreshExercises(); }));
    root.querySelectorAll('#refresh-programs').forEach((button) => button.addEventListener('click', () => { void refreshPrograms(); }));
    root.querySelector('#new-exercise')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#cancel-edit')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#exercise-filter')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#exercise-filter'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    root.querySelector('#program-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
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
    root.querySelector('#exercise-form')?.addEventListener('submit', saveExercise);
    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = Number(button.dataset.edit); render(); }));
    root.querySelectorAll<HTMLElement>('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteExercise(Number(button.dataset.delete))));
  }

  async function refreshExercises(): Promise<void> {
    state.exerciseStatus = `loading exercises from ${WORKSTR_LIBRARY_RELAY}...`;
    render();
    try {
      const exercises = await fetchRelayExercises();
      state.exercises = exercises;
      state.exerciseStatus = `loaded ${exercises.length} exercises from ${WORKSTR_LIBRARY_RELAY}`;
    } catch (error) {
      state.exerciseStatus = `exercise relay error: ${(error as Error).message}`;
    }
    render();
  }

  async function refreshPrograms(): Promise<void> {
    state.programStatus = `loading workouts from ${WORKSTR_LIBRARY_RELAY}...`;
    render();
    try {
      const programs = await fetchRelayPrograms();
      state.programs = programs;
      state.programStatus = `loaded ${programs.length} workouts from ${WORKSTR_LIBRARY_RELAY}`;
    } catch (error) {
      state.programStatus = `workout relay error: ${(error as Error).message}`;
    }
    render();
  }

  function signOut(): void {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SIGNER_TYPE_KEY);
    state.pubkey = null; state.npub = null; state.profileName = null; state.store = null; state.signerType = null; state.editingId = null; state.signInStatus = null;
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
