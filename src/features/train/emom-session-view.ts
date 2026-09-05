import { html } from '../../app/format';
import type { ActiveSession, SessionExercise, SessionSetLog } from '../../app/state';
import type { EmomBlock, TrainingStep } from '../../core/types';
import { emomDurationSec, type EmomPosition, type EmomSlot } from './emom';
import { sessionProgressPercent, strengthProgressUnits, type EmomTimerPhase } from './session-logic';

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
  roundNav(current: EmomSlot, complete: boolean): string;
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
  return exercise?.imageUrl
    ? `<img class="session-ex-image wide" src="${html(exercise.imageUrl)}" alt="${html(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='No image'">`
    : '<div class="session-ex-image wide placeholder">No image</div>';
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
    <div class="emom-phase-label">${phase}</div>
    <div class="rest-timer-wrap emom-timer-wrap">
      <svg class="rest-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="emom-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="${INTERVAL_RING}" stroke-dashoffset="${INTERVAL_RING * (1 - position.secondsRemaining / slot.durationSec)}"/>${workRings}</svg>
      <div class="emom-countdown" id="emom-countdown" role="timer" aria-label="Seconds remaining">${timerPhase?.secondsRemaining ?? position.secondsRemaining}</div>
    </div>
    <div class="emom-status-meta">
      <span>${target} · every ${seconds(slot.durationSec)}</span>
      <span><b id="emom-interval-countdown">${position.secondsRemaining}</b><span class="unit">s</span> left · ${slot.index + 1}/${slotCount}</span>
    </div>
  </div>`;
}

function instructionsMarkup(key: string, instructions: string[], open: boolean): string {
  if (!instructions.length) return '';
  // The accordion's open state is owned by the controller: a shell re-render rebuilds the
  // overlay, and a class toggled in place does not survive it.
  return `<div class="session-instructions ${open ? 'open' : ''}" data-emom-instructions="${html(key)}">
    <button class="session-instructions-toggle" data-toggle-emom-instructions="${html(key)}" type="button" aria-expanded="${open}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><span>How to perform</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
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
    <span class="emom-log-title ${logged ? 'done' : ''}">${logged ? 'Logged' : 'Log this interval'}</span>
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
    <button class="session-log-btn emom-log-primary" data-log-emom="${input.stepIndex}" type="button" aria-label="Log interval">Log interval</button>${input.instructions}
  </section>`;
}

function nextUp(nextSlot: EmomSlot | undefined, nextStep: TrainingStep | undefined): string {
  return `<div class="emom-next-card">
    <span>Next up</span>
    <strong>${nextStep ? html(nextStep.exerciseName || nextStep.exerciseSlug) : 'Finish session'}</strong>
    <small>${nextSlot ? `Round ${nextSlot.roundIndex + 1} · ${nextSlot.durationSec}s interval` : 'Workout complete'}</small>
  </div>`;
}

// SECTION/ROUND/INTERVAL as fractions rather than "1 of 4" three times over: at a glance
// mid-effort the numbers are the content, and a single section names nothing.
function liveMeta(blocks: EmomBlock[], slot: EmomSlot, block: EmomBlock): string {
  return [
    'EMOM',
    blocks.length > 1 ? `Section ${slot.blockIndex + 1}/${blocks.length}` : '',
    `Round ${slot.roundIndex + 1}/${block.rounds}`,
    `Interval ${slot.intervalIndex + 1}/${block.intervals.length}`
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
    const rounds = blocks.reduce((total, block) => total + block.rounds, 0);
    const firstStep = schedule[0]?.steps[0];
    meta.textContent = `EMOM · ${rounds} round${rounds === 1 ? '' : 's'} · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}`;
    nav.innerHTML = '';
    body.innerHTML = `${firstStep ? heroMedia(findExercise(firstStep.exerciseSlug), stepName(firstStep, findExercise(firstStep.exerciseSlug))) : ''}
      <div class="emom-transition">
        <span class="emom-transition-label">EMOM next</span>
        <strong>${rounds} round${rounds === 1 ? '' : 's'} · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}</strong>
        <small>${Math.ceil(emomDurationSec(schedule) / 60)} min${firstStep ? ` · opens on ${html(stepName(firstStep, findExercise(firstStep.exerciseSlug)))}` : ''}</small>
        <p>${input.mixed ? 'Strength section done. ' : ''}The clock starts when you are ready. Actual reps are logged separately from each timed target.</p>
      </div>`;
    footer.innerHTML = '<button class="session-emom-btn" id="emom-start" type="button">Start EMOM</button>';
    root.querySelector('#emom-start')?.addEventListener('click', input.onStart);
    input.bindControls();
    return;
  }
  if (position.phase === 'complete' || !position.slot) {
    const rounds = blocks.reduce((total, block) => total + block.rounds, 0);
    const lastSlot = schedule.at(-1);
    meta.textContent = 'EMOM complete';
    nav.innerHTML = lastSlot ? input.roundNav(lastSlot, true) : '';
    body.innerHTML = `<div class="emom-transition complete">
      <span class="emom-transition-label">EMOM complete</span>
      <strong>${rounds} round${rounds === 1 ? '' : 's'} completed</strong>
      <small>${schedule.length} interval${schedule.length === 1 ? '' : 's'} · ${Math.ceil(emomDurationSec(schedule) / 60)} min</small>
      <p>Review your logged work, then finish the session.</p>
    </div>`;
    footer.innerHTML = '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
    input.bindControls();
    return;
  }
  const slot = position.slot;
  const block = blocks[slot.blockIndex];
  const activeStep = slot.steps[position.activeStepIndex ?? 0] || slot.steps[0];
  const activeExercise = findExercise(activeStep?.exerciseSlug);
  const activeName = activeStep ? stepName(activeStep, activeExercise) : 'EMOM';
  title.textContent = activeName;
  meta.textContent = liveMeta(blocks, slot, block);
  nav.innerHTML = input.roundNav(slot, false);
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
    return `<div class="emom-upcoming-step ${logged ? 'done' : ''}"><b>${html(stepName(step, findExercise(step.exerciseSlug)))}</b><span>${logged ? 'Logged' : html(stepTarget(step))}</span></div>`;
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
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Resume'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>Pause'}</button><button class="session-finish-early" id="finish-session" type="button">Finish early</button>`;
  root.querySelectorAll<HTMLButtonElement>('[data-log-emom]').forEach((button) => button.addEventListener('click', () => input.onLog(slot, Number(button.dataset.logEmom), button)));
  input.bindControls();
}
