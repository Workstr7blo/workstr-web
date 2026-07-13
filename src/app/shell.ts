import { nip19 } from 'nostr-tools';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { createBunkerSigner, createNostrConnectSignerRequest, defaultBunkerRelays, isLikelyBunkerInput } from '../signer/nip46';
import { slugify } from '../core/ids';
import { CANONICAL_REGIONS } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft } from '../db/store';
import starterExercises from '../data/starter-exercises.json';
import type { Exercise } from '../core/types';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';

type View = 'home' | 'library' | 'train' | 'progress';

interface AppState {
  pubkey: string | null;
  npub: string | null;
  store: WorkstrStore | null;
  signerType: 'nip07' | 'nip46' | 'demo' | null;
  view: View;
  exercises: Exercise[];
  editingId: number | null;
  filter: string;
}

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
}

function displayNpub(pubkey: string): string {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  return shortNpub(pubkey);
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
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function shellMarkup(state: AppState): string {
  const status = state.pubkey ? displayNpub(state.pubkey) : 'not connected';
  return `
    <div class="noise"></div>
    <div class="cyber-grid"></div>
    <header class="topbar">
      <div class="logo-zone">
        <div class="glyph">W</div>
        <div class="logo-text">
          <div class="logo-mark">Workstr <span>Web</span></div>
          <div class="logo-tagline">local-first nostr training</div>
        </div>
      </div>
      <div class="topbar-actions">
        <span id="live-status">${html(status)}</span>
        ${state.pubkey ? '<button id="sign-out" class="button small ghost">Switch</button>' : ''}
      </div>
    </header>
    <aside class="sidebar">
      <nav class="nav-items">
        ${navButton('home', 'Home', state.view)}
        ${navButton('library', 'Library', state.view)}
        ${navButton('train', 'Train', state.view)}
        ${navButton('progress', 'Progress', state.view)}
      </nav>
    </aside>
    <main class="content">
      ${state.pubkey ? appView(state) : loginView()}
    </main>`;
}

function navButton(view: View, label: string, active: View): string {
  return `<button class="nav-item ${active === view ? 'active' : ''}" data-view="${view}"><span>${label}</span></button>`;
}

function loginView(): string {
  return `<section class="page active">
    <div class="hero-card">
      <p class="eyebrow">Phase 0 identity</p>
      <h1>Connect your signer to open Workstr.</h1>
      <p class="lede">Workstr stores your data in a browser database namespaced by your Nostr pubkey. Signing stays delegated to your signer; there is no nsec paste flow.</p>
      <div class="signer-grid">
        <section class="signer-card">
          <span class="section-label">Browser extension</span>
          <h2>NIP-07 extension</h2>
          <p>Use Alby, nos2x, Flamingo, or another extension that exposes <code>window.nostr</code>.</p>
          <button id="connect-nip07" class="button primary">Use Extension</button>
        </section>
        <section class="signer-card">
          <span class="section-label">Remote signer</span>
          <h2>Bunker URL</h2>
          <p>For Amber/remote signers, create a request and open it in your signer. If you already have a <code>bunker://</code> URI or NIP-05 signer address, paste it below.</p>
          <form id="bunker-form" class="bunker-form">
            <input name="bunker" placeholder="bunker://... or name@domain.com" autocomplete="off" />
            <input name="relays" placeholder="relays for new request" value="${html(defaultBunkerRelays().join(', '))}" autocomplete="off" />
            <button class="button primary" type="submit">Connect / Create Request</button>
          </form>
          <div id="bunker-link-panel" class="bunker-link-panel"></div>
        </section>
      </div>
      <div class="action-row">
        <button id="open-demo" class="button ghost">Open local demo</button>
      </div>
      <pre id="status-panel" class="terminal-mini">$ workstr-web boot\nsecure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\n</pre>
    </div>
  </section>`;
}

function appView(state: AppState): string {
  if (state.view === 'library') return libraryView(state);
  if (state.view === 'train') return placeholderView('Train', 'Session runner comes after Library and Sheets.');
  if (state.view === 'progress') return placeholderView('Progress', 'Charts, body-weight, records, and recovery will land after training logs exist.');
  return `<section class="page active">
    <div class="hero-card">
      <p class="eyebrow">Signed in</p>
      <h1>Your local-first training workspace is open.</h1>
      <p class="lede">Identity: <strong>${html(state.npub ?? '')}</strong></p>
      <div class="metric-grid mini">
        <div class="metric"><span class="metric-label">Library</span><strong>${state.exercises.length}</strong><p>active exercises in your local IndexedDB namespace</p></div>
        <div class="metric"><span class="metric-label">Signer</span><strong>${state.signerType === 'nip46' ? 'NIP-46' : state.pubkey === 'demo-local-pubkey' ? 'Demo' : 'NIP-07'}</strong><p>keys stay outside the app</p></div>
      </div>
      <div class="action-row">
        <button class="button primary" data-view="library">Open Library</button>
      </div>
    </div>
  </section>`;
}

function placeholderView(title: string, copy: string): string {
  return `<section class="page active"><div class="hero-card"><p class="eyebrow">Coming next</p><h1>${html(title)}</h1><p class="lede">${html(copy)}</p></div></section>`;
}

function libraryView(state: AppState): string {
  const query = state.filter.toLowerCase();
  const exercises = state.exercises.filter((exercise) => {
    const haystack = [exercise.name, exercise.description, exercise.muscle_group, exercise.difficulty, ...exercise.muscles, ...exercise.equipment, ...exercise.tags].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const editing = state.editingId ? state.exercises.find((exercise) => exercise.id === state.editingId) : undefined;
  return `<section class="page active">
    <div class="panel library-head">
      <div>
        <p class="eyebrow">Phase 1.1 library</p>
        <h1>Exercise Library</h1>
        <p class="lede">Create, edit, search, and locally store exercise templates. Starter exercises are bundled JSON, not a server fetch.</p>
      </div>
      <button id="new-exercise" class="button primary">New Exercise</button>
    </div>
    <div class="library-layout">
      <div class="panel">
        <div class="subsection-head"><span>${editing ? 'Edit exercise' : 'Add exercise'}</span><small>IndexedDB</small></div>
        ${exerciseForm(editing)}
      </div>
      <div class="panel">
        <div class="filter-bar"><input id="exercise-filter" class="grow" type="search" placeholder="Search muscle, equipment, tag..." value="${html(state.filter)}" /></div>
        <div class="ex-grid">${exercises.map(exerciseCard).join('') || '<p class="empty">No exercises match this filter.</p>'}</div>
      </div>
    </div>
  </section>`;
}

function exerciseForm(exercise?: Exercise): string {
  const muscle = exercise?.muscle_group || exercise?.muscles[0] || 'Chest';
  return `<form id="exercise-form" class="exercise-form">
    <input type="hidden" name="id" value="${html(exercise?.id ?? '')}" />
    <label>Name <input name="name" required value="${html(exercise?.name ?? '')}" placeholder="Bench Press" /></label>
    <label>Description <textarea name="description" rows="3" placeholder="Short coaching description">${html(exercise?.description ?? '')}</textarea></label>
    <div class="form-grid">
      <label>Primary muscle <select name="muscle_group">${CANONICAL_REGIONS.map((region) => `<option ${region === muscle ? 'selected' : ''}>${region}</option>`).join('')}</select></label>
      <label>Difficulty <select name="difficulty">${['beginner', 'intermediate', 'advanced'].map((level) => `<option ${level === exercise?.difficulty ? 'selected' : ''}>${level}</option>`).join('')}</select></label>
      <label>Equipment <input name="equipment" value="${html(exercise?.equipment.join(', ') ?? '')}" placeholder="barbell, bench" /></label>
      <label>Tags <input name="tags" value="${html(exercise?.tags.join(', ') ?? '')}" placeholder="push, upper-body" /></label>
      <label>Sets <input name="sets" type="number" min="1" value="${html(exercise?.default_sets ?? 3)}" /></label>
      <label>Reps / duration <input name="reps" type="number" min="1" value="${html(exercise?.default_reps ?? 10)}" /></label>
      <label>Rest seconds <input name="rest" type="number" min="0" value="${html(exercise?.default_rest ?? 90)}" /></label>
      <label class="span-2">Instructions <textarea name="instructions" rows="4" placeholder="One instruction per line">${html(exercise?.instructions.join('\n') ?? '')}</textarea></label>
    </div>
    <div class="form-actions">
      <button class="button primary" type="submit">${exercise ? 'Save Exercise' : 'Create Exercise'}</button>
      ${exercise ? '<button id="cancel-edit" class="button ghost" type="button">Cancel</button>' : ''}
    </div>
  </form>`;
}

function exerciseCard(exercise: Exercise): string {
  return `<article class="ex-card" data-id="${exercise.id}">
    <div class="card-body">
      <div class="card-name">${html(exercise.name)}</div>
      <p class="detail-desc">${html(exercise.description || 'No description yet.')}</p>
      <div class="card-meta">
        <span class="badge muscle">${html(exercise.muscle_group || exercise.muscles[0] || 'Muscle')}</span>
        <span class="badge diff">${html(exercise.difficulty || 'beginner')}</span>
        <span class="badge cat">${html(exercise.source_type)}</span>
      </div>
      <div class="tag-row">${exercise.equipment.map((item) => `<span class="tag-pill">${html(item)}</span>`).join('')}</div>
      <div class="row-actions">
        <button class="button small ghost" data-edit="${exercise.id}">Edit</button>
        <button class="button small danger" data-delete="${exercise.id}">Delete</button>
      </div>
    </div>
  </article>`;
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, store: null, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'home', exercises: [], editingId: null, filter: '' };

  async function boot(): Promise<void> {
    if (state.pubkey) await openIdentity(state.pubkey, false);
    render();
  }

  async function openIdentity(pubkey: string, persist = true, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    state.pubkey = pubkey;
    state.signerType = signerType;
    state.npub = pubkey === 'demo-local-pubkey' ? 'demo-local-pubkey' : nip19.npubEncode(pubkey);
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
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        state.view = button.dataset.view as View;
        state.editingId = null;
        render();
      });
    });
    root.querySelector('#sign-out')?.addEventListener('click', () => {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SIGNER_TYPE_KEY);
      state.pubkey = null;
      state.npub = null;
      state.store = null;
      state.signerType = null;
      state.exercises = [];
      state.view = 'home';
      render();
    });
    root.querySelector('#connect-nip07')?.addEventListener('click', connectNip07);
    root.querySelector('#bunker-form')?.addEventListener('submit', connectBunker);
    root.querySelector('#open-demo')?.addEventListener('click', () => openAndRender('demo-local-pubkey'));
    root.querySelector('#new-exercise')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#cancel-edit')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#exercise-filter')?.addEventListener('input', (event) => {
      state.filter = (event.target as HTMLInputElement).value;
      render();
      const input = root.querySelector<HTMLInputElement>('#exercise-filter');
      input?.focus();
      input?.setSelectionRange(state.filter.length, state.filter.length);
    });
    root.querySelector('#exercise-form')?.addEventListener('submit', saveExercise);
    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = Number(button.dataset.edit); render(); }));
    root.querySelectorAll<HTMLElement>('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteExercise(Number(button.dataset.delete))));
  }

  async function connectNip07(): Promise<void> {
    const panel = root.querySelector('#status-panel');
    try {
      const signer = createNip07Signer();
      const pubkey = await signer.getPublicKey();
      panel!.textContent += `$ signer connected ${shortNpub(pubkey)}\n`;
      await openAndRender(pubkey, 'nip07');
    } catch (error) {
      panel!.textContent += `$ extension signer error ${(error as Error).message}\n`;
    }
  }

  async function connectBunker(event: Event): Promise<void> {
    event.preventDefault();
    const panel = root.querySelector('#status-panel');
    const linkPanel = root.querySelector<HTMLElement>('#bunker-link-panel');
    const form = event.target as HTMLFormElement;
    const input = String(new FormData(form).get('bunker') || '').trim();
    const relays = String(new FormData(form).get('relays') || '').split(',').map((relay) => relay.trim()).filter(Boolean);
    try {
      let signerPromise;
      if (input) {
        if (!isLikelyBunkerInput(input)) {
          panel!.textContent += '$ bunker error paste a bunker:// URL or NIP-05 identifier, or leave it empty to create a new signer request\n';
          return;
        }
        panel!.textContent += '$ bunker connecting over the URI relays; keep the signer app online and approve there...\n';
        signerPromise = createBunkerSigner(input, { onAuthUrl: showAuthUrl });
      } else {
        const request = createNostrConnectSignerRequest(relays, { onAuthUrl: showAuthUrl });
        signerPromise = request.signer;
        panel!.textContent += `$ signer request created on ${request.relays.join(', ')}\n$ open this request in Amber/your NIP-46 signer and approve it; waiting up to 5 minutes...\n`;
        if (linkPanel) {
          linkPanel.innerHTML = `<a class="button primary" href="${html(request.uri)}">Open signer request</a><button id="copy-bunker-request" class="button ghost" type="button">Copy request URI</button>`;
          linkPanel.querySelector('#copy-bunker-request')?.addEventListener('click', async () => {
            await navigator.clipboard.writeText(request.uri);
            panel!.textContent += '$ signer request copied\n';
          });
        }
      }
      const signer = await signerPromise;
      const pubkey = await signer.getPublicKey();
      panel!.textContent += `$ bunker connected ${shortNpub(pubkey)}\n`;
      await openAndRender(pubkey, 'nip46');
    } catch (error) {
      panel!.textContent += `$ bunker error ${(error as Error).message}\n`;
    }

    function showAuthUrl(url: string): void {
      panel!.textContent += '$ signer returned an auth URL; open it to approve the request\n';
      if (linkPanel) {
        linkPanel.innerHTML = `<a class="button primary" href="${html(url)}" target="_blank" rel="noreferrer">Open signer approval</a>`;
      }
    }
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
      category: 'strength',
      muscle_group: primary,
      muscles: [primary],
      equipment: splitList(data.get('equipment')),
      difficulty: String(data.get('difficulty') || 'beginner'),
      tags: splitList(data.get('tags')),
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
    state.view = 'library';
    render();
  }

  async function deleteExercise(id: number): Promise<void> {
    if (!state.store) return;
    await state.store.deleteExercise(id);
    state.exercises = await state.store.listExercises();
    render();
  }

  void boot();
}
