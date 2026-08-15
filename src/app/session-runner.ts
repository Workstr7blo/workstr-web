import { slugify } from '../core/ids';
import { displayWeightKg, normalizeWeightUnit } from '../core/units';
import { programMuscleLabel } from './format';
import { inferProgramMuscle, programExerciseName, resolveProgramExercise } from '../features/sheets/views';
import type { RelayProgram } from '../nostr/canon';
import { emomClockSnapshot } from '../features/train/emom-clock';
import { CountdownCueGuard } from '../features/train/countdown-audio';
import { effectiveSessionStartedAt, isEmomSession, readEmomClock } from '../features/train/session-logic';
import type { ActiveSession, AppState, SessionExercise } from './state';
import type { Signer } from '../signer/types';
import { createSessionSummary } from '../features/train/session-summary';
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
  openSessionOverlay(session: ActiveSession): Promise<void>;
  publishSessionSummary(session: ActiveSession, button: HTMLButtonElement | null): Promise<void>;
  bindSessionControls(): void;
}

export { restSecondsRemaining } from '../features/train/session-logic';

export function createSessionRunner(ctx: SessionRunnerContext): SessionRunner {
  const { state, root } = ctx;

  let sessionElapsedTimer = 0;
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

  async function startTrainingSession(program: RelayProgram): Promise<void> {
    const exercises = programSessionExercises(program);
    const startedAt = new Date().toISOString();
    const blocks = program.blocks?.length ? program.blocks : undefined;
    const sessionId = state.store ? await state.store.createSession({ sheet_name: program.name || 'Freestyle', started_at: startedAt, summary_image_url: program.muscleMapUrl || '', exercises, blocks }) : Date.now();
    state.activeSession = { id: sessionId, sheetName: program.name || 'Freestyle', startedAt, summaryImageUrl: program.muscleMapUrl || '', exercises, blocks, sets: [] };
    standard.start(state.activeSession);
    await openSessionOverlay(state.activeSession);
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.activeSession && root.querySelector('#session-overlay')?.classList.contains('open')) void requestSessionWakeLock();
    standard.reconcileRest();
    if (emom.active) emom.reconcileClocks();
  });

  async function openSessionOverlay(session: ActiveSession): Promise<void> {
    root.querySelector('#session-overlay')?.classList.add('open');
    void requestSessionWakeLock();
    if (emom.active) {
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
    const seconds = isEmomSession(session)
      ? Math.max(0, Math.floor(emomClockSnapshot(readEmomClock(session), now).activeSec))
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
  }

  function bindSessionControls(): void {
    if (emom.active) { emom.bindControls(); return; }
    standard.bindControls();
  }

  return { startTrainingSession, openSessionOverlay, publishSessionSummary, bindSessionControls };
}
