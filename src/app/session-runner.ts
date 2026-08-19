import { slugify } from '../core/ids';
import { displayWeightKg, normalizeWeightUnit } from '../core/units';
import { programMuscleLabel } from './format';
import { inferProgramMuscle, programExerciseName, resolveProgramExercise } from '../features/sheets/views';
import type { RelayProgram } from '../nostr/canon';
import { emomClockSnapshot } from '../features/train/emom-clock';
import { CountdownCueGuard, unlockCountdownAudio } from '../features/train/countdown-audio';
import { effectiveSessionStartedAt, isEmomSession, preEmomElapsedSec, readEmomClock, standardSessionExercises } from '../features/train/session-logic';
import type { ActiveSession, AppState, SessionExercise } from './state';
import type { Signer } from '../signer/types';
import { createSessionSummary } from '../features/train/session-summary';
import { repeatBlockedReason, repeatSeed, type RepeatSeed } from '../features/train/repeat-workout';
import { EmomSessionController } from '../features/train/emom-session-controller';
import { StandardSessionController } from '../features/train/standard-session-controller';

// Shared shell collaborators the session runner leans on. Identity (getActiveSigner)
// and the generic modal live in the shell; the weight formatters follow the current
// unit preference; render/toast repaint the app chrome.
export interface SessionRunnerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  closeModal(): void;
  wDisplay(weight: number | null | undefined): number | null;
  wFmt(weight: number | null | undefined): string;
  unitLabel(): string;
  persistCanonCache(): Promise<void>;
  loadFinishedSessions(): Promise<ActiveSession[]>;
  getActiveSigner(): Promise<Signer | null>;
}

export interface SessionRunner {
  startTrainingSession(program: RelayProgram): Promise<void>;
  repeatSession(source: ActiveSession): Promise<boolean>;
  openSessionOverlay(session: ActiveSession): Promise<void>;
  publishSessionSummary(session: ActiveSession, button: HTMLButtonElement | null): Promise<void>;
  bindSessionControls(): void;
}

export { restSecondsRemaining } from '../features/train/session-logic';

