import type { ActiveSession, AppState, SessionExercise, SessionSetLog } from '../../app/state';
import { html } from '../../app/format';
import { normalizeWeightUnit, storeWeightInput } from '../../core/units';
import { CountdownCueGuard, unlockCountdownAudio } from './countdown-audio';
import { RestTimer } from './rest-timer';
import { emomSlotCount, isEmomSession, sessionProgressPercent, sessionSetCounts, standardSessionExercises, standardWorkComplete, strengthProgressUnits, supersetTransition } from './session-logic';
import { renderStandardSessionView, updateStandardSessionProgress } from './standard-session-view';

export interface StandardSessionControllerContext {
  root: HTMLElement;
  state: AppState;
  cueGuard: CountdownCueGuard;
  weightDisplay(weight: number | string | null | undefined): string;
  weightFormat(weight: number | null | undefined): string;
  unitLabel(): string;
  bindSharedControls(): void;
}

export class StandardSessionController {
  private exerciseIndex = 0;
  private setCounts: Record<string, number> = {};
  private readonly previousSets = new Map<string, SessionSetLog[]>();
  private readonly rest: RestTimer;
  private restAdvanceIndex: number | null = null;

  constructor(private readonly ctx: StandardSessionControllerContext) {
    this.rest = new RestTimer(ctx.root, ctx.cueGuard, (autoAdvance) => {
      const session = ctx.state.activeSession;
      if (!autoAdvance || !session) return;
      const exercises = standardSessionExercises(session);
      const nextIndex = this.restAdvanceIndex ?? this.exerciseIndex + 1;
      this.restAdvanceIndex = null;
      if (nextIndex < 0 || nextIndex >= exercises.length) return;
      this.exerciseIndex = nextIndex;
      void this.render(session);
    });
  }

  start(session: ActiveSession): void {
    this.exerciseIndex = 0;
    this.setCounts = sessionSetCounts(session);
  }

  async open(session: ActiveSession): Promise<void> {
    if (!Object.keys(this.setCounts).length) this.setCounts = sessionSetCounts(session);
    const exercises = standardSessionExercises(session);
    this.exerciseIndex = Math.max(0, Math.min(this.exerciseIndex, Math.max(0, exercises.length - 1)));
    await this.render(session);
  }

  bindControls(): void {
    this.ctx.bindSharedControls();
    const restSkip = this.ctx.root.querySelector<HTMLButtonElement>('#rest-skip');
    if (restSkip) restSkip.onclick = () => this.rest.skip();
    this.ctx.root.querySelectorAll<HTMLElement>('[data-rest-adjust]').forEach((button) => { button.onclick = () => this.rest.adjust(Number(button.dataset.restAdjust) || 0); });
    this.ctx.root.querySelectorAll<HTMLElement>('[data-jump-ex]').forEach((button) => { button.onclick = () => {
      const session = this.ctx.state.activeSession;
      if (!session) return;
      const exercises = standardSessionExercises(session);
      this.exerciseIndex = Math.max(0, Math.min(Number(button.dataset.jumpEx) || 0, Math.max(0, exercises.length - 1)));
      void this.render(session);
    }; });
    this.ctx.root.querySelectorAll<HTMLElement>('[data-session-log]').forEach((button) => { button.onclick = () => {
      unlockCountdownAudio();
      void this.logSet(button.dataset.sessionLog || '', Number(button.dataset.setIndex) || 0, Number(button.dataset.rest) || 90);
    }; });
    this.ctx.root.querySelectorAll<HTMLElement>('[data-add-session-set]').forEach((button) => { button.onclick = () => {
      const session = this.ctx.state.activeSession;
      if (!session) return;
      const slug = button.dataset.addSessionSet || '';
      this.setCounts[slug] = (this.setCounts[slug] || 0) + 1;
      void this.render(session);
    }; });
    const instructions = this.ctx.root.querySelector<HTMLElement>('[data-toggle-instructions]');
    if (instructions) instructions.onclick = () => this.ctx.root.querySelector('#session-instructions')?.classList.toggle('open');
  }

