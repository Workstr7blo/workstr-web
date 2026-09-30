import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
import type { ActiveSession, SessionExercise, SessionSetLog } from '../../app/state';
import type { EmomBlock, TrainingStep } from '../../core/types';
import { emomDurationSec, type EmomPosition, type EmomSlot } from './emom';
import { sessionProgressPercent, strengthProgressUnits, type EmomTimerPhase } from './session-logic';
import { sessionHeroMedia } from './session-hero';

export interface EmomSessionViewInput {
  root: HTMLElement;
  session: ActiveSession;
  blocks: EmomBlock[];
  schedule: EmomSlot[];
  position: EmomPosition;
  paused: boolean;
  timerPhase: EmomTimerPhase | null;
  mixed: boolean;
  expandedInstructions: Set<string>;
  minuteNav(current: EmomSlot, complete: boolean): string;
  weightDisplay(weight: number | string | null | undefined): string;
  unitLabel(): string;
  onStart(): void;
  onLog(slot: EmomSlot, stepIndex: number, button: HTMLButtonElement): void;
  bindControls(): void;
}

// Ring circumferences for r=54 and r=42 in the 120x120 viewBox. The per-second updater
// writes stroke-dashoffset against these, so the markup and updateEmomTimerView share them.
const INTERVAL_RING = 339.3;
const WORK_RING = 263.9;

export function updateEmomTimerView(root: HTMLElement, session: ActiveSession, schedule: EmomSlot[], position: EmomPosition, timerPhase: EmomTimerPhase | null): void {
  const countdown = root.querySelector('#emom-countdown');
  if (countdown) countdown.textContent = String(timerPhase?.secondsRemaining ?? position.secondsRemaining);
  const intervalCountdown = root.querySelector('#emom-interval-countdown');
  if (intervalCountdown) intervalCountdown.textContent = String(position.secondsRemaining);
  const ring = root.querySelector<SVGCircleElement>('#emom-ring-fg');
  if (ring && position.slot) ring.style.strokeDashoffset = String(INTERVAL_RING * (1 - position.secondsRemaining / position.slot.durationSec));
  const workRing = root.querySelector<SVGCircleElement>('#emom-work-ring-fg');
  if (workRing && timerPhase) workRing.style.strokeDashoffset = String(WORK_RING * (1 - timerPhase.secondsRemaining / timerPhase.durationSec));
  const progress = root.querySelector<HTMLElement>('#session-progress-fill');
  if (progress) {
    const completed = position.phase === 'complete' ? schedule.length : position.slot?.index || 0;
    // The strength half of a mixed session already earned its share of the bar, so the
    // EMOM half continues from there rather than restarting the workout at zero.
    const strength = strengthProgressUnits(session);
    progress.style.width = `${sessionProgressPercent(strength, { done: completed, total: schedule.length })}%`;
  }
}

function stepName(step: TrainingStep, exercise: SessionExercise | undefined): string {
  return step.exerciseName || exercise?.exerciseName || step.exerciseSlug;
}

function stepTarget(step: TrainingStep): string {
  return [step.targetDurationSec ? `${step.targetDurationSec}s` : '', step.targetReps ? `${step.targetReps} reps` : ''].filter(Boolean).join(' · ') || 'Open target';
}

// The same frame the standard runner uses, so switching training mode changes the middle of
// the screen and nothing around it. A missing image costs a strip rather than a screenful.
function heroMedia(exercise: SessionExercise | undefined, name: string): string {
  return sessionHeroMedia(exercise, name);
}

const PHASE_ICONS: Record<string, IconName> = { paused: 'pause', work: 'flame', recovery: 'heart-pulse', interval: 'timer' };

// The labelled-action pattern the standard footer uses; icons add no text to the name.
function action(name: IconName, label: string): string {
  return `${icon(name)}<span>${label}</span>`;
}

// The icon-tile card the other tabs open with, for the moments between intervals.
function transitionCard(name: IconName, label: string, headline: string, detail: string, body: string, complete = false): string {
  return `<div class="emom-transition${complete ? ' complete' : ''}">
    <div class="emom-transition-head">
      <span class="emom-transition-icon">${icon(name)}</span>
      <span class="emom-transition-copy"><span class="emom-transition-label">${label}</span><strong>${headline}</strong><small>${detail}</small></span>
    </div>
    <p>${body}</p>
  </div>`;
}