export function createSessionRunner(ctx: SessionRunnerContext): SessionRunner {
  const { state, root } = ctx;

  let sessionElapsedTimer = 0;
  let emomPhaseMounted = false;
  const countdownCueGuard = new CountdownCueGuard();
  const standard = new StandardSessionController({
    root, state, cueGuard: countdownCueGuard,
    weightDisplay: sessionWeightDisplay,
    weightFormat: ctx.wFmt,
    unitLabel: ctx.unitLabel,
    bindSharedControls
  });
  const emom = new EmomSessionController({
    root, state, cueGuard: countdownCueGuard,
    updateElapsed: updateSessionElapsed,
    weightDisplay: sessionWeightDisplay,
    unitLabel: ctx.unitLabel,
    bindSharedControls
  });
  let sessionWakeLock: WakeLockSentinel | null = null;

  function sessionWeightDisplay(weight: number | string | null | undefined): string {
    const value = displayWeightKg(weight, normalizeWeightUnit(state.settings.unit));
    return value == null ? '' : String(value);
  }

  function programSessionExercises(program: RelayProgram): SessionExercise[] {
    return program.exercises.map((member) => {
      const full = resolveProgramExercise(member, state.exercises);
      const name = programExerciseName(member, full);
      return {
        exerciseSlug: full?.slug || slugify(name),
        exerciseName: name,
        muscleGroup: programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name)),
        imageUrl: member.imageUrl || full?.image_url,
        sets: program.blocks?.find((block) => block.type === 'straight' && block.steps.some((step) => step.exerciseSlug === (full?.slug || slugify(name))))?.rounds
          || Number(member.sets) || Number(full?.default_sets) || 3,
        reps: String(member.reps || full?.default_reps || '8-12'),
        restSec: Number(member.restSec || member.rest || full?.default_rest) || 90,
        weight: member.weight ?? null,
        notes: member.notes || full?.description || '',
        instructions: full?.instructions || []
      };
    });
  }

  const summary = createSessionSummary({ ...ctx, programExercises: programSessionExercises });

  // The one path that opens a live session: persist the row, take it as the active
  // session, prime the standard controller, show the overlay. Programs and repeats both
  // arrive here so a repeated workout behaves exactly like any other.
  async function beginSession(seed: RepeatSeed): Promise<void> {
    const startedAt = new Date().toISOString();
    const blocks = seed.blocks?.length ? seed.blocks : undefined;
    const sessionId = state.store
      ? await state.store.createSession({ sheet_name: seed.name, started_at: startedAt, summary_image_url: seed.summaryImageUrl, exercises: seed.exercises, blocks })
      : Date.now();
    state.activeSession = { id: sessionId, sheetName: seed.name, startedAt, summaryImageUrl: seed.summaryImageUrl, exercises: seed.exercises, blocks, sets: [] };
    standard.start(state.activeSession);
    await openSessionOverlay(state.activeSession);
  }

  async function startTrainingSession(program: RelayProgram): Promise<void> {
    await beginSession({
      name: program.name || 'Freestyle',
      exercises: programSessionExercises(program),
      blocks: program.blocks,
      summaryImageUrl: program.muscleMapUrl || ''
    });
  }

  // A repeat starts from the completed session's own snapshot, so it still works after the
  // source program or its exercises were edited or deleted. Nothing about the historical
  // session is touched: it is read, copied, and left alone.
  async function repeatSession(source: ActiveSession): Promise<boolean> {
    if (repeatBlockedReason(source)) return false;
    // Never silently discard work in progress. An unfinished session keeps the floor and
    // the user is put back into it, rather than having it replaced out from under them.
    if (state.activeSession) {
      ctx.toast('Finish or cancel your current session first', 'bad');
      await openSessionOverlay(state.activeSession);
      return false;
    }
    await beginSession(repeatSeed(source));
    return true;
  }

  function shouldOpenEmom(session: ActiveSession): boolean {
    return isEmomSession(session) && (session.emomStartedAt != null || standardSessionExercises(session).length === 0);
  }

  // Which half of a mixed session is mounted in the overlay. Derived state is not enough:
  // between "Start EMOM" and the first tick of the clock the EMOM view is up while
  // emomStartedAt is still null, and rebinding standard controls there kills its buttons.
  function startEmomSection(session: ActiveSession): void {
    emomPhaseMounted = true;
    standard.stop();
    window.clearInterval(sessionElapsedTimer);
    emom.open(session);
  }

  async function requestSessionWakeLock(): Promise<void> {
    if (sessionWakeLock || !('wakeLock' in navigator)) return;
    try {
      sessionWakeLock = await navigator.wakeLock.request('screen');
      sessionWakeLock.addEventListener('release', () => { sessionWakeLock = null; });
    } catch { /* Wake lock is best-effort, exactly like self-hosted Workstr. */ }
  }

  function releaseSessionWakeLock(): void {
    if (sessionWakeLock) { void sessionWakeLock.release(); sessionWakeLock = null; }
  }

  // An interrupted audio context only reliably revives inside a user gesture, and
  // the start button is long gone by round two. Any touch in the session will do.
  root.addEventListener('pointerdown', (event) => {
    if (!state.activeSession) return;
    const overlay = root.querySelector('#session-overlay');
    if (!overlay?.classList.contains('open')) return;
    if (event.target instanceof Node && !overlay.contains(event.target)) return;
    unlockCountdownAudio();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.activeSession && root.querySelector('#session-overlay')?.classList.contains('open')) {
      void requestSessionWakeLock();
      unlockCountdownAudio();
    }
    standard.reconcileRest();
    if (emomPhaseMounted && emom.active) emom.reconcileClocks();
  });

  async function openSessionOverlay(session: ActiveSession): Promise<void> {
    root.querySelector('#session-overlay')?.classList.add('open');
    void requestSessionWakeLock();
    emomPhaseMounted = shouldOpenEmom(session);
    if (emomPhaseMounted) {
      window.clearInterval(sessionElapsedTimer);
      emom.open(session);
    } else {
      startSessionElapsedTimer(session);
      await standard.open(session);
    }
  }

  function startSessionElapsedTimer(session: ActiveSession): void {
    window.clearInterval(sessionElapsedTimer);
    updateSessionElapsed(session);
    if (!effectiveSessionStartedAt(session)) return;
    sessionElapsedTimer = window.setInterval(() => { if (state.activeSession) updateSessionElapsed(state.activeSession); }, 1000);
  }

  function updateSessionElapsed(session: ActiveSession, now = Date.now()): void {
    const el = root.querySelector('#session-elapsed');
    if (!el) return;
    const startedAt = effectiveSessionStartedAt(session);
    if (!startedAt) { el.textContent = '00:00'; return; }
    const seconds = isEmomSession(session) && session.emomStartedAt
      ? Math.max(0, Math.floor(emomClockSnapshot(readEmomClock(session), now).activeSec) + preEmomElapsedSec(session))
      : Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
    el.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  async function finishActiveSession(): Promise<void> {
    if (!state.activeSession) return;
    if (isEmomSession(state.activeSession) && state.activeSession.emomStartedAt) {
      await emom.pauseForFinish(state.activeSession);
    }
    state.activeSession.finishedAt = new Date().toISOString();
    if (state.store) await state.store.finishSession(state.activeSession.id, state.activeSession.finishedAt);
    const finished = state.activeSession;
    state.finishedSessions = state.store ? await ctx.loadFinishedSessions() : [finished, ...state.finishedSessions];
    closeSessionOverlay();
    state.activeSession = null;
    summary.render(finished);
  }

  const publishSessionSummary = summary.publish;

  async function cancelActiveSession(): Promise<void> {
    if (!state.activeSession) return closeSessionOverlay();
    if (!window.confirm('End and discard this session? Logged sets will be deleted.')) return;
    if (state.store) await state.store.deleteSession(state.activeSession.id);
    state.activeSession = null;
    closeSessionOverlay();
  }

  function closeSessionOverlay(): void {
    emomPhaseMounted = false;
    standard.stop();
    window.clearInterval(sessionElapsedTimer);
    emom.stop();
    countdownCueGuard.reset();
    releaseSessionWakeLock();
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
    root.querySelector('#session-overlay')?.classList.remove('open');
    root.querySelector('#pr-toast')?.classList.remove('show');
  }

  function bindSharedControls(): void {
    const closeButton = root.querySelector<HTMLButtonElement>('#session-close');
    if (closeButton) closeButton.onclick = () => { void cancelActiveSession(); };
    const finishButton = root.querySelector<HTMLButtonElement>('#finish-session');
    if (finishButton) finishButton.onclick = () => { void finishActiveSession(); };
    const startEmomButton = root.querySelector<HTMLButtonElement>('#start-emom-section');
    if (startEmomButton) startEmomButton.onclick = () => {
      const session = state.activeSession;
      if (session) startEmomSection(session);
    };
  }

  function bindSessionControls(): void {
    if (emomPhaseMounted) { emom.bindControls(); return; }
    standard.bindControls();
  }

  return { startTrainingSession, repeatSession, openSessionOverlay, publishSessionSummary, bindSessionControls };
}
