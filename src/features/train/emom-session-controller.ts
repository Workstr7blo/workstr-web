import type { AppState, ActiveSession, SessionSetLog } from '../../app/state';
import { normalizeWeightUnit, storeWeightInput } from '../../core/units';
import type { EmomBlock } from '../../core/types';
import type { EmomTimerPhase } from './session-logic';
import { CountdownCueGuard, playCountdownCue, unlockCountdownAudio, type CountdownCue } from './countdown-audio';
import { compileEmomBlocks, emomDurationSec, emomPosition, type EmomPosition, type EmomSlot } from './emom';
import { emomClockSnapshot, pauseEmomClock, resumeEmomClock, seekEmomClock } from './emom-clock';
import { renderEmomSessionView, updateEmomTimerView } from './emom-session-view';
import { activeEmomBlocks, emomCountdownTarget, emomTimerPhase, isMixedSession, readEmomClock, writeEmomClock } from './session-logic';

export interface EmomSessionControllerContext {
  root: HTMLElement;
  state: AppState;
  cueGuard: CountdownCueGuard;
  updateElapsed(session: ActiveSession, now?: number): void;
  weightDisplay(weight: number | string | null | undefined): string;
  unitLabel(): string;
  bindSharedControls(): void;
}

// How many rounds the track shows at once before it pages.
const ROUND_WINDOW = 5;

export class EmomSessionController {
  private timer = 0;
  private renderKey = '';
  private completionHandled = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private roundWindowStart = 0;
  private roundWindowBlock = -1;
  private roundWindowManual = false;
  private roundWindowSlot = -1;
  private readonly expandedInstructions = new Set<string>();
  private previousPhase: EmomPosition['phase'] | null = null;
  private previousSlotIndex: number | null = null;

  constructor(private readonly ctx: EmomSessionControllerContext) {}

  get active(): boolean { return activeEmomBlocks(this.ctx.state.activeSession).length > 0; }

  open(session: ActiveSession): void {
    this.stopTimer();
    this.resetRenderState();
    if (!session.emomStartedAt) {
      this.ctx.updateElapsed(session);
      this.reconcile();
    } else if (readEmomClock(session).runningSinceMs != null) {
      this.startTimer();
    } else {
      this.reconcileClocks();
    }
  }

  reconcileClocks(now = Date.now()): void {
    const session = this.ctx.state.activeSession;
    if (!session) return;
    this.ctx.updateElapsed(session, now);
    this.reconcile(now);
  }

  async pauseForFinish(session: ActiveSession): Promise<void> {
    if (!session.emomStartedAt) return;
    writeEmomClock(session, pauseEmomClock(readEmomClock(session)));
    this.persist(session);
    await this.persistQueue;
  }

  stop(): void {
    this.stopTimer();
    this.resetRenderState();
  }

  bindControls(): void {
    this.ctx.bindSharedControls();
    this.ctx.root.querySelectorAll<HTMLElement>('[data-emom-seek]').forEach((button) => { button.onclick = () => this.seek(Number(button.dataset.emomSeek) || 0); });
    this.ctx.root.querySelectorAll<HTMLElement>('[data-emom-window]').forEach((button) => { button.onclick = () => this.shiftRoundWindow(Number(button.dataset.emomWindow) < 0 ? -1 : 1); });
    const pause = this.ctx.root.querySelector<HTMLButtonElement>('#emom-pause');
    if (pause) pause.onclick = () => this.togglePause();
    this.ctx.root.querySelectorAll<HTMLButtonElement>('[data-toggle-emom-instructions]').forEach((button) => { button.onclick = () => {
      const key = button.dataset.toggleEmomInstructions || '';
      const panel = button.closest<HTMLElement>('[data-emom-instructions]');
      const open = !panel?.classList.contains('open');
      panel?.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
      if (open) this.expandedInstructions.add(key); else this.expandedInstructions.delete(key);
    }; });
  }

