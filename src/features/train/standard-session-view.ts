import { html } from '../../app/format';
import type { ActiveSession, SessionSetLog } from '../../app/state';
import type { SupersetTransition } from './session-logic';

export interface StandardSessionViewInput {
  root: HTMLElement;
  session: ActiveSession;
  exerciseIndex: number;
  setCounts: Record<string, number>;
  previousSets: SessionSetLog[];
  weightDisplay(weight: number | string | null | undefined): string;
  formatSetHint(set: SessionSetLog): string;
  suggestedSetHint(set: SessionSetLog, targetReps: string): string;
  unitLabel(): string;
  loggedSetCount(slug: string): number;
  superset: SupersetTransition | null;
  bindControls(): void;
}

export function updateStandardSessionProgress(root: HTMLElement, session: ActiveSession, percent: number): void {
  const fill = root.querySelector<HTMLElement>('#session-progress-fill');
  if (fill) fill.style.width = `${percent}%`;
}

export function renderStandardSessionView(input: StandardSessionViewInput): void {
  const { root, session, exerciseIndex, setCounts } = input;
  const exercises = session.exercises;
  const title = root.querySelector('#session-title');
  const meta = root.querySelector('#session-meta');
  const nav = root.querySelector('#session-ex-nav');
  const body = root.querySelector('#session-body');
  const footer = root.querySelector('#session-footer');
  if (!title || !meta || !nav || !body || !footer) return;
  footer.classList.remove('emom-live-controls');
  nav.classList.remove('emom-round-nav');
  if (!exercises.length) {
    title.textContent = session.sheetName || 'Freestyle';
    meta.textContent = 'No exercises yet';
    nav.innerHTML = '';
    body.innerHTML = '<div class="empty">This session has no exercises yet.</div>';
    footer.innerHTML = '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
    input.bindControls();
    return;
  }
  const exercise = exercises[exerciseIndex];
  const slug = exercise.exerciseSlug;
  const name = exercise.exerciseName || slug;
  const restSec = Number(exercise.restSec) || 90;
  const targetSets = Number(exercise.sets) || setCounts[slug] || 1;
  const targetReps = exercise.reps || '';
  const logged = session.sets.filter((set) => set.exerciseSlug === slug);
  nav.innerHTML = exercises.map((candidate, index) => {
    const target = Number(candidate.sets) || setCounts[candidate.exerciseSlug] || 1;
    const cls = index === exerciseIndex ? 'current' : input.loggedSetCount(candidate.exerciseSlug) >= target ? 'done' : '';
    return `<button class="session-ex-dot ${cls}" data-jump-ex="${index}" type="button">${index + 1}</button>`;
  }).join('');
  const rows = Array.from({ length: setCounts[slug] }, (_, index) => {
    const done = logged.find((set) => Number(set.setNumber) === index + 1);
    const previous = input.previousSets[index];
    const locked = !done && index > 0 && !logged.find((set) => Number(set.setNumber) === index);
    const previousHint = previous ? `<div class="session-set-hint prev">prev: ${html(input.formatSetHint(previous))}</div>` : '';
    const suggestedHint = previous ? `<div class="session-set-hint suggest">${input.suggestedSetHint(previous, targetReps)}</div>` : '';
    const defaultReps = String(done?.reps ?? (targetReps || previous?.reps || ''));
    const defaultWeight = done?.weight != null ? input.weightDisplay(done.weight) : (previous?.weight != null ? input.weightDisplay(previous.weight) : input.weightDisplay(exercise.weight));
    return `<div class="session-set-block ${locked ? 'locked' : ''}" data-set-block="${index}">
      <div class="session-set-row">
        <div class="session-set-num ${done ? 'done' : ''}" data-set-num="${index}">${index + 1}</div>
        <input class="session-set-input" data-session-reps="${index}" type="number" inputmode="numeric" placeholder="${html(targetReps || previous?.reps || 'reps')}" value="${html(defaultReps)}" ${done || locked ? 'disabled' : ''}>
        <input class="session-set-input" data-session-weight="${index}" type="number" inputmode="decimal" step="0.5" placeholder="${html(defaultWeight || input.unitLabel())}" value="${html(defaultWeight)}" ${done || locked ? 'disabled' : ''}>
        ${done ? `<button class="session-log-btn done" data-set-log-btn="${index}" disabled type="button">Done</button>` : `<button class="session-log-btn" data-session-log="${html(slug)}" data-set-index="${index}" data-set-log-btn="${index}" data-rest="${restSec}" ${locked ? 'disabled' : ''} type="button">Log</button>`}
      </div>${previousHint}${suggestedHint}
    </div>`;
  }).join('');
  const instructions = exercise.instructions || [];
  const instructionsMarkup = instructions.length ? `<div class="session-instructions" id="session-instructions">
    <div class="session-instructions-toggle" data-toggle-instructions>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>How to perform</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="session-instructions-body">${instructions.map((step, index) => `<div class="session-instructions-step"><b>${index + 1}</b>${html(step)}</div>`).join('')}</div>
  </div>` : '';
  title.textContent = session.sheetName || 'Freestyle';
  meta.textContent = input.superset
    ? `Superset · Round ${input.superset.roundIndex + 1} of ${input.superset.rounds} · Move ${input.superset.stepIndex + 1} of ${input.superset.stepCount}`
    : `Exercise ${exerciseIndex + 1} of ${exercises.length}`;
  body.innerHTML = `${exercise.imageUrl ? `<img class="session-ex-image" src="${html(exercise.imageUrl)}" alt="${html(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='No exercise image'">` : '<div class="session-ex-image placeholder">No exercise image</div>'}
    <div class="session-ex-name">${html(name)}</div>
    <div class="session-ex-target"><b>${targetSets}</b> sets <span class="dot"></span> <b>${html(targetReps || 'free')}</b> reps <span class="dot"></span> <b>${restSec}s</b> rest</div>
    <div class="session-sets">${rows}</div>
    <button class="session-add-set" data-add-session-set="${html(slug)}" type="button">+ Add set</button>${instructionsMarkup}`;
  const isLast = exerciseIndex >= exercises.length - 1;
  const nextLabel = input.superset && !input.superset.roundComplete ? 'Next move' : 'Next';
  footer.innerHTML = `${exerciseIndex > 0 ? `<button class="session-prev-btn" data-jump-ex="${exerciseIndex - 1}" type="button">Prev</button>` : ''}${isLast ? '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>' : `<button class="session-next-btn" data-jump-ex="${exerciseIndex + 1}" type="button">${nextLabel}</button>`}`;
  input.bindControls();
}
