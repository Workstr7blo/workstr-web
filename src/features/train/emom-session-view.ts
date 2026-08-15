import { html } from '../../app/format';
import type { ActiveSession } from '../../app/state';
import type { EmomBlock } from '../../core/types';
import { emomDurationSec, type EmomPosition, type EmomSlot } from './emom';
import type { EmomTimerPhase } from './session-logic';

export interface EmomSessionViewInput {
  root: HTMLElement;
  session: ActiveSession;
  blocks: EmomBlock[];
  schedule: EmomSlot[];
  position: EmomPosition;
  paused: boolean;
  timerPhase: EmomTimerPhase | null;
  expandedInstructions: Set<string>;
  roundNav(current: EmomSlot, complete: boolean): string;
  weightDisplay(weight: number | string | null | undefined): string;
  unitLabel(): string;
  onStart(): void;
  onLog(slot: EmomSlot, stepIndex: number, button: HTMLButtonElement): void;
  bindControls(): void;
}

export function updateEmomTimerView(root: HTMLElement, schedule: EmomSlot[], position: EmomPosition, timerPhase: EmomTimerPhase | null): void {
  const countdown = root.querySelector('#emom-countdown');
  if (countdown) countdown.textContent = String(timerPhase?.secondsRemaining ?? position.secondsRemaining);
  const intervalCountdown = root.querySelector('#emom-interval-countdown');
  if (intervalCountdown) intervalCountdown.textContent = String(position.secondsRemaining);
  const ring = root.querySelector<SVGCircleElement>('#emom-ring-fg');
  if (ring && position.slot) ring.style.strokeDashoffset = String(339.3 * (1 - position.secondsRemaining / position.slot.durationSec));
  const workRing = root.querySelector<SVGCircleElement>('#emom-work-ring-fg');
  if (workRing && timerPhase) workRing.style.strokeDashoffset = String(263.9 * (1 - timerPhase.secondsRemaining / timerPhase.durationSec));
  const progress = root.querySelector<HTMLElement>('#session-progress-fill');
  if (progress) {
    const completed = position.phase === 'complete' ? schedule.length : position.slot?.index || 0;
    progress.style.width = schedule.length ? `${Math.round((completed / schedule.length) * 100)}%` : '0%';
  }
}