  private reconcile(now = Date.now()): void {
    const session = this.ctx.state.activeSession;
    const blocks = activeEmomBlocks(session);
    if (!session || !blocks.length) return;
    const schedule = compileEmomBlocks(blocks);
    const clock = emomClockSnapshot(readEmomClock(session), now);
    const position = session.emomStartedAt ? emomPosition(schedule, now - clock.positionSec * 1000, now) : emomPosition(schedule, null, now);
    this.trackSlot(position.slot?.index ?? -1);
    if (position.phase === 'complete' && clock.running && !this.completionHandled) {
      this.completionHandled = true;
      writeEmomClock(session, { positionSec: emomDurationSec(schedule), activeSec: clock.activeSec, runningSinceMs: null });
      this.persist(session);
      this.stopTimer();
    }
    const timerPhase = position.slot ? emomTimerPhase(position.slot, position.elapsedInSlotSec) : null;
    this.cues(position, timerPhase).forEach(playCountdownCue);
    updateEmomTimerView(this.ctx.root, session, schedule, position, timerPhase);
    if (!this.shouldRender(position)) return;
    renderEmomSessionView({
      root: this.ctx.root, session, blocks, schedule, position, timerPhase,
      paused: readEmomClock(session).runningSinceMs == null,
      mixed: isMixedSession(session),
      expandedInstructions: this.expandedInstructions,
      roundNav: (slot, complete) => this.roundNav(schedule, slot, complete),
      weightDisplay: this.ctx.weightDisplay,
      unitLabel: this.ctx.unitLabel,
      onStart: () => { unlockCountdownAudio(); void this.start(); },
      onLog: (slot, stepIndex, button) => { void this.logStep(slot, stepIndex, button); },
      bindControls: () => this.bindControls()
    });
  }

  private async start(): Promise<void> {
    const session = this.ctx.state.activeSession;
    if (!session || !activeEmomBlocks(session).length) return;
    const startedAt = new Date().toISOString();
    // A mixed session already ran its strength half, so keep the original startedAt.
    const keepStartedAt = isMixedSession(session);
    session.emomStartedAt = startedAt;
    if (!keepStartedAt) session.startedAt = startedAt;
    session.emomPositionSec = 0;
    session.emomActiveSec = 0;
    session.emomRunningSince = startedAt;
    this.persistQueue = this.ctx.state.store?.startSessionEmom(session.id, startedAt, keepStartedAt) || Promise.resolve();
    this.resetRenderState();
    this.startTimer();
    await this.persistQueue;
  }

  private togglePause(): void {
    const session = this.ctx.state.activeSession;
    if (!session?.emomStartedAt) return;
    const now = Date.now();
    const current = readEmomClock(session);
    const next = current.runningSinceMs == null ? resumeEmomClock(current, now) : pauseEmomClock(current, now);
    writeEmomClock(session, next);
    this.persist(session);
    this.invalidate();
    if (next.runningSinceMs == null) {
      this.stopTimer();
      this.reconcileClocks(now);
    } else this.startTimer();
  }

  private seek(positionSec: number): void {
    const session = this.ctx.state.activeSession;
    if (!session?.emomStartedAt) return;
    const now = Date.now();
    writeEmomClock(session, seekEmomClock(readEmomClock(session), positionSec, now));
    this.persist(session);
    this.resetRenderState();
    this.reconcileClocks(now);
  }

  private shiftRoundWindow(direction: -1 | 1): void {
    this.roundWindowManual = true;
    this.roundWindowStart += direction * ROUND_WINDOW;
    this.invalidate();
    this.reconcileClocks();
  }

  private async logStep(slot: EmomSlot, stepIndex: number, button: HTMLButtonElement): Promise<void> {
    const session = this.ctx.state.activeSession;
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
    const weight = weightRaw ? storeWeightInput(weightRaw, normalizeWeightUnit(this.ctx.state.settings.unit)) : null;
    const completedAt = new Date().toISOString();
    const setNumber = session.sets.filter((set) => set.exerciseSlug === step.exerciseSlug).length + 1;
    const loggedSet: SessionSetLog = {
      exerciseSlug: step.exerciseSlug, exerciseName: step.exerciseName || exercise?.exerciseName,
      setNumber, reps, weight, durationSec: step.targetDurationSec,
      blockIndex: slot.blockIndex, roundIndex: slot.roundIndex, intervalIndex: slot.intervalIndex,
      stepIndex, done: true, completedAt
    };
    await this.ctx.state.store?.addSessionSet({
      session_id: session.id, exercise_slug: step.exerciseSlug,
      exercise_name: loggedSet.exerciseName || step.exerciseSlug, set_number: setNumber,
      reps, weight_kg: weight, duration_sec: step.targetDurationSec,
      block_index: slot.blockIndex, round_index: slot.roundIndex,
      interval_index: slot.intervalIndex, step_index: stepIndex, completed_at: completedAt
    });
    session.sets.push(loggedSet);
    this.invalidate();
    this.reconcile();
  }