// Phase, clock and interval metadata as one band under the hero: the timer belongs to the
// exercise on screen rather than to a dashboard card of its own. Work and recovery differ by
// wording and by ring colour, never by colour alone.
function statusBand(slot: EmomSlot, position: EmomPosition, timerPhase: EmomTimerPhase | null, paused: boolean, activeStep: TrainingStep | undefined, slotCount: number): string {
  const mode = paused ? 'paused' : timerPhase?.mode || 'interval';
  const phase = paused ? 'Paused' : timerPhase?.mode === 'work' ? 'Work' : timerPhase?.mode === 'recovery' ? 'Recover' : 'Interval';
  // The seconds are units, not words, so they stay lowercase inside an uppercased line.
  const seconds = (value: number): string => `${value}<span class="unit">s</span>`;
  const target = activeStep?.targetDurationSec ? `${seconds(activeStep.targetDurationSec)} target`
    : activeStep?.targetReps ? `${html(activeStep.targetReps)} reps target`
      : 'Open target';
  const workRings = timerPhase
    ? `<circle class="emom-work-ring-bg" cx="60" cy="60" r="42" stroke-width="6"/><circle id="emom-work-ring-fg" class="emom-work-ring-fg" cx="60" cy="60" r="42" stroke-width="6" stroke-dasharray="${WORK_RING}" stroke-dashoffset="${WORK_RING * (1 - timerPhase.secondsRemaining / timerPhase.durationSec)}"/>`
    : '';
  return `<div class="emom-status ${mode}">
    <div class="emom-phase-label">${icon(PHASE_ICONS[mode])}<span>${phase}</span></div>
    <div class="rest-timer-wrap emom-timer-wrap">
      <svg class="rest-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="emom-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="${INTERVAL_RING}" stroke-dashoffset="${INTERVAL_RING * (1 - position.secondsRemaining / slot.durationSec)}"/>${workRings}</svg>
      <div class="emom-countdown" id="emom-countdown" role="timer" aria-label="Seconds remaining">${timerPhase?.secondsRemaining ?? position.secondsRemaining}</div>
    </div>
    <div class="emom-status-meta">
      <span>${icon('target')}${target} · every ${seconds(slot.durationSec)}</span>
      <span>${icon('clock')}<b id="emom-interval-countdown">${position.secondsRemaining}</b><span class="unit">s</span> left · ${slot.index + 1}/${slotCount}</span>
    </div>
  </div>`;
}

function instructionsMarkup(key: string, instructions: string[], open: boolean): string {
  if (!instructions.length) return '';
  // The accordion's open state is owned by the controller: advancing a round or logging an
  // interval re-renders this body, and a class toggled in place does not survive it.
  return `<div class="session-instructions ${open ? 'open' : ''}" data-emom-instructions="${html(key)}">
    <button class="session-instructions-toggle" data-toggle-emom-instructions="${html(key)}" type="button" aria-expanded="${open}">
      ${icon('info')}<span>How to perform</span>
      ${icon('chevron-down', { class: 'chev' })}
    </button><div class="session-instructions-body">${instructions.map((instruction, index) => `<div class="session-instructions-step"><b>${index + 1}</b>${html(instruction)}</div>`).join('')}</div>
  </div>`;
}

interface LogPanelInput {
  step: TrainingStep;
  stepIndex: number;
  name: string;
  logged: SessionSetLog | undefined;
  instructions: string;
  unit: string;
  weightDisplay(weight: number | string | null | undefined): string;
  showStep: boolean;
}