  reconcileRest(): void { if (this.rest.active) this.rest.reconcile(); }

  stop(): void {
    this.rest.stop();
    this.exerciseIndex = 0;
    this.setCounts = {};
    this.previousSets.clear();
    this.restAdvanceIndex = null;
  }

  private loggedSetCount(session: ActiveSession, slug: string): number {
    return session.sets.filter((set) => set.exerciseSlug === slug && set.done).length;
  }

  // Offer the handoff on the last card, and anywhere once every prescribed strength set is in.
  private canStartEmom(session: ActiveSession, exercises: SessionExercise[]): boolean {
    if (!isEmomSession(session) || session.emomStartedAt) return false;
    return this.exerciseIndex >= exercises.length - 1 || standardWorkComplete(session);
  }

  // A pending EMOM section counts toward the bar, so finishing the strength half of a
  // mixed session leaves the workout visibly unfinished instead of showing 100%.
  private progress(session: ActiveSession): number {
    return sessionProgressPercent(strengthProgressUnits(session, this.setCounts), { done: 0, total: emomSlotCount(session) });
  }

  private async render(session: ActiveSession): Promise<void> {
    const exercises = standardSessionExercises(session);
    const exercise = exercises[this.exerciseIndex];
    if (!exercise) {
      renderStandardSessionView({
        root: this.ctx.root, session, exercises, exerciseIndex: this.exerciseIndex, setCounts: this.setCounts,
        previousSets: [], weightDisplay: this.ctx.weightDisplay,
        formatSetHint: (set) => this.formatSetHint(set),
        suggestedSetHint: (set, reps) => this.suggestedSetHint(set, reps),
        unitLabel: this.ctx.unitLabel,
        loggedSetCount: (slug) => this.loggedSetCount(session, slug), superset: null,
        bindControls: () => this.bindControls()
      });
      return;
    }
    const previousSets = await this.getPreviousSets(session.id, exercise.exerciseSlug);
    const activeExercises = this.ctx.state.activeSession ? standardSessionExercises(this.ctx.state.activeSession) : [];
    if (this.ctx.state.activeSession?.id !== session.id || activeExercises[this.exerciseIndex]?.exerciseSlug !== exercise.exerciseSlug) return;
    const logged = session.sets.filter((set) => set.exerciseSlug === exercise.exerciseSlug);
    const targetSets = Number(exercise.sets) || this.setCounts[exercise.exerciseSlug] || 1;
    this.setCounts[exercise.exerciseSlug] = Math.max(this.setCounts[exercise.exerciseSlug] || targetSets, logged.length || targetSets);
    renderStandardSessionView({
      root: this.ctx.root, session, exercises, exerciseIndex: this.exerciseIndex, setCounts: this.setCounts,
      previousSets, weightDisplay: this.ctx.weightDisplay,
      formatSetHint: (set) => this.formatSetHint(set),
      suggestedSetHint: (set, reps) => this.suggestedSetHint(set, reps),
      unitLabel: this.ctx.unitLabel,
      loggedSetCount: (slug) => this.loggedSetCount(session, slug),
      superset: supersetTransition(session, exercise.exerciseSlug, logged.length + 1),
      startEmom: this.canStartEmom(session, exercises),
      emomPending: isEmomSession(session) && !session.emomStartedAt,
      bindControls: () => this.bindControls()
    });
    updateStandardSessionProgress(this.ctx.root, session, this.progress(session));
  }

