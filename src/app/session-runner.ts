import { slugify } from '../core/ids';
import { displayWeightKg, normalizeWeightUnit, storeWeightInput } from '../core/units';
import { html, programMuscleLabel } from './format';
import { inferProgramMuscle, programExerciseName, resolveProgramExercise } from '../features/sheets/views';
import { fetchCanonPrograms, type RelayProgram } from '../nostr/canon';
import { publishWorkoutSummary } from '../nostr/share';
import type { EmomBlock } from '../core/types';
import { compileEmomBlocks, emomDurationSec, emomPosition, type EmomPosition, type EmomSlot } from '../features/train/emom';
import { emomClockSnapshot, pauseEmomClock, resumeEmomClock, seekEmomClock, type EmomClockState } from '../features/train/emom-clock';
import { CountdownCueGuard, playCountdownCue, unlockCountdownAudio } from '../features/train/countdown-audio';
import type { ActiveSession, AppState, SessionExercise, SessionSetLog } from './state';
import type { Signer } from '../signer/types';

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

export function restSecondsRemaining(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function createSessionRunner(ctx: SessionRunnerContext): SessionRunner {
  const { state, root } = ctx;

  let sessionExerciseIndex = 0;
  let sessionSetCounts: Record<string, number> = {};
  let sessionRestTimer = 0;
  let sessionRestTotal = 0;
  let sessionRestRemaining = 0;
  let sessionRestEndsAt = 0;
  let sessionRestAutoAdvance = false;
  let sessionElapsedTimer = 0;
  let emomTimer = 0;
  let emomRenderKey = '';
  let emomPreviousPhase: EmomPosition['phase'] | null = null;
  let emomPreviousSlotIndex: number | null = null;
  let restCuePeriod = 0;
  let emomCompletionHandled = false;
  let emomPersistQueue: Promise<void> = Promise.resolve();
  const countdownCueGuard = new CountdownCueGuard();
  let sessionWakeLock: WakeLockSentinel | null = null;
  const sessionPreviousSets = new Map<string, SessionSetLog[]>();

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
        sets: Number(member.sets) || Number(full?.default_sets) || 3,
        reps: String(member.reps || full?.default_reps || '8-12'),
        restSec: Number(member.restSec || member.rest || full?.default_rest) || 90,
        weight: member.weight ?? null,
        notes: member.notes || full?.description || '',
        instructions: full?.instructions || []
      };
    });
  }

  function getSessionExercises(session: ActiveSession): SessionExercise[] { return session.exercises; }

  function setCountsFromSession(session: ActiveSession): Record<string, number> {
    const counts: Record<string, number> = {};
    getSessionExercises(session).forEach((ex) => {
      const logged = session.sets.filter((set) => set.exerciseSlug === ex.exerciseSlug).length;
      counts[ex.exerciseSlug] = Math.max(Number(ex.sets) || 1, logged || 1);
    });
    return counts;
  }

  function normalizedProgramName(name: string): string {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function exerciseSlugSignature(exercises: SessionExercise[]): string {
    return [...new Set(exercises.map((ex) => ex.exerciseSlug).filter(Boolean))].sort().join('|');
  }

  function findSessionProgramMap(session: ActiveSession, programs: RelayProgram[]): string {
    const withMaps = programs.filter((program) => program.muscleMapUrl);
    if (!withMaps.length) return '';
    const sessionName = normalizedProgramName(session.sheetName);
    const exactName = withMaps.filter((program) => normalizedProgramName(program.name) === sessionName).sort((a, b) => b.createdAt - a.createdAt);
    if (exactName.length) return exactName[0].muscleMapUrl || '';

    // Sessions can outlive a relay refresh, or a locally renamed/imported program can
    // have the old display name. If the exercise roster uniquely matches a refreshed
    // relay program, reuse that program's already-uploaded map instead of publishing
    // a text-only kind:1.
    const sessionSig = exerciseSlugSignature(session.exercises);
    if (!sessionSig) return '';
    const rosterMatches = withMaps.filter((program) => exerciseSlugSignature(programSessionExercises(program)) === sessionSig).sort((a, b) => b.createdAt - a.createdAt);
    return rosterMatches.length === 1 ? rosterMatches[0].muscleMapUrl || '' : '';
  }

  async function resolveSessionSummaryImageUrl(session: ActiveSession): Promise<string> {
    if (session.summaryImageUrl) return session.summaryImageUrl;
    let url = findSessionProgramMap(session, state.programs);
    if (url) return url;
    try {
      const fresh = await fetchCanonPrograms();
      state.programs = fresh;
      await ctx.persistCanonCache();
      url = findSessionProgramMap(session, fresh);
    } catch {
      url = '';
    }
    if (url) session.summaryImageUrl = url;
    return url;
  }

  async function startTrainingSession(program: RelayProgram): Promise<void> {
    const exercises = programSessionExercises(program);
    const startedAt = new Date().toISOString();
    const blocks = program.blocks?.length ? program.blocks : undefined;
    const sessionId = state.store ? await state.store.createSession({ sheet_name: program.name || 'Freestyle', started_at: startedAt, summary_image_url: program.muscleMapUrl || '', exercises, blocks }) : Date.now();
    state.activeSession = { id: sessionId, sheetName: program.name || 'Freestyle', startedAt, summaryImageUrl: program.muscleMapUrl || '', exercises, blocks, sets: [] };
    sessionExerciseIndex = 0;
    sessionSetCounts = setCountsFromSession(state.activeSession);
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
    if (sessionRestEndsAt) reconcileSessionRest();
    if (activeEmomBlocks().length) reconcileEmomClocks();
  });

  async function openSessionOverlay(session: ActiveSession): Promise<void> {
    root.querySelector('#session-overlay')?.classList.add('open');
    void requestSessionWakeLock();
    if (!Object.keys(sessionSetCounts).length) sessionSetCounts = setCountsFromSession(session);
    window.clearInterval(emomTimer);
    emomRenderKey = '';
    emomPreviousPhase = null;
    emomPreviousSlotIndex = null;
    emomCompletionHandled = false;
    if (activeEmomBlocks().length) {
      if (session.emomStartedAt) {
        if (emomClockState(session).runningSinceMs != null) startEmomClockTimer(session);
        else reconcileEmomClocks();
      }
      else {
        window.clearInterval(sessionElapsedTimer);
        updateSessionElapsed(session);
        reconcileEmom();
      }
    } else {
      startSessionElapsedTimer(session);
      await renderSessionExercise(session);
    }
  }

  function activeEmomBlocks(): EmomBlock[] {
    return (state.activeSession?.blocks || []).filter((candidate): candidate is EmomBlock => candidate.type === 'emom');
  }

  function isEmomSession(session: ActiveSession): boolean {
    return (session.blocks || []).some((candidate) => candidate.type === 'emom');
  }

  function effectiveSessionStartedAt(session: ActiveSession): string | null {
    return isEmomSession(session) ? session.emomStartedAt || null : session.startedAt || null;
  }

  function emomClockState(session: ActiveSession): EmomClockState {
    const legacyRunningSince = session.emomRunningSince || (session.emomStartedAt && session.emomPositionSec == null ? session.emomStartedAt : undefined);
    const runningSinceMs = legacyRunningSince ? new Date(legacyRunningSince).getTime() : null;
    return {
      positionSec: Number(session.emomPositionSec) || 0,
      activeSec: Number(session.emomActiveSec) || 0,
      runningSinceMs: runningSinceMs != null && Number.isFinite(runningSinceMs) ? runningSinceMs : null
    };
  }

  function applyEmomClock(session: ActiveSession, clock: EmomClockState): void {
    session.emomPositionSec = clock.positionSec;
    session.emomActiveSec = clock.activeSec;
    session.emomRunningSince = clock.runningSinceMs == null ? undefined : new Date(clock.runningSinceMs).toISOString();
  }

  function persistEmomClock(session: ActiveSession): void {
    const id = session.id;
    const positionSec = Number(session.emomPositionSec) || 0;
    const activeSec = Number(session.emomActiveSec) || 0;
    const runningSince = session.emomRunningSince;
    emomPersistQueue = emomPersistQueue.then(async () => {
      await state.store?.updateSessionEmomClock?.(id, positionSec, activeSec, runningSince);
    });
  }

  function startSessionElapsedTimer(session: ActiveSession): void {
    window.clearInterval(sessionElapsedTimer);
    updateSessionElapsed(session);
    if (!effectiveSessionStartedAt(session)) return;
    sessionElapsedTimer = window.setInterval(() => { if (state.activeSession) updateSessionElapsed(state.activeSession); }, 1000);
  }

  function reconcileEmomClocks(now = Date.now()): void {
    if (!state.activeSession) return;
    updateSessionElapsed(state.activeSession, now);
    reconcileEmom(now);
  }

  function startEmomClockTimer(session: ActiveSession): void {
    window.clearInterval(sessionElapsedTimer);
    window.clearInterval(emomTimer);
    reconcileEmomClocks();
    emomTimer = window.setInterval(() => reconcileEmomClocks(), 1000);
  }

  function reconcileEmom(now = Date.now()): void {
    const session = state.activeSession;
    const blocks = activeEmomBlocks();
    if (!session || !blocks.length) return;
    const schedule = compileEmomBlocks(blocks);
    const clock = emomClockSnapshot(emomClockState(session), now);
    const position = session.emomStartedAt ? emomPosition(schedule, now - clock.positionSec * 1000, now) : emomPosition(schedule, null, now);
    if (position.phase === 'complete' && clock.running && !emomCompletionHandled) {
      emomCompletionHandled = true;
      applyEmomClock(session, { positionSec: emomDurationSec(schedule), activeSec: clock.activeSec, runningSinceMs: null });
      persistEmomClock(session);
      window.clearInterval(emomTimer);
    }
    cueEmomPosition(position);
    const countdown = root.querySelector('#emom-countdown');
    if (countdown) countdown.textContent = String(position.secondsRemaining);
    const ring = root.querySelector<SVGCircleElement>('#emom-ring-fg');
    if (ring && position.slot) {
      const circumference = 339.3;
      ring.style.strokeDashoffset = String(circumference * (1 - position.secondsRemaining / position.slot.durationSec));
    }
    const progress = root.querySelector<HTMLElement>('#session-progress-fill');
    if (progress) {
      const completed = position.phase === 'complete' ? schedule.length : position.slot?.index || 0;
      progress.style.width = schedule.length ? `${Math.round((completed / schedule.length) * 100)}%` : '0%';
    }
    const key = `${position.phase}:${position.slot?.index ?? -1}:${position.activeStepIndex ?? -1}`;
    if (key === emomRenderKey) return;
    emomRenderKey = key;
    renderEmomSession(blocks, schedule, position);
  }

  function cueEmomPosition(position: EmomPosition): void {
    const slotIndex = position.slot?.index ?? null;
    if (emomPreviousPhase === 'running' && emomPreviousSlotIndex !== null
      && (position.phase === 'complete' || slotIndex !== emomPreviousSlotIndex)) {
      playCountdownCue(countdownCueGuard.finish('emom', emomPreviousSlotIndex));
    }
    if (position.phase === 'running' && slotIndex !== null) {
      playCountdownCue(countdownCueGuard.countdown('emom', slotIndex, position.secondsRemaining));
    }
    emomPreviousPhase = position.phase;
    emomPreviousSlotIndex = slotIndex;
  }

  function renderEmomSession(blocks: EmomBlock[], schedule: EmomSlot[], position: EmomPosition): void {
    const session = state.activeSession;
    const title = root.querySelector('#session-title');
    const meta = root.querySelector('#session-meta');
    const nav = root.querySelector('#session-ex-nav');
    const body = root.querySelector('#session-body');
    const footer = root.querySelector('#session-footer');
    if (!session || !title || !meta || !nav || !body || !footer) return;
    title.textContent = session.sheetName || 'EMOM';
    nav.innerHTML = '';
    if (position.phase === 'pending') {
      meta.textContent = blocks.length > 1 ? `EMOM · ${blocks.length} sections · ${Math.ceil(emomDurationSec(schedule) / 60)} min` : `EMOM · ${blocks[0].rounds} round${blocks[0].rounds === 1 ? '' : 's'} · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}`;
      body.innerHTML = `<div class="emom-hero"><div class="emom-badge">EMOM</div><div class="emom-countdown" id="emom-countdown">${position.secondsRemaining}</div><div class="emom-caption">seconds per first interval</div><p>The clock starts when you are ready. Actual reps are logged separately from each timed target.</p></div>`;
      footer.innerHTML = '<button class="session-finish-btn" id="emom-start" type="button">Start EMOM</button>';
      root.querySelector('#emom-start')?.addEventListener('click', () => { unlockCountdownAudio(); void startEmom(); });
      bindSessionControls();
      return;
    }
    if (position.phase === 'complete' || !position.slot) {
      meta.textContent = 'EMOM complete';
      nav.innerHTML = schedule.map((candidate) => `<button class="session-ex-dot done" data-emom-seek="${candidate.startsAtSec}" type="button" title="Return to interval ${candidate.index + 1}">${candidate.index + 1}</button>`).join('');
      body.innerHTML = '<div class="emom-hero complete"><div class="emom-badge">Complete</div><div class="session-ex-name">EMOM finished</div><p>Review your logged work, then finish the session when you are ready.</p></div>';
      footer.innerHTML = '<button class="session-prev-btn" id="emom-prev" type="button">Previous</button><button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
      bindSessionControls();
      return;
    }
    const slot = position.slot;
    const block = blocks[slot.blockIndex];
    const paused = emomClockState(session).runningSinceMs == null;
    meta.textContent = `${paused ? 'Paused · ' : ''}${blocks.length > 1 ? `Section ${slot.blockIndex + 1} of ${blocks.length} · ` : ''}Round ${slot.roundIndex + 1} of ${block.rounds} · Interval ${slot.intervalIndex + 1} of ${block.intervals.length}`;
    nav.innerHTML = schedule.map((candidate) => {
      const cls = candidate.index === slot.index ? 'current' : candidate.index < slot.index ? 'done' : '';
      return `<button class="session-ex-dot ${cls}" data-emom-seek="${candidate.startsAtSec}" type="button" title="Section ${candidate.blockIndex + 1}, round ${candidate.roundIndex + 1}">${candidate.index + 1}</button>`;
    }).join('');
    const steps = slot.steps.map((step, stepIndex) => {
      const exercise = session.exercises.find((candidate) => candidate.exerciseSlug === step.exerciseSlug);
      const logged = session.sets.find((set) => set.blockIndex === slot.blockIndex && set.roundIndex === slot.roundIndex && set.intervalIndex === slot.intervalIndex && set.stepIndex === stepIndex);
      const hasUntimedSteps = slot.steps.some((candidate) => !Number(candidate.targetDurationSec));
      const active = position.activeStepIndex === stepIndex || (position.activeStepIndex == null && hasUntimedSteps);
      const target = [step.targetDurationSec ? `${step.targetDurationSec}s` : '', step.targetReps ? `${html(step.targetReps)} reps` : ''].filter(Boolean).join(' · ');
      const name = step.exerciseName || exercise?.exerciseName || step.exerciseSlug;
      return `<div class="emom-step emom-workout-card ${active ? 'active' : ''} ${logged ? 'done' : ''}" data-emom-step="${stepIndex}">
        ${exercise?.imageUrl ? `<img class="session-ex-image" src="${html(exercise.imageUrl)}" alt="${html(name)}">` : ''}
        <div class="session-ex-name">${html(name)}</div>
        <div class="session-ex-target"><b>${target || 'Open target'}</b><span class="dot"></span><span>Every ${slot.durationSec}s</span></div>
        <div class="emom-log-row">
          <input class="session-set-input" data-emom-reps type="number" inputmode="numeric" placeholder="actual reps" ${logged ? `value="${logged.reps ?? ''}" disabled` : ''}>
          <input class="session-set-input" data-emom-weight type="number" inputmode="decimal" step="0.5" placeholder="${ctx.unitLabel()}" ${logged ? `value="${logged.weight == null ? '' : sessionWeightDisplay(logged.weight)}" disabled` : ''}>
          <button class="session-log-btn ${logged ? 'done' : ''}" data-log-emom="${stepIndex}" type="button" ${logged ? 'disabled' : ''}>${logged ? 'Done' : 'Log'}</button>
        </div>
      </div>`;
    }).join('');
    const nextSlot = schedule[slot.index + 1];
    const nextStep = nextSlot?.steps[0];
    body.innerHTML = `<div class="emom-live-layout">
      <div class="emom-timer-panel ${paused ? 'paused' : ''}">
        <div class="emom-badge">${paused ? 'Paused' : 'EMOM'}</div>
        <div class="rest-timer-wrap emom-timer-wrap"><svg class="rest-ring" viewBox="0 0 120 120"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="emom-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="339.3" stroke-dashoffset="${339.3 * (1 - position.secondsRemaining / slot.durationSec)}"/></svg><div class="emom-countdown" id="emom-countdown">${position.secondsRemaining}</div></div>
        <div class="emom-caption">seconds left · interval ${slot.index + 1} of ${schedule.length}</div>
      </div>
      <div class="emom-steps">${steps}</div>
      <div class="emom-next-card"><span>Next up</span><strong>${nextStep ? html(nextStep.exerciseName || nextStep.exerciseSlug) : 'Finish session'}</strong><small>${nextSlot ? `Round ${nextSlot.roundIndex + 1} · ${nextSlot.durationSec}s interval` : 'Workout complete'}</small></div>
    </div>`;
    footer.innerHTML = `<button class="session-prev-btn" id="emom-prev" type="button" ${slot.index === 0 && position.elapsedInSlotSec <= 3 ? 'disabled' : ''}>Previous</button><button class="session-next-btn emom-pause-btn" id="emom-pause" type="button">${paused ? 'Resume' : 'Pause'}</button><button class="session-next-btn" id="emom-next" type="button">Next</button>`;
    root.querySelectorAll<HTMLButtonElement>('[data-log-emom]').forEach((button) => button.addEventListener('click', () => { void logEmomStep(slot, Number(button.dataset.logEmom), button); }));
    bindSessionControls();
  }

  async function startEmom(): Promise<void> {
    if (!state.activeSession || !activeEmomBlocks().length) return;
    const startedAt = new Date().toISOString();
    state.activeSession.emomStartedAt = startedAt;
    state.activeSession.startedAt = startedAt;
    state.activeSession.emomPositionSec = 0;
    state.activeSession.emomActiveSec = 0;
    state.activeSession.emomRunningSince = startedAt;
    emomPersistQueue = state.store?.startSessionEmom(state.activeSession.id, startedAt) || Promise.resolve();
    emomRenderKey = '';
    emomPreviousPhase = null;
    emomPreviousSlotIndex = null;
    emomCompletionHandled = false;
    startEmomClockTimer(state.activeSession);
    await emomPersistQueue;
  }

  function toggleEmomPause(): void {
    const session = state.activeSession;
    if (!session?.emomStartedAt) return;
    const now = Date.now();
    const current = emomClockState(session);
    const next = current.runningSinceMs == null ? resumeEmomClock(current, now) : pauseEmomClock(current, now);
    applyEmomClock(session, next);
    persistEmomClock(session);
    emomRenderKey = '';
    if (next.runningSinceMs == null) {
      window.clearInterval(emomTimer);
      reconcileEmomClocks(now);
    } else {
      startEmomClockTimer(session);
    }
  }

  function seekEmomTo(positionSec: number): void {
    const session = state.activeSession;
    if (!session?.emomStartedAt) return;
    const now = Date.now();
    applyEmomClock(session, seekEmomClock(emomClockState(session), positionSec, now));
    persistEmomClock(session);
    emomRenderKey = '';
    emomPreviousPhase = null;
    emomPreviousSlotIndex = null;
    emomCompletionHandled = false;
    reconcileEmomClocks(now);
  }

  function moveEmomSlot(direction: -1 | 1): void {
    const session = state.activeSession;
    const blocks = activeEmomBlocks();
    if (!session || !blocks.length) return;
    const schedule = compileEmomBlocks(blocks);
    const snapshot = emomClockSnapshot(emomClockState(session));
    const current = schedule.find((slot) => snapshot.positionSec < slot.endsAtSec) || schedule.at(-1);
    if (!current) return;
    if (direction < 0) {
      const targetIndex = snapshot.positionSec - current.startsAtSec > 3 ? current.index : Math.max(0, current.index - 1);
      seekEmomTo(schedule[targetIndex].startsAtSec);
    } else {
      const next = schedule[current.index + 1];
      seekEmomTo(next?.startsAtSec ?? emomDurationSec(schedule));
    }
  }

  async function logEmomStep(slot: EmomSlot, stepIndex: number, button: HTMLButtonElement): Promise<void> {
    const session = state.activeSession;
    const step = slot.steps[stepIndex];
    const host = button.closest<HTMLElement>('[data-emom-step]');
    if (!session || !step || !host) return;
    const repsRaw = host.querySelector<HTMLInputElement>('[data-emom-reps]')?.value || '';
    const weightRaw = host.querySelector<HTMLInputElement>('[data-emom-weight]')?.value || '';
    if (!repsRaw && !weightRaw && !step.targetDurationSec) {
      host.querySelector<HTMLInputElement>('[data-emom-reps]')?.focus();
      return;
    }
    const exercise = session.exercises.find((candidate) => candidate.exerciseSlug === step.exerciseSlug);
    const reps = repsRaw ? Number(repsRaw) : null;
    const weight = weightRaw ? storeWeightInput(weightRaw, normalizeWeightUnit(state.settings.unit)) : null;
    const completedAt = new Date().toISOString();
    const setNumber = session.sets.filter((set) => set.exerciseSlug === step.exerciseSlug).length + 1;
    const loggedSet: SessionSetLog = {
      exerciseSlug: step.exerciseSlug,
      exerciseName: step.exerciseName || exercise?.exerciseName,
      setNumber,
      reps,
      weight,
      durationSec: step.targetDurationSec,
      blockIndex: slot.blockIndex,
      roundIndex: slot.roundIndex,
      intervalIndex: slot.intervalIndex,
      stepIndex,
      done: true,
      completedAt
    };
    if (state.store) await state.store.addSessionSet({
      session_id: session.id,
      exercise_slug: step.exerciseSlug,
      exercise_name: loggedSet.exerciseName || step.exerciseSlug,
      set_number: setNumber,
      reps,
      weight_kg: weight,
      duration_sec: step.targetDurationSec,
      block_index: slot.blockIndex,
      round_index: slot.roundIndex,
      interval_index: slot.intervalIndex,
      step_index: stepIndex,
      completed_at: completedAt
    });
    session.sets.push(loggedSet);
    emomRenderKey = '';
    reconcileEmom();
  }

  function updateSessionElapsed(session: ActiveSession, now = Date.now()): void {
    const el = root.querySelector('#session-elapsed');
    if (!el) return;
    const startedAt = effectiveSessionStartedAt(session);
    if (!startedAt) { el.textContent = '00:00'; return; }
    const seconds = isEmomSession(session)
      ? Math.max(0, Math.floor(emomClockSnapshot(emomClockState(session), now).activeSec))
      : Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
    el.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function loggedSetCount(slug: string): number {
    return state.activeSession ? state.activeSession.sets.filter((set) => set.exerciseSlug === slug && set.done).length : 0;
  }

  function updateSessionProgress(): void {
    const fill = root.querySelector<HTMLElement>('#session-progress-fill');
    if (!fill || !state.activeSession) return;
    const exercises = getSessionExercises(state.activeSession);
    let total = 0, done = 0;
    exercises.forEach((ex) => {
      const target = sessionSetCounts[ex.exerciseSlug] || Number(ex.sets) || 1;
      total += target;
      done += Math.min(loggedSetCount(ex.exerciseSlug), target);
    });
    fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function renderSessionNav(exercises: SessionExercise[]): void {
    const nav = root.querySelector('#session-ex-nav');
    if (!nav) return;
    nav.innerHTML = exercises.map((ex, i) => {
      const target = Number(ex.sets) || sessionSetCounts[ex.exerciseSlug] || 1;
      const cls = i === sessionExerciseIndex ? 'current' : loggedSetCount(ex.exerciseSlug) >= target ? 'done' : '';
      return `<button class="session-ex-dot ${cls}" data-jump-ex="${i}" type="button">${i + 1}</button>`;
    }).join('');
  }

  function previousSetKey(sessionId: number, slug: string): string { return `${sessionId}:${slug}`; }

  async function getPreviousSets(sessionId: number, slug: string): Promise<SessionSetLog[]> {
    const key = previousSetKey(sessionId, slug);
    if (!sessionPreviousSets.has(key)) sessionPreviousSets.set(key, []);
    return sessionPreviousSets.get(key) || [];
  }

  function formatSetHint(set: SessionSetLog): string {
    const reps = set.reps ?? '?';
    const weight = set.weight == null ? '' : ` @ ${ctx.wFmt(set.weight)}`;
    return `${reps}${weight}`;
  }

  function suggestedSetHint(prev: SessionSetLog, targetReps: string): string {
    return `suggested: ${html(targetReps || String(prev.reps || 'reps'))} reps${prev.weight == null ? '' : ` @ ${ctx.wFmt(prev.weight)}`}`;
  }

  async function renderSessionExercise(session: ActiveSession): Promise<void> {
    const exercises = getSessionExercises(session);
    const title = root.querySelector('#session-title');
    const meta = root.querySelector('#session-meta');
    const body = root.querySelector('#session-body');
    const footer = root.querySelector('#session-footer');
    if (!title || !meta || !body || !footer) return;
    if (!exercises.length) {
      title.textContent = session.sheetName || 'Freestyle';
      meta.textContent = 'No exercises yet';
      body.innerHTML = '<div class="empty">This session has no exercises yet.</div>';
      footer.innerHTML = '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
      return;
    }
    if (sessionExerciseIndex >= exercises.length) sessionExerciseIndex = exercises.length - 1;
    const ex = exercises[sessionExerciseIndex];
    const slug = ex.exerciseSlug;
    const name = ex.exerciseName || slug;
    const restSec = Number(ex.restSec) || 90;
    const targetSets = Number(ex.sets) || sessionSetCounts[slug] || 1;
    const targetReps = ex.reps || '';
    const logged = session.sets.filter((set) => set.exerciseSlug === slug);
    const previousSets = await getPreviousSets(session.id, slug);
    if (state.activeSession?.id !== session.id || getSessionExercises(state.activeSession)[sessionExerciseIndex]?.exerciseSlug !== slug) return;
    sessionSetCounts[slug] = Math.max(sessionSetCounts[slug] || targetSets, logged.length || targetSets);
    const rows = Array.from({ length: sessionSetCounts[slug] }, (_, i) => {
      const done = logged.find((set) => Number(set.setNumber) === i + 1);
      const prev = previousSets[i];
      const locked = !done && i > 0 && !logged.find((set) => Number(set.setNumber) === i);
      const prevHint = prev ? `<div class="session-set-hint prev">prev: ${html(formatSetHint(prev))}</div>` : '';
      const suggestHint = prev ? `<div class="session-set-hint suggest">${suggestedSetHint(prev, targetReps)}</div>` : '';
      const defaultReps = String(done?.reps ?? (targetReps || prev?.reps || ''));
      const defaultWeight = done?.weight != null ? sessionWeightDisplay(done.weight) : (prev?.weight != null ? sessionWeightDisplay(prev.weight) : sessionWeightDisplay(ex.weight));
      return `<div class="session-set-block ${locked ? 'locked' : ''}" data-set-block="${i}">
        <div class="session-set-row">
          <div class="session-set-num ${done ? 'done' : ''}" data-set-num="${i}">${i + 1}</div>
          <input class="session-set-input" data-session-reps="${i}" type="number" inputmode="numeric" placeholder="${html(targetReps || prev?.reps || 'reps')}" value="${html(defaultReps)}" ${done || locked ? 'disabled' : ''}>
          <input class="session-set-input" data-session-weight="${i}" type="number" inputmode="decimal" step="0.5" placeholder="${html(defaultWeight || ctx.unitLabel())}" value="${html(defaultWeight)}" ${done || locked ? 'disabled' : ''}>
          ${done ? `<button class="session-log-btn done" data-set-log-btn="${i}" disabled type="button">Done</button>` : `<button class="session-log-btn" data-session-log="${html(slug)}" data-set-index="${i}" data-set-log-btn="${i}" data-rest="${restSec}" ${locked ? 'disabled' : ''} type="button">Log</button>`}
        </div>
        ${prevHint}${suggestHint}
      </div>`;
    }).join('');
    const instructions = ex.instructions || [];
    const instructionsHtml = instructions.length ? `
      <div class="session-instructions" id="session-instructions">
        <div class="session-instructions-toggle" data-toggle-instructions>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>How to perform</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="session-instructions-body">
          ${instructions.map((step, i) => `<div class="session-instructions-step"><b>${i + 1}</b>${html(step)}</div>`).join('')}
        </div>
      </div>` : '';
    title.textContent = session.sheetName || 'Freestyle';
    meta.textContent = `Exercise ${sessionExerciseIndex + 1} of ${exercises.length}`;
    renderSessionNav(exercises);
    body.innerHTML = `
      ${ex.imageUrl ? `<img class="session-ex-image" src="${html(ex.imageUrl)}" alt="${html(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='No exercise image'">` : '<div class="session-ex-image placeholder">No exercise image</div>'}
      <div class="session-ex-name">${html(name)}</div>
      <div class="session-ex-target"><b>${targetSets}</b> sets <span class="dot"></span> <b>${html(targetReps || 'free')}</b> reps <span class="dot"></span> <b>${restSec}s</b> rest</div>
      <div class="session-sets">${rows}</div>
      <button class="session-add-set" data-add-session-set="${html(slug)}" type="button">+ Add set</button>
      ${instructionsHtml}`;
    const isLast = sessionExerciseIndex >= exercises.length - 1;
    footer.innerHTML = `${sessionExerciseIndex > 0 ? `<button class="session-prev-btn" data-jump-ex="${sessionExerciseIndex - 1}" type="button">Prev</button>` : ''}${isLast ? '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>' : `<button class="session-next-btn" data-jump-ex="${sessionExerciseIndex + 1}" type="button">Next</button>`}`;
    bindSessionControls();
    updateSessionProgress();
  }

  async function logSessionSet(slug: string, setIndex: number, restSec: number): Promise<void> {
    if (!state.activeSession) return;
    const repsEl = root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex}"]`);
    const weightEl = root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex}"]`);
    const logBtn = root.querySelector<HTMLButtonElement>(`[data-set-log-btn="${setIndex}"]`);
    const reps = repsEl?.value ?? '';
    const weight = weightEl?.value ?? '';
    if (reps === '' && weight === '') {
      repsEl?.focus(); repsEl?.classList.add('shake'); window.setTimeout(() => repsEl?.classList.remove('shake'), 420); return;
    }
    const repsNum = reps === '' ? null : Number(reps);
    const weightNum = weight === '' ? null : storeWeightInput(weight, normalizeWeightUnit(state.settings.unit));
    if (logBtn) { logBtn.disabled = true; logBtn.textContent = '···'; }
    const currentExercise = getSessionExercises(state.activeSession).find((exercise) => exercise.exerciseSlug === slug);
    const loggedSet: SessionSetLog = { exerciseSlug: slug, exerciseName: currentExercise?.exerciseName, setNumber: setIndex + 1, reps: repsNum, weight: weightNum, done: true, completedAt: new Date().toISOString() };
    if (state.store) {
      await state.store.addSessionSet({
        session_id: state.activeSession.id,
        exercise_slug: slug,
        exercise_name: currentExercise?.exerciseName || slug,
        set_number: setIndex + 1,
        reps: repsNum,
        weight_kg: weightNum,
        completed_at: loggedSet.completedAt
      });
    }
    state.activeSession.sets.push(loggedSet);
    if (repsEl) repsEl.disabled = true;
    if (weightEl) weightEl.disabled = true;
    root.querySelector(`[data-set-num="${setIndex}"]`)?.classList.add('done');
    root.querySelector(`[data-set-block="${setIndex}"]`)?.classList.add('just-logged');
    if (logBtn) { logBtn.textContent = 'Done'; logBtn.classList.add('done'); logBtn.disabled = true; logBtn.removeAttribute('data-session-log'); }
    const nextBlock = root.querySelector(`[data-set-block="${setIndex + 1}"]`);
    if (nextBlock) {
      nextBlock.classList.remove('locked');
      nextBlock.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => { el.disabled = false; });
      const nReps = root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex + 1}"]`);
      const nWeight = root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex + 1}"]`);
      if (nReps && !nReps.value && repsNum != null) nReps.value = String(repsNum);
      if (nWeight && !nWeight.value && weight !== '') nWeight.value = weight;
    }
    renderSessionNav(getSessionExercises(state.activeSession));
    updateSessionProgress();
    const target = sessionSetCounts[slug] || 1;
    const allDone = loggedSetCount(slug) >= target;
    startSessionRest(restSec, allDone);
  }

  function startSessionRest(sec: number, autoAdvance: boolean): void {
    root.querySelector('#session-rest-overlay')?.classList.add('show');
    sessionRestTotal = Number(sec) || 90;
    sessionRestRemaining = sessionRestTotal;
    sessionRestEndsAt = Date.now() + sessionRestTotal * 1000;
    restCuePeriod += 1;
    sessionRestAutoAdvance = autoAdvance;
    const nextUp = root.querySelector('#rest-nextup');
    if (nextUp && state.activeSession) {
      const exercises = getSessionExercises(state.activeSession);
      const next = autoAdvance ? exercises[sessionExerciseIndex + 1] : null;
      nextUp.innerHTML = next ? `Next up: <b>${html(next.exerciseName || next.exerciseSlug)}</b>` : '';
    }
    updateSessionRestDisplay();
    cueRestCountdown();
    window.clearInterval(sessionRestTimer);
    sessionRestTimer = window.setInterval(reconcileSessionRest, 1000);
  }

  function reconcileSessionRest(): void {
    if (!sessionRestEndsAt) return;
    sessionRestRemaining = restSecondsRemaining(sessionRestEndsAt);
    updateSessionRestDisplay();
    cueRestCountdown();
    if (sessionRestRemaining > 0) return;
    const autoAdvance = sessionRestAutoAdvance;
    skipSessionRest();
    if (autoAdvance && state.activeSession) {
      const exercises = getSessionExercises(state.activeSession);
      if (sessionExerciseIndex < exercises.length - 1) { sessionExerciseIndex += 1; void renderSessionExercise(state.activeSession); }
    }
  }

  function cueRestCountdown(): void {
    const cue = sessionRestRemaining === 0
      ? countdownCueGuard.finish('rest', restCuePeriod)
      : countdownCueGuard.countdown('rest', restCuePeriod, sessionRestRemaining);
    playCountdownCue(cue);
  }

  function updateSessionRestDisplay(): void {
    const val = root.querySelector('#session-rest-val');
    if (val) val.textContent = String(sessionRestRemaining);
    const fg = root.querySelector<SVGCircleElement>('#rest-ring-fg');
    if (fg) {
      const circumference = 339.3;
      const offset = sessionRestTotal > 0 ? circumference * (1 - sessionRestRemaining / sessionRestTotal) : 0;
      fg.style.strokeDashoffset = String(Math.max(0, Math.min(circumference, offset)));
      fg.style.stroke = sessionRestRemaining <= 5 ? 'var(--danger-red)' : 'var(--sovereign-purple)';
    }
  }

  function adjustRest(delta: number): void {
    if (sessionRestEndsAt) sessionRestRemaining = restSecondsRemaining(sessionRestEndsAt);
    sessionRestRemaining = Math.max(5, sessionRestRemaining + delta);
    sessionRestEndsAt = Date.now() + sessionRestRemaining * 1000;
    if (sessionRestTotal < sessionRestRemaining) sessionRestTotal = sessionRestRemaining;
    updateSessionRestDisplay();
  }

  function skipSessionRest(): void {
    window.clearInterval(sessionRestTimer);
    sessionRestEndsAt = 0;
    sessionRestAutoAdvance = false;
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
  }

  async function finishActiveSession(): Promise<void> {
    if (!state.activeSession) return;
    if (isEmomSession(state.activeSession) && state.activeSession.emomStartedAt) {
      applyEmomClock(state.activeSession, pauseEmomClock(emomClockState(state.activeSession)));
      persistEmomClock(state.activeSession);
      await emomPersistQueue;
    }
    state.activeSession.finishedAt = new Date().toISOString();
    if (state.store) await state.store.finishSession(state.activeSession.id, state.activeSession.finishedAt);
    const finished = state.activeSession;
    state.finishedSessions = state.store ? await ctx.loadFinishedSessions() : [finished, ...state.finishedSessions];
    closeSessionOverlay();
    state.activeSession = null;
    renderFinished(finished);
  }

  async function publishSessionSummary(session: ActiveSession, button: HTMLButtonElement | null): Promise<void> {
    if (session.nostrEventId || state.publishingSessionId !== null) return;
    const signer = await ctx.getActiveSigner();
    if (!signer) {
      ctx.toast(state.pubkey ? 'Signer connection was lost — sign in again from Settings to publish' : 'Sign in with your Nostr signer in Settings to publish', 'bad');
      return;
    }
    state.publishingSessionId = session.id;
    state.publishingStatus = 'Waiting for signer...';
    if (button) { button.disabled = true; button.textContent = state.publishingStatus; }
    let message: { text: string; kind: 'ok' | 'bad' };
    const setPublishStatus = (text: string): void => {
      state.publishingStatus = text;
      if (button?.isConnected) button.textContent = text;
    };
    const publishLabel = (stage: string): string => ({
      'preparing-image': 'Preparing muscle map...',
      'waiting-for-signer': 'Waiting for signer...',
      'uploading-image': 'Uploading muscle map...',
      publishing: 'Publishing...'
    }[stage] || 'Waiting for signer...');
    try {
      const imageUrl = await resolveSessionSummaryImageUrl(session);
      const result = await publishWorkoutSummary(signer, session, normalizeWeightUnit(state.settings.unit), undefined, {
        exercises: state.exercises,
        imageUrl,
        onStage: (stage) => setPublishStatus(publishLabel(stage))
      });
      session.nostrEventId = result.event.id;
      if (state.store) await state.store.markSessionPublished(session.id, result.event.id);
      const inHistory = state.finishedSessions.find((item) => item.id === session.id);
      if (inHistory) inHistory.nostrEventId = result.event.id;
      if (button?.isConnected) { button.textContent = 'Published'; }
      message = { text: `Summary published to ${result.okRelays.length} relay${result.okRelays.length === 1 ? '' : 's'}`, kind: 'ok' };
    } catch (error) {
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Publish summary'; }
      message = { text: `Publish failed: ${(error as Error).message}`, kind: 'bad' };
    }
    state.publishingSessionId = null;
    state.publishingStatus = null;
    // A background render (canon/profile fetch) may have replaced the button
    // we were mutating — refresh from state, but never while a modal (workout
    // recap) is open: render() would wipe it. Toast last: render rebuilds #toast.
    if (!button?.isConnected && !root.querySelector('#modal.open')) ctx.render();
    ctx.toast(message.text, message.kind);
  }

  async function cancelActiveSession(): Promise<void> {
    if (!state.activeSession) return closeSessionOverlay();
    if (!window.confirm('End and discard this session? Logged sets will be deleted.')) return;
    if (state.store) await state.store.deleteSession(state.activeSession.id);
    state.activeSession = null;
    closeSessionOverlay();
  }

  function closeSessionOverlay(clear = true): void {
    window.clearInterval(sessionRestTimer);
    window.clearInterval(sessionElapsedTimer);
    window.clearInterval(emomTimer);
    countdownCueGuard.reset();
    emomPreviousPhase = null;
    emomPreviousSlotIndex = null;
    releaseSessionWakeLock();
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
    root.querySelector('#session-overlay')?.classList.remove('open');
    root.querySelector('#pr-toast')?.classList.remove('show');
    if (clear) {
      sessionSetCounts = {};
      sessionExerciseIndex = 0;
      sessionPreviousSets.clear();
    }
  }

  function sessionDurationLabel(session: ActiveSession): string {
    const startedAt = effectiveSessionStartedAt(session);
    if (!startedAt || !session.finishedAt) return '—';
    const sec = isEmomSession(session) && session.emomActiveSec != null
      ? Math.max(0, Math.round(session.emomActiveSec))
      : Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function renderFinished(session: ActiveSession): void {
    const doneSets = session.sets.filter((set) => set.done);
    const volume = Math.round(doneSets.reduce((a, set) => a + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));
    const exerciseCount = new Set(doneSets.map((set) => set.exerciseSlug)).size;
    const stats = [
      { val: sessionDurationLabel(session), label: 'Duration' },
      { val: doneSets.length, label: 'Sets' },
      { val: volume > 0 ? `${Math.round(ctx.wDisplay(volume) ?? 0)} ${ctx.unitLabel()}` : '—', label: 'Volume' },
      { val: exerciseCount, label: 'Exercises' }
    ];
    ctx.openModal(`
      <div class="summary-hero">
        <div class="sh-medal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12"/></svg></div>
        <div class="sh-copy"><strong>${html(session.sheetName || 'Freestyle')}</strong><small>nicely done — here's the recap</small></div>
      </div>
      <div class="summary-stats">${stats.map((item) => `<div class="summary-stat"><div class="ss-val">${html(String(item.val))}</div><div class="ss-label">${item.label}</div></div>`).join('')}</div>
      <div class="subsection-head"><span>Vs last time</span><small>working-set volume per exercise</small></div>
      <div class="summary-compare"><div class="empty">First local web session — comparison appears after you repeat this workout.</div></div>
      <div class="form-actions">
        ${state.pubkey
          ? '<button class="button primary" id="finish-publish" type="button">Publish summary</button>'
          : '<button class="button primary" id="finish-publish" type="button" disabled title="Sign in with your Nostr signer in Settings to publish">Publish summary</button>'}
        <button class="button ghost" id="finish-done" type="button">Done</button>
      </div>`);
    root.querySelector('#finish-publish')?.addEventListener('click', (event) => { void publishSessionSummary(session, event.currentTarget as HTMLButtonElement); });
    root.querySelector('#finish-done')?.addEventListener('click', ctx.closeModal);
  }

  function bindSessionControls(): void {
    const closeButton = root.querySelector<HTMLButtonElement>('#session-close');
    if (closeButton) closeButton.onclick = () => { void cancelActiveSession(); };
    const restSkipButton = root.querySelector<HTMLButtonElement>('#rest-skip');
    if (restSkipButton) restSkipButton.onclick = skipSessionRest;
    root.querySelectorAll<HTMLElement>('[data-rest-adjust]').forEach((button) => { button.onclick = () => adjustRest(Number(button.dataset.restAdjust) || 0); });
    root.querySelectorAll<HTMLElement>('[data-emom-seek]').forEach((button) => { button.onclick = () => seekEmomTo(Number(button.dataset.emomSeek) || 0); });
    const emomPreviousButton = root.querySelector<HTMLButtonElement>('#emom-prev');
    if (emomPreviousButton) emomPreviousButton.onclick = () => moveEmomSlot(-1);
    const emomPauseButton = root.querySelector<HTMLButtonElement>('#emom-pause');
    if (emomPauseButton) emomPauseButton.onclick = toggleEmomPause;
    const emomNextButton = root.querySelector<HTMLButtonElement>('#emom-next');
    if (emomNextButton) emomNextButton.onclick = () => moveEmomSlot(1);
    root.querySelectorAll<HTMLElement>('[data-jump-ex]').forEach((button) => { button.onclick = () => {
      if (!state.activeSession) return;
      sessionExerciseIndex = Number(button.dataset.jumpEx) || 0;
      void renderSessionExercise(state.activeSession);
    }; });
    root.querySelectorAll<HTMLElement>('[data-session-log]').forEach((button) => { button.onclick = () => {
      unlockCountdownAudio();
      void logSessionSet(button.dataset.sessionLog || '', Number(button.dataset.setIndex) || 0, Number(button.dataset.rest) || 90);
    }; });
    root.querySelectorAll<HTMLElement>('[data-add-session-set]').forEach((button) => { button.onclick = () => {
      if (!state.activeSession) return;
      const slug = button.dataset.addSessionSet || '';
      sessionSetCounts[slug] = (sessionSetCounts[slug] || 0) + 1;
      void renderSessionExercise(state.activeSession);
    }; });
    const finishButton = root.querySelector<HTMLButtonElement>('#finish-session');
    if (finishButton) finishButton.onclick = () => { void finishActiveSession(); };
    const instructionsButton = root.querySelector<HTMLElement>('[data-toggle-instructions]');
    if (instructionsButton) instructionsButton.onclick = () => root.querySelector('#session-instructions')?.classList.toggle('open');
  }

  return { startTrainingSession, openSessionOverlay, publishSessionSummary, bindSessionControls };
}