// The EMOM answer to the standard runner's active set row: the one lit surface on the
// screen, its fields side by side and its primary action full width under them.
function logPanel(input: LogPanelInput): string {
  const { logged } = input;
  const head = `<div class="emom-log-head">
    <span class="emom-log-title ${logged ? 'done' : ''}">${icon(logged ? 'circle-check' : 'pencil')}${logged ? 'Logged' : 'Log this interval'}</span>
    ${input.showStep ? `<span class="emom-log-step">${html(input.name)} · ${html(stepTarget(input.step))}</span>` : ''}
  </div>`;
  if (logged) {
    const rows = [
      logged.reps == null ? '' : `<div class="emom-log-done-row"><span>Actual reps</span><b>${logged.reps}</b></div>`,
      logged.weight == null ? '' : `<div class="emom-log-done-row"><span>Load</span><b>${html(input.weightDisplay(logged.weight))} ${html(input.unit)}</b></div>`,
      logged.durationSec ? `<div class="emom-log-done-row"><span>Held</span><b>${logged.durationSec}s</b></div>` : ''
    ].filter(Boolean).join('');
    return `<section class="emom-log done" data-emom-step="${input.stepIndex}">${head}<div class="emom-log-done">${rows || '<div class="emom-log-done-row"><span>Interval</span><b>Done</b></div>'}</div>${input.instructions}</section>`;
  }
  return `<section class="emom-log" data-emom-step="${input.stepIndex}">${head}
    <div class="emom-log-fields">
      <label class="emom-log-field"><span>Actual reps</span><input class="session-set-input" data-emom-reps type="number" inputmode="numeric" placeholder="reps"></label>
      <label class="emom-log-field"><span>Load ${html(input.unit)}</span><input class="session-set-input" data-emom-weight type="number" inputmode="decimal" step="0.5" placeholder="${html(input.unit)}"></label>
    </div>
    <button class="session-log-btn emom-log-primary" data-log-emom="${input.stepIndex}" type="button" aria-label="Log interval">${action('check', 'Log interval')}</button>${input.instructions}
  </section>`;
}

function nextUp(nextSlot: EmomSlot | undefined, nextStep: TrainingStep | undefined): string {
  return `<div class="emom-next-card">
    <span class="emom-next-icon">${icon(nextStep ? 'arrow-right' : 'flag')}</span>
    <span class="emom-next-copy">
      <span>Next up</span>
      <strong>${nextStep ? html(nextStep.exerciseName || nextStep.exerciseSlug) : 'Finish session'}</strong>
      <small>${nextSlot ? `Minute ${nextSlot.minuteIndex + 1} · ${nextSlot.durationSec}s interval` : 'Workout complete'}</small>
    </span>
  </div>`;
}

// SECTION/MINUTE as fractions rather than "1 of 4" twice over: at a glance mid-effort the numbers
// are the content, and a single section names nothing. The minute counts within its own section.
function liveMeta(blocks: EmomBlock[], slot: EmomSlot): string {
  return [
    'EMOM',
    blocks.length > 1 ? `Section ${slot.blockIndex + 1}/${blocks.length}` : '',
    `Minute ${slot.minuteIndex + 1}/${slot.minuteCount}`
  ].filter(Boolean).join(' · ');
}