export function renderEmomSessionView(input: EmomSessionViewInput): void {
  const { root, session, blocks, schedule, position, timerPhase } = input;
  const title = root.querySelector('#session-title');
  const meta = root.querySelector('#session-meta');
  const nav = root.querySelector('#session-ex-nav');
  const body = root.querySelector('#session-body');
  const footer = root.querySelector('#session-footer');
  if (!title || !meta || !nav || !body || !footer) return;
  nav.classList.add('emom-round-nav');
  footer.classList.remove('emom-live-controls');
  title.textContent = session.sheetName || 'EMOM';
  nav.innerHTML = '';
  if (position.phase === 'pending') {
    meta.textContent = blocks.length > 1 ? `EMOM · ${blocks.length} sections · ${Math.ceil(emomDurationSec(schedule) / 60)} min` : `EMOM · ${blocks[0].rounds} round${blocks[0].rounds === 1 ? '' : 's'} · ${schedule.length} interval${schedule.length === 1 ? '' : 's'}`;
    body.innerHTML = `<div class="emom-hero"><div class="emom-badge">EMOM</div><div class="emom-countdown" id="emom-countdown">${position.secondsRemaining}</div><div class="emom-caption">seconds per first interval</div><p>The clock starts when you are ready. Actual reps are logged separately from each timed target.</p></div>`;
    footer.innerHTML = '<button class="session-finish-btn" id="emom-start" type="button">Start EMOM</button>';
    root.querySelector('#emom-start')?.addEventListener('click', input.onStart);
    input.bindControls();
    return;
  }
  if (position.phase === 'complete' || !position.slot) {
    meta.textContent = 'EMOM complete';
    const lastSlot = schedule.at(-1);
    nav.innerHTML = lastSlot ? input.roundNav(lastSlot, true) : '';
    body.innerHTML = '<div class="emom-hero complete"><div class="emom-badge">Complete</div><div class="session-ex-name">EMOM finished</div><p>Review your logged work, then finish the session when you are ready.</p></div>';
    footer.innerHTML = '<button class="session-prev-btn" id="emom-prev" type="button">Previous</button><button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
    input.bindControls();
    return;
  }
  const slot = position.slot;
  const block = blocks[slot.blockIndex];
  meta.textContent = `${input.paused ? 'Paused · ' : ''}${blocks.length > 1 ? `Section ${slot.blockIndex + 1} of ${blocks.length} · ` : ''}Round ${slot.roundIndex + 1} of ${block.rounds} · Interval ${slot.intervalIndex + 1} of ${block.intervals.length}`;
  nav.innerHTML = input.roundNav(slot, false);
  const steps = slot.steps.map((step, stepIndex) => {
    const exercise = session.exercises.find((candidate) => candidate.exerciseSlug === step.exerciseSlug);
    const logged = session.sets.find((set) => set.blockIndex === slot.blockIndex && set.roundIndex === slot.roundIndex && set.intervalIndex === slot.intervalIndex && set.stepIndex === stepIndex);
    const hasUntimedSteps = slot.steps.some((candidate) => !Number(candidate.targetDurationSec));
    const active = position.activeStepIndex === stepIndex || (position.activeStepIndex == null && hasUntimedSteps);
    const target = [step.targetDurationSec ? `${step.targetDurationSec}s` : '', step.targetReps ? `${html(step.targetReps)} reps` : ''].filter(Boolean).join(' · ');
    const name = step.exerciseName || exercise?.exerciseName || step.exerciseSlug;
    const instructionKey = `${slot.blockIndex}:${slot.roundIndex}:${slot.intervalIndex}:${step.exerciseSlug}`;
    const instructions = exercise?.instructions || [];
    const instructionsMarkup = instructions.length ? `<div class="session-instructions ${input.expandedInstructions.has(instructionKey) ? 'open' : ''}" data-emom-instructions="${html(instructionKey)}">
      <button class="session-instructions-toggle" data-toggle-emom-instructions="${html(instructionKey)}" type="button" aria-expanded="${input.expandedInstructions.has(instructionKey)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><span>How to perform</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button><div class="session-instructions-body">${instructions.map((instruction, index) => `<div class="session-instructions-step"><b>${index + 1}</b>${html(instruction)}</div>`).join('')}</div>
    </div>` : '';
    return `<div class="emom-step emom-workout-card ${active ? 'active' : ''} ${logged ? 'done' : ''}" data-emom-step="${stepIndex}">
      ${exercise?.imageUrl ? `<img class="session-ex-image" src="${html(exercise.imageUrl)}" alt="${html(name)}">` : ''}
      <div class="session-ex-name">${html(name)}</div>
      <div class="session-ex-target"><b>${target || 'Open target'}</b><span class="dot"></span><span>Every ${slot.durationSec}s</span></div>
      <div class="emom-log-row"><input class="session-set-input" data-emom-reps type="number" inputmode="numeric" placeholder="actual reps" ${logged ? `value="${logged.reps ?? ''}" disabled` : ''}><input class="session-set-input" data-emom-weight type="number" inputmode="decimal" step="0.5" placeholder="${input.unitLabel()}" ${logged ? `value="${logged.weight == null ? '' : input.weightDisplay(logged.weight)}" disabled` : ''}><button class="session-log-btn ${logged ? 'done' : ''}" data-log-emom="${stepIndex}" type="button" ${logged ? 'disabled' : ''}>${logged ? 'Done' : 'Log'}</button></div>${instructionsMarkup}
    </div>`;
  }).join('');
  const nextSlot = schedule[slot.index + 1];
  const nextStep = nextSlot?.steps[0];
  body.innerHTML = `<div class="emom-live-layout"><div class="emom-timer-panel ${input.paused ? 'paused' : ''} ${timerPhase ? `has-work-timer ${timerPhase.mode}` : ''}">
    <div class="emom-badge">${input.paused ? 'Paused' : 'EMOM'}</div>
    <div class="rest-timer-wrap emom-timer-wrap"><svg class="rest-ring" viewBox="0 0 120 120"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="emom-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="339.3" stroke-dashoffset="${339.3 * (1 - position.secondsRemaining / slot.durationSec)}"/>${timerPhase ? `<circle class="emom-work-ring-bg" cx="60" cy="60" r="42" stroke-width="6"/><circle id="emom-work-ring-fg" class="emom-work-ring-fg" cx="60" cy="60" r="42" stroke-width="6" stroke-dasharray="263.9" stroke-dashoffset="${263.9 * (1 - timerPhase.secondsRemaining / timerPhase.durationSec)}"/>` : ''}</svg><div class="emom-countdown" id="emom-countdown">${timerPhase?.secondsRemaining ?? position.secondsRemaining}</div></div>
    <div class="emom-phase-label">${timerPhase ? timerPhase.mode === 'work' ? `Work · ${html(slot.steps[timerPhase.stepIndex ?? 0]?.exerciseName || slot.steps[timerPhase.stepIndex ?? 0]?.exerciseSlug || 'Exercise')}` : 'Recover' : 'Interval'}</div>
    <div class="emom-caption"><span id="emom-interval-countdown">${position.secondsRemaining}</span>s interval left · ${slot.index + 1} of ${schedule.length}</div></div>
    <div class="emom-steps">${steps}</div><div class="emom-next-card"><span>Next up</span><strong>${nextStep ? html(nextStep.exerciseName || nextStep.exerciseSlug) : 'Finish session'}</strong><small>${nextSlot ? `Round ${nextSlot.roundIndex + 1} · ${nextSlot.durationSec}s interval` : 'Workout complete'}</small></div></div>`;
  footer.classList.add('emom-live-controls');
  footer.innerHTML = `<button class="emom-pause-btn" id="emom-pause" type="button" aria-label="${input.paused ? 'Resume EMOM' : 'Pause EMOM'}" title="${input.paused ? 'Resume' : 'Pause'}">${input.paused ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'}</button><button class="emom-finish-action" id="finish-session" type="button">Finish early</button>`;
  root.querySelectorAll<HTMLButtonElement>('[data-log-emom]').forEach((button) => button.addEventListener('click', () => input.onLog(slot, Number(button.dataset.logEmom), button)));
  input.bindControls();
}
