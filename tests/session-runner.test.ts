import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionRunner, restSecondsRemaining, type SessionRunnerContext } from '../src/app/session-runner';
import { shellMarkup } from '../src/app/layout';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';
import type { WorkstrStore } from '../src/db/store';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeState(store: WorkstrStore): AppState {
  return {
    pubkey: null, npub: null, profileName: null, profileNames: {}, store,
    settings: { unit: 'kg', publicRelays: [] }, support: { status: 'idle', receipts: [] },
    signerType: null, view: 'workouts',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [], programs: [], activeSession: null, finishedSessions: [],
    publishingSessionId: null, publishingStatus: null, editingId: null, filter: '',
    programFilter: '', expandedProgramAddress: null, exerciseStatus: '', programStatus: '',
    signInStatus: null, expandedSessionId: null,
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [], sheets: [], library: [],
    librarySelect: { active: false, slugs: new Set() }, discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [], exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' }
  };
}

function fakeStore(): { store: WorkstrStore; sets: unknown[]; finished: number[]; emomStarts: Array<{ id: number; startedAt: string }>; clockUpdates: Array<{ positionSec: number; activeSec: number; runningSince?: string }> } {
  const sets: unknown[] = [];
  const finished: number[] = [];
  const emomStarts: Array<{ id: number; startedAt: string }> = [];
  const clockUpdates: Array<{ positionSec: number; activeSec: number; runningSince?: string }> = [];
  const store = {
    createSession: async () => 1,
    addSessionSet: async (set: unknown) => { sets.push(set); return sets.length; },
    startSessionEmom: async (id: number, startedAt: string) => { emomStarts.push({ id, startedAt }); },
    updateSessionEmomClock: async (_id: number, positionSec: number, activeSec: number, runningSince?: string) => { clockUpdates.push({ positionSec, activeSec, runningSince }); },
    finishSession: async (id: number) => { finished.push(id); }
  } as unknown as WorkstrStore;
  return { store, sets, finished, emomStarts, clockUpdates };
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

function emomProgram(): RelayProgram {
  return {
    ...oneExerciseProgram(),
    name: 'Minute Work',
    blocks: [{
      type: 'emom', rounds: 2, intervals: [{ durationSec: 60, steps: [
        { exerciseSlug: 'bench-press', exerciseName: 'Bench Press', targetDurationSec: 20, targetReps: '8' }
      ] }]
    }]
  };
}

describe('session runner', () => {
  let root: HTMLElement;
  let state: AppState;
  let store: WorkstrStore;
  let sets: unknown[];
  let emomStarts: Array<{ id: number; startedAt: string }>;
  let clockUpdates: Array<{ positionSec: number; activeSec: number; runningSince?: string }>;
  let runner: ReturnType<typeof createSessionRunner>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    const fake = fakeStore();
    store = fake.store;
    sets = fake.sets;
    emomStarts = fake.emomStarts;
    clockUpdates = fake.clockUpdates;
    state = makeState(store);
    root.innerHTML = shellMarkup(state);
    runner = createSessionRunner(makeContext(root, state));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a session and renders the first exercise with a log control', async () => {
    await runner.startTrainingSession(oneExerciseProgram());
    expect(state.activeSession).toBeTruthy();
    expect(root.querySelector('#session-overlay')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('#session-body')?.textContent).toContain('Bench Press');
    expect(root.querySelector('[data-session-log]')).toBeTruthy();
  });

  it('continues to start a normal session elapsed timer immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    await runner.startTrainingSession(oneExerciseProgram());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:05');
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

  it('starts an EMOM clock and logs actual reps without opening normal rest', async () => {
    await runner.startTrainingSession(emomProgram());
    expect(root.querySelector('#emom-start')).toBeTruthy();
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await tick();
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('60');
    const step = root.querySelector<HTMLElement>('[data-emom-step="0"]')!;
    (step.querySelector('[data-emom-reps]') as HTMLInputElement).value = '9';
    (step.querySelector('[data-log-emom]') as HTMLButtonElement).click();
    await tick();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ reps: 9, duration_sec: 20, round_index: 0, interval_index: 0, step_index: 0 });
    expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(false);
  });

  it('asks for end confirmation only once after repeated EMOM renders', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await runner.startTrainingSession(emomProgram());
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await tick();
    (root.querySelector('#session-close') as HTMLButtonElement).click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(state.activeSession).toBeTruthy();
    confirm.mockRestore();
  });

  it('keeps elapsed time at zero until EMOM starts, then aligns both clocks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    await runner.startTrainingSession(emomProgram());
    const createdAt = state.activeSession?.startedAt;
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:00');

    await vi.advanceTimersByTimeAsync(250);
    vi.setSystemTime(new Date('2026-08-14T12:02:00Z'));
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:00');
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(state.activeSession?.startedAt).not.toBe(createdAt);
    expect(state.activeSession?.startedAt).toBe('2026-08-14T12:02:00.000Z');
    expect(state.activeSession?.emomStartedAt).toBe(state.activeSession?.startedAt);
    expect(emomStarts).toEqual([{ id: 1, startedAt: '2026-08-14T12:02:00.000Z' }]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:01');
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('59');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:05');
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('55');
  });

  it('resumes an active EMOM using its persisted EMOM start time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:10:30Z'));
    const program = emomProgram();
    state.activeSession = {
      id: 7,
      sheetName: program.name,
      startedAt: '2026-08-14T12:00:00.000Z',
      emomStartedAt: '2026-08-14T12:10:00.000Z',
      exercises: [],
      blocks: program.blocks,
      sets: []
    };
    await runner.openSessionOverlay(state.activeSession);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:30');
  });

  it('pauses and resumes an EMOM without changing active time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
    await runner.startTrainingSession(emomProgram());
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('55');

    (root.querySelector('#emom-pause') as HTMLButtonElement).click();
    expect(root.querySelector('#emom-pause')?.getAttribute('aria-label')).toBe('Resume EMOM');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:05');
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('55');

    (root.querySelector('#emom-pause') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(root.querySelector('#session-elapsed')?.textContent).toBe('00:07');
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('53');
    expect(root.querySelector('#emom-next')).toBeNull();
    expect(root.querySelector('#emom-prev')).toBeNull();
    expect(root.querySelector('#finish-session')?.textContent).toBe('Finish early');
    await vi.waitFor(() => expect(clockUpdates.length).toBeGreaterThanOrEqual(2));
  });

  it('shows collapsible exercise instructions in an EMOM', async () => {
    state.exercises = [{ slug: 'bench-press', name: 'Bench Press', instructions: ['Brace firmly.', 'Press with control.'] } as never];
    await runner.startTrainingSession(emomProgram());
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await tick();
    const toggle = root.querySelector('[data-toggle-emom-instructions]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[data-emom-instructions]')?.classList.contains('open')).toBe(false);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-emom-instructions]')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('[data-emom-instructions]')?.textContent).toContain('Brace firmly.');
  });

  it('shows five rounds at a time and browses the round window without seeking', async () => {
    const program = emomProgram();
    if (program.blocks?.[0]?.type === 'emom') program.blocks[0].rounds = 35;
    await runner.startTrainingSession(program);
    (root.querySelector('#emom-start') as HTMLButtonElement).click();
    await tick();
    expect([...root.querySelectorAll('[data-emom-seek]')].map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(root.querySelector('#session-meta')?.textContent).toContain('Round 1 of 35');
    (root.querySelector('[data-emom-window="1"]') as HTMLButtonElement).click();
    expect([...root.querySelectorAll('[data-emom-seek]')].map((button) => button.textContent)).toEqual(['6', '7', '8', '9', '10']);
    expect(root.querySelector('#session-meta')?.textContent).toContain('Round 1 of 35');
    expect(root.querySelector('#emom-countdown')?.textContent).toBe('60');
  });
});

describe('rest timer timing', () => {
  it('derives remaining seconds from a wall-clock deadline', () => {
    expect(restSecondsRemaining(65_000, 5_000)).toBe(60);
    expect(restSecondsRemaining(65_000, 64_001)).toBe(1);
    expect(restSecondsRemaining(65_000, 70_000)).toBe(0);
  });
});