export function renderEmomSessionView(input: EmomSessionViewInput): void {
  const { root, session, blocks, schedule, position, timerPhase } = input;
  const title = root.querySelector('#session-title');
  const meta = root.querySelector('#session-meta');
  const nav = root.querySelector('#session-ex-nav');
  const body = root.querySelector('#session-body');
  const footer = root.querySelector('#session-footer');
  if (!title || !meta || !nav || !body || !footer) return;
  nav.classList.add('session-ex-track', 'emom-round-track');
  title.textContent = session.sheetName || 'EMOM';
  const findExercise = (slug: string | undefined): SessionExercise | undefined =>
    session.exercises.find((candidate) => candidate.exerciseSlug === slug);
  if (position.phase === 'pending') {
    const minutes = Math.ceil(emomDurationSec(schedule) / 60);
    const firstStep = schedule[0]?.steps[0];
    meta.textContent = `EMOM · ${minutes} min · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}`;
    nav.innerHTML = '';
    body.innerHTML = `${firstStep ? heroMedia(findExercise(firstStep.exerciseSlug), stepName(firstStep, findExercise(firstStep.exerciseSlug))) : ''}
      ${transitionCard('timer', 'EMOM next', `${minutes} min · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}`,
        firstStep ? `Opens on ${html(stepName(firstStep, findExercise(firstStep.exerciseSlug)))}` : 'Ready when you are',
        `${input.mixed ? 'Strength section done. ' : ''}The clock starts when you are ready. Actual reps are logged separately from each timed target.`)}`;
    footer.innerHTML = `<button class="session-emom-btn" id="emom-start" type="button">${action('play', 'Start EMOM')}</button>`;
    root.querySelector('#emom-start')?.addEventListener('click', input.onStart);
    input.bindControls();
    return;
  }
  if (position.phase === 'complete' || !position.slot) {
    const lastSlot = schedule.at(-1);
    meta.textContent = 'EMOM complete';
    nav.innerHTML = lastSlot ? input.minuteNav(lastSlot, true) : '';
    body.innerHTML = transitionCard('award', 'EMOM complete', `${Math.ceil(emomDurationSec(schedule) / 60)} min completed`,
      `${schedule.length} interval${schedule.length === 1 ? '' : 's'}`, 'Review your logged work, then finish the session.', true);
    footer.innerHTML = `<button class="session-finish-btn" id="finish-session" type="button">${action('flag', 'Finish session')}</button>`;
    input.bindControls();
    return;
  }
  const slot = position.slot;
  const activeStep = slot.steps[position.activeStepIndex ?? 0] || slot.steps[0];
  const activeExercise = findExercise(activeStep?.exerciseSlug);
  const activeName = activeStep ? stepName(activeStep, activeExercise) : 'EMOM';
  title.textContent = activeName;
  meta.textContent = liveMeta(blocks, slot);
  nav.innerHTML = input.minuteNav(slot, false);
  // A timed interval promotes one movement at a time. With no movement under the clock -
  // a rep-based interval, or the recovery that follows the timed work - every movement in
  // the interval is loggable, so nothing worked through can become unloggable.
  const loggable = slot.steps.map((_, stepIndex) => position.activeStepIndex === stepIndex || position.activeStepIndex == null);
  const panels = slot.steps.map((step, stepIndex) => {
    if (!loggable[stepIndex]) return '';
    const exercise = findExercise(step.exerciseSlug);
    const logged = session.sets.find((set) => set.blockIndex === slot.blockIndex && set.roundIndex === slot.roundIndex && set.intervalIndex === slot.intervalIndex && set.stepIndex === stepIndex);
    const key = `${slot.blockIndex}:${slot.roundIndex}:${slot.intervalIndex}:${step.exerciseSlug}`;
    return logPanel({
      step, stepIndex, logged, name: stepName(step, exercise),
      instructions: instructionsMarkup(key, exercise?.instructions || [], input.expandedInstructions.has(key)),
      unit: input.unitLabel(), weightDisplay: input.weightDisplay,
      showStep: slot.steps.length > 1
    });
  }).join('');
  const upcoming = slot.steps.map((step, stepIndex) => {
    if (loggable[stepIndex]) return '';
    const logged = session.sets.find((set) => set.blockIndex === slot.blockIndex && set.roundIndex === slot.roundIndex && set.intervalIndex === slot.intervalIndex && set.stepIndex === stepIndex);
    return `<div class="emom-upcoming-step ${logged ? 'done' : ''}"><b>${icon(logged ? 'circle-check' : 'clock')}${html(stepName(step, findExercise(step.exerciseSlug)))}</b><span>${logged ? 'Logged' : html(stepTarget(step))}</span></div>`;
  }).join('');
  const nextSlot = schedule[slot.index + 1];
  body.innerHTML = `<div class="emom-live-layout ${input.paused ? 'paused' : ''}">
    <h2 class="sr-only">${html(activeName)}</h2>
    ${heroMedia(activeExercise, activeName)}
    ${statusBand(slot, position, timerPhase, input.paused, activeStep, schedule.length)}
    ${panels}${upcoming ? `<div class="emom-upcoming">${upcoming}</div>` : ''}
    ${nextUp(nextSlot, nextSlot?.steps[0])}
  </div>`;
  footer.innerHTML = `<button class="session-pause-btn" id="emom-pause" type="button" aria-label="${input.paused ? 'Resume EMOM' : 'Pause EMOM'}">${input.paused
    ? `${icon('play', { filled: true })}Resume`
    : `${icon('pause', { filled: true })}Pause`}</button><button class="session-finish-early" id="finish-session" type="button">${action('flag', 'Finish early')}</button>`;
  root.querySelectorAll<HTMLButtonElement>('[data-log-emom]').forEach((button) => button.addEventListener('click', () => input.onLog(slot, Number(button.dataset.logEmom), button)));
  input.bindControls();
}
