import { slugify } from '../core/ids';
import { displayWeightKg, normalizeWeightUnit, storeWeightInput } from '../core/units';
import { html, programMuscleLabel } from './format';
import { inferProgramMuscle, programExerciseName, resolveProgramExercise } from '../features/sheets/views';
import { fetchCanonPrograms, type RelayProgram } from '../nostr/canon';
import { publishWorkoutSummary } from '../nostr/share';
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

export function createSessionRunner(ctx: SessionRunnerContext): SessionRunner {
  const { state, root } = ctx;

  let sessionExerciseIndex = 0;
  let sessionSetCounts: Record<string, number> = {};
  let sessionRestTimer = 0;
  let sessionRestTotal = 0;
  let sessionRestRemaining = 0;
  let sessionElapsedTimer = 0;
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
    const sessionId = state.store ? await state.store.createSession({ sheet_name: program.name || 'Freestyle', started_at: startedAt, summary_image_url: program.muscleMapUrl || '', exercises }) : Date.now();
    state.activeSession = { id: sessionId, sheetName: program.name || 'Freestyle', startedAt, summaryImageUrl: program.muscleMapUrl || '', exercises, sets: [] };
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
    if (document.visibilityState === 'visible' && state.activeSession && root.querySelector('#session-overlay')?.classList.contains('open')) void requestSessionWakeLock();
  });

  async function openSessionOverlay(session: ActiveSession): Promise<void> {
    root.querySelector('#session-overlay')?.classList.add('open');
    void requestSessionWakeLock();
    window.clearInterval(sessionElapsedTimer);
    updateSessionElapsed(session);
    sessionElapsedTimer = window.setInterval(() => { if (state.activeSession) updateSessionElapsed(state.activeSession); }, 1000);
    if (!Object.keys(sessionSetCounts).length) sessionSetCounts = setCountsFromSession(session);
    await renderSessionExercise(session);
  }

  function updateSessionElapsed(session: ActiveSession): void {
    const el = root.querySelector('#session-elapsed');
    if (!el || !session.startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
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
    const nextUp = root.querySelector('#rest-nextup');
    if (nextUp && state.activeSession) {
      const exercises = getSessionExercises(state.activeSession);
      const next = autoAdvance ? exercises[sessionExerciseIndex + 1] : null;
      nextUp.innerHTML = next ? `Next up: <b>${html(next.exerciseName || next.exerciseSlug)}</b>` : '';
    }
    updateSessionRestDisplay();
    window.clearInterval(sessionRestTimer);
    sessionRestTimer = window.setInterval(() => {
      sessionRestRemaining -= 1;
      updateSessionRestDisplay();
      if (sessionRestRemaining <= 0) {
        skipSessionRest();
        if (autoAdvance && state.activeSession) {
          const exercises = getSessionExercises(state.activeSession);
          if (sessionExerciseIndex < exercises.length - 1) { sessionExerciseIndex += 1; void renderSessionExercise(state.activeSession); }
        }
      }
    }, 1000);
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
    sessionRestRemaining = Math.max(5, sessionRestRemaining + delta);
    if (sessionRestTotal < sessionRestRemaining) sessionRestTotal = sessionRestRemaining;
    updateSessionRestDisplay();
  }

  function skipSessionRest(): void {
    window.clearInterval(sessionRestTimer);
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
  }

  async function finishActiveSession(): Promise<void> {
    if (!state.activeSession) return;
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
    if (!session.startedAt || !session.finishedAt) return '—';
    const sec = Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
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
    root.querySelector('#session-close')?.addEventListener('click', () => { void cancelActiveSession(); });
    root.querySelector('#rest-skip')?.addEventListener('click', skipSessionRest);
    root.querySelectorAll<HTMLElement>('[data-rest-adjust]').forEach((button) => button.addEventListener('click', () => adjustRest(Number(button.dataset.restAdjust) || 0)));
    root.querySelectorAll<HTMLElement>('[data-jump-ex]').forEach((button) => button.addEventListener('click', () => {
      if (!state.activeSession) return;
      sessionExerciseIndex = Number(button.dataset.jumpEx) || 0;
      void renderSessionExercise(state.activeSession);
    }));
    root.querySelectorAll<HTMLElement>('[data-session-log]').forEach((button) => button.addEventListener('click', () => {
      void logSessionSet(button.dataset.sessionLog || '', Number(button.dataset.setIndex) || 0, Number(button.dataset.rest) || 90);
    }));
    root.querySelectorAll<HTMLElement>('[data-add-session-set]').forEach((button) => button.addEventListener('click', () => {
      if (!state.activeSession) return;
      const slug = button.dataset.addSessionSet || '';
      sessionSetCounts[slug] = (sessionSetCounts[slug] || 0) + 1;
      void renderSessionExercise(state.activeSession);
    }));
    root.querySelector('#finish-session')?.addEventListener('click', () => { void finishActiveSession(); });
    root.querySelector('[data-toggle-instructions]')?.addEventListener('click', () => root.querySelector('#session-instructions')?.classList.toggle('open'));
  }

  return { startTrainingSession, openSessionOverlay, publishSessionSummary, bindSessionControls };
}
