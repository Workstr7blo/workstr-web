import { html } from '../../app/format';
import type { ActiveSession, SessionExercise, SessionSetLog } from '../../app/state';
import type { SupersetTransition } from './session-logic';

export interface StandardSessionViewInput {
  root: HTMLElement;
  session: ActiveSession;
  exercises: SessionExercise[];
  exerciseIndex: number;
  setCounts: Record<string, number>;
  previousSets: SessionSetLog[];
  weightDisplay(weight: number | string | null | undefined): string;
  formatSetHint(set: SessionSetLog): string;
  suggestedSetHint(set: SessionSetLog, targetReps: string): string;
  unitLabel(): string;
  loggedSetCount(slug: string): number;
  superset: SupersetTransition | null;
  startEmom?: boolean;
  emomPending?: boolean;
  bindControls(): void;
}

export function updateStandardSessionProgress(root: HTMLElement, session: ActiveSession, percent: number): void {
  const fill = root.querySelector<HTMLElement>('#session-progress-fill');
  if (fill) fill.style.width = `${percent}%`;
}

export function renderStandardSessionView(input: StandardSessionViewInput): void {
  const { root, session, exerciseIndex, setCounts } = input;
  const exercises = input.exercises;
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
  const repsInputValue = (reps: string | number | null | undefined): string => {
    if (reps == null) return '';
    const raw = String(reps);
    return /^\d+(\.\d+)?$/.test(raw) ? raw : raw.match(/\d+(?:\.\d+)?/)?.[0] || '';
  };
  const logged = session.sets.filter((set) => set.exerciseSlug === slug);
  nav.innerHTML = exercises.map((candidate, index) => {
    const target = Number(candidate.sets) || setCounts[candidate.exerciseSlug] || 1;
    const cls = index === exerciseIndex ? 'current' : input.loggedSetCount(candidate.exerciseSlug) >= target ? 'done' : '';
    return `<button class="session-ex-dot ${cls}" data-jump-ex="${index}" type="button">${index + 1}</button>`;
  }).join('');
  const activeSetIndex = Math.max(0, Array.from({ length: setCounts[slug] }, (_, index) => index).find((index) => !logged.find((set) => Number(set.setNumber) === index + 1)) ?? setCounts[slug] - 1);
  const allSetsDone = input.loggedSetCount(slug) >= setCounts[slug];
  const setPlan = Array.from({ length: setCounts[slug] }, (_, index) => {
    const done = logged.find((set) => Number(set.setNumber) === index + 1);
    const previous = input.previousSets[index];
    const defaultReps = done?.reps != null ? String(done.reps) : repsInputValue(targetReps || previous?.reps);
    const defaultWeight = done?.weight != null ? input.weightDisplay(done.weight) : (previous?.weight != null ? input.weightDisplay(previous.weight) : input.weightDisplay(exercise.weight));
    return { index, done, previous, defaultReps, defaultWeight };
  });
  const current = setPlan[activeSetIndex];
  const currentHints = current?.previous ? `<div class="session-current-hints"><span>Previous: ${html(input.formatSetHint(current.previous))}</span><span>${input.suggestedSetHint(current.previous, targetReps)}</span></div>` : '';
  const currentSet = current && !allSetsDone ? `<div class="session-current-set" data-set-block="${current.index}">
    <div class="session-current-head"><span>Log set ${current.index + 1} of ${setCounts[slug]}</span><strong>${html(targetReps || current.previous?.reps || 'Free')} reps</strong></div>
    <div class="session-current-inputs">
      <label><span>Reps to log</span><input class="session-set-input" data-session-reps="${current.index}" type="number" inputmode="numeric" placeholder="${html(targetReps || current.previous?.reps || 'reps')}" value="${html(current.defaultReps)}"></label>
      <label><span>${html(input.unitLabel())} load</span><input class="session-set-input" data-session-weight="${current.index}" type="number" inputmode="decimal" step="0.5" placeholder="${html(current.defaultWeight || input.unitLabel())}" value="${html(current.defaultWeight)}"></label>
    </div>${currentHints}
  </div>` : '<div class="session-current-set complete"><span>Exercise complete</span><strong>All sets logged</strong></div>';
  const rows = setPlan.map(({ index, done, previous, defaultReps, defaultWeight }) => {
    const state = done ? 'done' : index === activeSetIndex && !allSetsDone ? 'active' : 'upcoming';
    const summary = done ? `${done.reps ?? '—'} reps${done.weight == null ? '' : ` · ${input.weightDisplay(done.weight)} ${input.unitLabel()}`}` : `${targetReps || previous?.reps || 'free'} reps${defaultWeight ? ` · ${defaultWeight} ${input.unitLabel()}` : ''}`;
    return `<div class="session-set-block ${state}" data-set-block="${index}">
      <div class="session-set-row">
        <div class="session-set-num ${done ? 'done' : ''}" data-set-num="${index}">${index + 1}</div>
        <div class="session-set-summary"><strong>${state === 'active' ? 'Current set' : done ? 'Done' : 'Upcoming'}</strong><span>${html(summary)}</span></div>
        ${done ? `<span class="session-set-status done" data-set-log-btn="${index}">Done</span>` : ''}
      </div>
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
  title.textContent = name;
  // A mixed session names its section on every card, so reaching the last strength
  // exercise never reads as reaching the end of the workout.
  const sectionPrefix = input.emomPending ? 'Strength · ' : '';
  const sectionSuffix = input.emomPending ? ' · EMOM next' : '';
  meta.textContent = input.superset
    ? `${sectionPrefix}${session.sheetName || 'Workout'} · Round ${input.superset.roundIndex + 1} of ${input.superset.rounds} · Move ${input.superset.stepIndex + 1} of ${input.superset.stepCount}${sectionSuffix}`
    : `${session.sheetName || 'Workout'} · Exercise ${exerciseIndex + 1}/${exercises.length}${sectionSuffix}`;
  body.innerHTML = `<div class="session-focus-card">
      ${exercise.imageUrl ? `<img class="session-ex-image compact" src="${html(exercise.imageUrl)}" alt="${html(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='No image'">` : '<div class="session-ex-image compact placeholder">No image</div>'}
      <div class="session-focus-copy">
        <span class="sr-only">${html(name)}</span>
        <div class="session-focus-label">Target</div>
        <div class="session-ex-target"><b>${targetSets}</b> sets <span class="dot"></span> <b>${html(targetReps || 'free')}</b> reps <span class="dot"></span> <b>${restSec}s</b> rest</div>
      </div>
    </div>
    ${currentSet}
    <div class="session-set-plan"><div class="session-sets-label">Set plan</div><div class="session-sets">${rows}</div></div>
    <button class="session-add-set" data-add-session-set="${html(slug)}" type="button">+ Add set</button>${instructionsMarkup}`;
  const isLast = exerciseIndex >= exercises.length - 1;
  const nextLabel = input.superset && !input.superset.roundComplete ? 'Next move' : 'Next exercise';
  const prev = exerciseIndex > 0 ? `<button class="session-prev-btn" data-jump-ex="${exerciseIndex - 1}" type="button">Prev</button>` : '';
  const logCurrent = current && !allSetsDone ? `<button class="session-next-btn session-log-primary" data-session-log="${html(slug)}" data-set-index="${current.index}" data-set-log-btn="${current.index}" data-rest="${restSec}" type="button">Log set ${current.index + 1}</button>` : '';
  // The EMOM section is the next page of the same workout, so on the last strength card it
  // takes the advance slot outright. Offered early it is a shortcut, so it sits beside Next.
  const handoffEarly = input.startEmom && !(allSetsDone && isLast) ? '<button class="session-emom-btn" id="start-emom-section" type="button">Start EMOM</button>' : '';
  const advance = !allSetsDone
    ? logCurrent
    : input.startEmom && isLast
      ? '<button class="session-emom-btn" id="start-emom-section" type="button">Next: EMOM</button>'
      : isLast
        ? '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>'
        : `<button class="session-next-btn" data-jump-ex="${exerciseIndex + 1}" type="button">${nextLabel}</button>`;
  // Stopping here abandons the EMOM section, so it is the exception rather than a peer of
  // the handoff — same wording and weight as the EMOM half's own early exit.
  const finishEarly = input.emomPending && isLast ? '<button class="session-finish-early" id="finish-session" type="button">Finish early</button>' : '';
  footer.innerHTML = `${prev}${handoffEarly}${advance}${finishEarly}`;
  input.bindControls();
}