  private persist(session: ActiveSession): void {
    const id = session.id;
    const positionSec = Number(session.emomPositionSec) || 0;
    const activeSec = Number(session.emomActiveSec) || 0;
    const runningSince = session.emomRunningSince;
    this.persistQueue = this.persistQueue.then(async () => {
      await this.ctx.state.store?.updateSessionEmomClock?.(id, positionSec, activeSec, runningSince);
    });
  }

  private startTimer(): void {
    this.stopTimer();
    this.reconcileClocks();
    this.timer = window.setInterval(() => this.reconcileClocks(), 1000);
  }

  private stopTimer(): void { window.clearInterval(this.timer); }
  private invalidate(): void { this.renderKey = ''; }

  private resetRenderState(): void {
    this.invalidate();
    this.previousPhase = null;
    this.previousSlotIndex = null;
    this.completionHandled = false;
    this.roundWindowStart = 0;
    this.roundWindowBlock = -1;
    this.roundWindowManual = false;
    this.roundWindowSlot = -1;
  }

  private shouldRender(position: EmomPosition): boolean {
    const key = `${position.phase}:${position.slot?.index ?? -1}:${position.activeStepIndex ?? -1}`;
    if (key === this.renderKey) return false;
    this.renderKey = key;
    return true;
  }

  private trackSlot(slotIndex: number): void {
    if (slotIndex === this.roundWindowSlot) return;
    this.roundWindowSlot = slotIndex;
    this.roundWindowManual = false;
  }

  private cues(position: EmomPosition, timerPhase: EmomTimerPhase | null): CountdownCue[] {
    const cues: CountdownCue[] = [];
    const slotIndex = position.slot?.index ?? null;
    if (this.previousPhase === 'running' && this.previousSlotIndex !== null && (position.phase === 'complete' || slotIndex !== this.previousSlotIndex)) {
      const cue = this.ctx.cueGuard.finish('emom', this.previousSlotIndex);
      if (cue) cues.push(cue);
    }
    const target = emomCountdownTarget(position, timerPhase);
    if (target) {
      const cue = this.ctx.cueGuard.countdown(target.channel, target.period, target.secondsRemaining);
      if (cue) cues.push(cue);
    }
    this.previousPhase = position.phase;
    this.previousSlotIndex = slotIndex;
    return cues;
  }

  // Rounds on the standard session's exercise track: same pip, connector, green done and lit
  // current, seeking a round instead of jumping an exercise. A long EMOM pages five rounds at
  // a time rather than shrinking twenty pips into an unreadable row.
  private roundNav(schedule: EmomSlot[], current: EmomSlot, complete: boolean): string {
    const rounds = schedule.filter((candidate, index) => candidate.blockIndex === current.blockIndex
      && schedule.findIndex((slot) => slot.blockIndex === candidate.blockIndex && slot.roundIndex === candidate.roundIndex) === index);
    const maxStart = Math.max(0, rounds.length - ROUND_WINDOW);
    if (this.roundWindowBlock !== current.blockIndex) { this.roundWindowBlock = current.blockIndex; this.roundWindowManual = false; }
    if (!this.roundWindowManual) this.roundWindowStart = Math.max(0, Math.min(maxStart, current.roundIndex - 2));
    this.roundWindowStart = Math.max(0, Math.min(maxStart, this.roundWindowStart));
    const pips = rounds.slice(this.roundWindowStart, this.roundWindowStart + ROUND_WINDOW).map((candidate) => {
      const isCurrent = !complete && candidate.roundIndex === current.roundIndex;
      const cls = isCurrent ? 'current' : complete || candidate.roundIndex < current.roundIndex ? 'done' : '';
      const state = isCurrent ? ', current' : cls === 'done' ? ', done' : '';
      return `<button class="session-ex-dot ${cls}" data-emom-seek="${candidate.startsAtSec}" type="button" aria-label="Go to round ${candidate.roundIndex + 1} of ${rounds.length}${state}"${isCurrent ? ' aria-current="step"' : ''}><span class="session-ex-pip">${candidate.roundIndex + 1}</span></button>`;
    }).join('');
    if (rounds.length <= ROUND_WINDOW) return pips;
    return `<button class="session-track-arrow" data-emom-window="-1" type="button" aria-label="Show previous rounds" ${this.roundWindowStart === 0 ? 'disabled' : ''}>&lsaquo;</button>${pips}<button class="session-track-arrow" data-emom-window="1" type="button" aria-label="Show next rounds" ${this.roundWindowStart >= maxStart ? 'disabled' : ''}>&rsaquo;</button>`;
  }
}
