import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionRunner, type SessionRunnerContext } from '../src/app/session-runner';
import { shellMarkup } from '../src/app/layout';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';
import type { WorkstrStore } from '../src/db/store';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeState(store: WorkstrStore): AppState {
  return {
    pubkey: null, npub: null, profileName: null, profileNames: {}, store,
    settings: { unit: 'kg', publicRelays: [] }, signerType: null, view: 'workouts',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [], programs: [], activeSession: null, finishedSessions: [],
    publishingSessionId: null, publishingStatus: null, editingId: null, filter: '',
    programFilter: '', expandedProgramAddress: null, exerciseStatus: '', programStatus: '',
    signInStatus: null, expandedSessionId: null,
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [], sheets: [], library: [],
    librarySelect: { active: false, slugs: new Set() }, discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [], exFilter: { cat: '', muscle: '', diff: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '' }
  };
}

function fakeStore(): { store: WorkstrStore; sets: unknown[]; finished: number[] } {
  const sets: unknown[] = [];
  const finished: number[] = [];
  const store = {
    createSession: async () => 1,
    addSessionSet: async (set: unknown) => { sets.push(set); return sets.length; },
    finishSession: async (id: number) => { finished.push(id); }
  } as unknown as WorkstrStore;
  return { store, sets, finished };
}

function makeContext(root: HTMLElement, state: AppState): SessionRunnerContext {
  return {
    root, state,
    render: () => { root.innerHTML = shellMarkup(state); },
    toast: () => {},
    openModal: (content: string) => {
      const host = root.querySelector('#modal-content');
      if (host) host.innerHTML = content;
      root.querySelector('#modal')?.classList.add('open');
    },
    closeModal: () => { root.querySelector('#modal')?.classList.remove('open'); },
    wDisplay: (w) => (w == null ? null : w),
    wFmt: (w) => (w == null ? '—' : String(w)),
    unitLabel: () => 'kg',
    persistCanonCache: async () => {},
    loadFinishedSessions: async () => [],
    getActiveSigner: async () => null
  };
}

function oneExerciseProgram(): RelayProgram {
  return {
    slug: 'test', name: 'Test Program', description: '', tags: [], sourceLabel: '',
    eventId: '', pubkey: '', address: '', createdAt: Date.now(),
    exercises: [{ address: '', name: 'Bench Press', sets: 2, reps: '8', restSec: 60 }]
  };
}

describe('session runner', () => {
  let root: HTMLElement;
  let state: AppState;
  let store: WorkstrStore;
  let sets: unknown[];
  let runner: ReturnType<typeof createSessionRunner>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    const fake = fakeStore();
    store = fake.store;
    sets = fake.sets;
    state = makeState(store);
    root.innerHTML = shellMarkup(state);
    runner = createSessionRunner(makeContext(root, state));
  });

  it('starts a session and renders the first exercise with a log control', async () => {
    await runner.startTrainingSession(oneExerciseProgram());
    expect(state.activeSession).toBeTruthy();
    expect(root.querySelector('#session-overlay')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('#session-body')?.textContent).toContain('Bench Press');
    expect(root.querySelector('[data-session-log]')).toBeTruthy();
  });

  it('logs a set to the store and opens the rest overlay', async () => {
    await runner.startTrainingSession(oneExerciseProgram());
    (root.querySelector('[data-session-reps="0"]') as HTMLInputElement).value = '8';
    (root.querySelector('[data-session-weight="0"]') as HTMLInputElement).value = '20';
    (root.querySelector('[data-set-log-btn="0"]') as HTMLButtonElement).click();
    await tick();
    expect(sets.length).toBe(1);
    expect(state.activeSession?.sets.length).toBe(1);
    expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(true);
  });

  it('finishes the session and opens the recap modal', async () => {
    await runner.startTrainingSession(oneExerciseProgram());
    (root.querySelector('#finish-session') as HTMLButtonElement).click();
    await tick();
    expect(state.activeSession).toBeNull();
    expect(root.querySelector('#modal')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('#modal-content')?.textContent).toContain('recap');
    expect(root.querySelector('#session-overlay')?.classList.contains('open')).toBe(false);
  });
});