  private async logSet(slug: string, setIndex: number, restSeconds: number): Promise<void> {
    const session = this.ctx.state.activeSession;
    if (!session) return;
    const repsInput = this.ctx.root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex}"]`);
    const weightInput = this.ctx.root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex}"]`);
    const logButton = this.ctx.root.querySelector<HTMLButtonElement>(`[data-set-log-btn="${setIndex}"]`);
    const repsRaw = repsInput?.value ?? '';
    const weightRaw = weightInput?.value ?? '';
    if (repsRaw === '' && weightRaw === '') {
      repsInput?.focus();
      repsInput?.classList.add('shake');
      window.setTimeout(() => repsInput?.classList.remove('shake'), 420);
      return;
    }
    const reps = repsRaw === '' ? null : Number(repsRaw);
    const weight = weightRaw === '' ? null : storeWeightInput(weightRaw, normalizeWeightUnit(this.ctx.state.settings.unit));
    if (logButton) { logButton.disabled = true; logButton.textContent = '···'; }
    const exercises = standardSessionExercises(session);
    const exercise = exercises.find((candidate) => candidate.exerciseSlug === slug);
    const transition = supersetTransition(session, slug, setIndex + 1);
    const loggedSet: SessionSetLog = {
      exerciseSlug: slug, exerciseName: exercise?.exerciseName, setNumber: setIndex + 1,
      reps, weight, done: true, completedAt: new Date().toISOString(),
      blockIndex: transition?.blockIndex, roundIndex: transition?.roundIndex, stepIndex: transition?.stepIndex
    };
    await this.ctx.state.store?.addSessionSet({
      session_id: session.id, exercise_slug: slug, exercise_name: exercise?.exerciseName || slug,
      set_number: setIndex + 1, reps, weight_kg: weight, completed_at: loggedSet.completedAt,
      block_index: transition?.blockIndex, round_index: transition?.roundIndex, step_index: transition?.stepIndex
    });
    session.sets.push(loggedSet);
    if (repsInput) repsInput.disabled = true;
    if (weightInput) weightInput.disabled = true;
    this.ctx.root.querySelector(`[data-set-num="${setIndex}"]`)?.classList.add('done');
    this.ctx.root.querySelector(`[data-set-block="${setIndex}"]`)?.classList.add('just-logged');
    if (logButton) { logButton.textContent = 'Done'; logButton.classList.add('done'); logButton.disabled = true; logButton.removeAttribute('data-session-log'); }
    const nextBlock = this.ctx.root.querySelector(`[data-set-block="${setIndex + 1}"]`);
    if (nextBlock) {
      nextBlock.classList.remove('locked');
      nextBlock.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((element) => { element.disabled = false; });
      const nextReps = this.ctx.root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex + 1}"]`);
      const nextWeight = this.ctx.root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex + 1}"]`);
      if (nextReps && !nextReps.value && reps != null) nextReps.value = String(reps);
      if (nextWeight && !nextWeight.value && weightRaw !== '') nextWeight.value = weightRaw;
    }
    updateStandardSessionProgress(this.ctx.root, session, this.progress(session));
    if (transition?.nextExerciseSlug) {
      const nextIndex = exercises.findIndex((candidate) => candidate.exerciseSlug === transition.nextExerciseSlug);
      if (nextIndex >= 0 && !transition.roundComplete) {
        this.exerciseIndex = nextIndex;
        await this.render(session);
        return;
      }
      if (nextIndex >= 0) {
        this.restAdvanceIndex = nextIndex;
        const next = exercises[nextIndex];
        this.rest.start(transition.restAfterRoundSec, true, next.exerciseName || next.exerciseSlug);
        return;
      }
    }
    const allDone = this.loggedSetCount(session, slug) >= (this.setCounts[slug] || 1);
    const next = allDone ? exercises[this.exerciseIndex + 1] : null;
    this.rest.start(restSeconds, allDone, next?.exerciseName || next?.exerciseSlug || '');
  }

  private async getPreviousSets(sessionId: number, slug: string): Promise<SessionSetLog[]> {
    const key = `${sessionId}:${slug}`;
    if (!this.previousSets.has(key)) this.previousSets.set(key, []);
    return this.previousSets.get(key) || [];
  }

  private formatSetHint(set: SessionSetLog): string {
    return `${set.reps ?? '?'}${set.weight == null ? '' : ` @ ${this.ctx.weightFormat(set.weight)}`}`;
  }

  private suggestedSetHint(previous: SessionSetLog, targetReps: string): string {
    return `suggested: ${html(targetReps || String(previous.reps || 'reps'))} reps${previous.weight == null ? '' : ` @ ${this.ctx.weightFormat(previous.weight)}`}`;
  }
}
