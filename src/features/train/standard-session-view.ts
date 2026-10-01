import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
import type { ActiveSession, SessionExercise, SessionSetLog } from '../../app/state';
import type { SupersetTransition } from './session-logic';
import { sessionHeroMedia } from './session-hero';

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
  instructionsOpen: boolean;
  startEmom?: boolean;
  emomPending?: boolean;
  bindControls(): void;
}

interface SetPlanEntry {
  index: number;
  done?: SessionSetLog;
  previous?: SessionSetLog;
  carried?: SessionSetLog;
  defaultReps: string;
  defaultWeight: string;
}

// One sheet of columns shared by every row state, so the eye reads down a column instead of
// across three different card shapes.
interface SetSheet {
  setCount: number;
  targetReps: string;
  weightDisplay(weight: number | string | null | undefined): string;
  formatSetHint(set: SessionSetLog): string;
  suggestedSetHint(set: SessionSetLog, targetReps: string): string;
}

export function updateStandardSessionProgress(root: HTMLElement, session: ActiveSession, percent: number): void {
  const fill = root.querySelector<HTMLElement>('#session-progress-fill');
  if (fill) fill.style.width = `${percent}%`;
}

// The icon sits above the word so the narrow state column keeps its width on a phone.
function setState(name: IconName, label: string, cls = '', attrs = ''): string {
  return `<span class="session-set-state${cls ? ` ${cls}` : ''}"${attrs}>${icon(name)}${label}</span>`;
}

function targetTile(name: IconName, value: string, label: string): string {
  return `<div class="session-target-tile"><span class="session-target-icon">${icon(name)}</span><span class="session-target-copy"><b>${value}</b><small>${label}</small></span></div>`;
}

// Footer actions carry an icon beside their label, the same labelled-action pattern as the
// program cards. Icons add no text, so a button's name is still exactly its label.
function action(name: IconName, label: string, after = false): string {
  return after ? `<span>${label}</span>${icon(name)}` : `${icon(name)}<span>${label}</span>`;
}

function isTimedTarget(target: string): boolean {
  return /\b\d+\s*(?:-\s*\d+\s*)?(?:s|sec|secs|second|seconds)\b/i.test(target);
}

function repsInputValue(reps: string | number | null | undefined): string {
  if (reps == null) return '';
  const raw = String(reps);
  return /^\d+(\.\d+)?$/.test(raw) ? raw : raw.match(/\d+(?:\.\d+)?/)?.[0] || '';
}

function doneSetRow(entry: SetPlanEntry, sheet: SetSheet): string {
  const done = entry.done as SessionSetLog;
  const weight = done.weight == null ? '' : sheet.weightDisplay(done.weight);
  return `<div class="session-set-block done" data-set-block="${entry.index}" role="listitem" aria-label="Set ${entry.index + 1}, done">
    <div class="session-set-row">
      <div class="session-set-num done" data-set-num="${entry.index}">${entry.index + 1}</div>
      <div class="session-set-value logged">${done.reps ?? '—'}</div>
      <div class="session-set-value logged">${html(weight || '—')}</div>
      ${setState('circle-check', 'Done', 'done', ` data-set-log-btn="${entry.index}"`)}
    </div>
  </div>`;
}

function activeSetRow(entry: SetPlanEntry, sheet: SetSheet, unit: string): string {
  const hintSet = entry.previous || entry.carried;
  const hints = hintSet
    ? `<div class="session-current-hints"><span>${icon('repeat')}Previous ${html(sheet.formatSetHint(hintSet))}</span><span>${icon('sparkles')}${sheet.suggestedSetHint(hintSet, sheet.targetReps)}</span></div>`
    : '';
  const repsPlaceholder = sheet.targetReps || String(hintSet?.reps ?? '');
  return `<div class="session-set-block active" data-set-block="${entry.index}" role="listitem" aria-label="Set ${entry.index + 1} of ${sheet.setCount}, current">
    <div class="session-set-row">
      <div class="session-set-num" data-set-num="${entry.index}">${entry.index + 1}</div>
      <label class="session-set-field">
        <span class="sr-only">Reps for set ${entry.index + 1}</span>
        <input class="session-set-input" data-session-reps="${entry.index}" type="number" inputmode="numeric" placeholder="${html(repsPlaceholder)}" value="${html(entry.defaultReps)}">
      </label>
      <label class="session-set-field">
        <span class="sr-only">Load in ${html(unit)} for set ${entry.index + 1}</span>
        <input class="session-set-input" data-session-weight="${entry.index}" type="number" inputmode="decimal" step="0.5" placeholder="${html(entry.defaultWeight || '—')}" value="${html(entry.defaultWeight)}">
      </label>
      ${setState('target', 'Current', 'current')}
    </div>${hints}
  </div>`;
}

function upcomingSetRow(entry: SetPlanEntry, sheet: SetSheet): string {
  const planTarget = sheet.targetReps || String(entry.previous?.reps || entry.carried?.reps || 'free');
  return `<div class="session-set-block upcoming" data-set-block="${entry.index}" role="listitem" aria-label="Set ${entry.index + 1}, upcoming">
    <div class="session-set-row">
      <div class="session-set-num" data-set-num="${entry.index}">${entry.index + 1}</div>
      <div class="session-set-value">${html(planTarget)}</div>
      <div class="session-set-value">${html(entry.defaultWeight || '—')}</div>
      ${setState('clock', 'Upcoming')}
    </div>
  </div>`;
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
  nav.classList.remove('emom-round-track');
  if (!exercises.length) {
    title.textContent = session.sheetName || 'Freestyle';
    meta.textContent = 'No exercises yet';
    nav.classList.remove('session-ex-track');
    nav.innerHTML = '';
    body.innerHTML = '<div class="empty">This session has no exercises yet.</div>';
    footer.innerHTML = `<button class="session-finish-btn" id="finish-session" type="button">${action('flag', 'Finish session')}</button>`;
    input.bindControls();
    return;
  }
  const exercise = exercises[exerciseIndex];
  const slug = exercise.exerciseSlug;
  const name = exercise.exerciseName || slug;
  const restSec = Number(exercise.restSec) || 90;
  const targetSets = Number(exercise.sets) || setCounts[slug] || 1;
  const targetReps = exercise.reps || '';
  const targetValue = targetReps || 'free';
  const timed = isTimedTarget(targetValue);
  const unit = input.unitLabel();
  const logged = session.sets.filter((set) => set.exerciseSlug === slug);
  // The exercise rail is one connected track, so each button is a pip on it rather than a
  // free-standing tile. The jump binding and the tap target are unchanged.
  nav.classList.add('session-ex-track');
  nav.innerHTML = exercises.map((candidate, index) => {
    const target = Number(candidate.sets) || setCounts[candidate.exerciseSlug] || 1;
    const complete = input.loggedSetCount(candidate.exerciseSlug) >= target;
    const cls = index === exerciseIndex ? 'current' : complete ? 'done' : '';
    const state = index === exerciseIndex ? ', current' : complete ? ', done' : '';
    const pip = cls === 'done' ? icon('check') : String(index + 1);
    return `<button class="session-ex-dot ${cls}" data-jump-ex="${index}" type="button" aria-label="Exercise ${index + 1} of ${exercises.length}${state}"${index === exerciseIndex ? ' aria-current="step"' : ''}><span class="session-ex-pip">${pip}</span></button>`;
  }).join('');
  const activeSetIndex = Math.max(0, Array.from({ length: setCounts[slug] }, (_, index) => index).find((index) => !logged.find((set) => Number(set.setNumber) === index + 1)) ?? setCounts[slug] - 1);
  const allSetsDone = input.loggedSetCount(slug) >= setCounts[slug];
  const setPlan: SetPlanEntry[] = Array.from({ length: setCounts[slug] }, (_, index) => {
    const done = logged.find((set) => Number(set.setNumber) === index + 1);
    const previous = input.previousSets[index];
    // Carry forward what was actually just lifted: after a rerender the next set opens on the
    // last logged set of this exercise rather than back on the untouched prescription.
    const carried = logged.filter((set) => Number(set.setNumber) < index + 1).pop();
    const defaultReps = done?.reps != null ? String(done.reps)
      : carried?.reps != null ? String(carried.reps)
        : repsInputValue(targetReps || previous?.reps);
    const source = done?.weight != null ? done : carried?.weight != null ? carried : previous;
    const defaultWeight = source?.weight != null ? input.weightDisplay(source.weight) : input.weightDisplay(exercise.weight);
    return { index, done, previous, carried, defaultReps, defaultWeight };
  });
  const sheet: SetSheet = {
    setCount: setCounts[slug], targetReps,
    weightDisplay: input.weightDisplay, formatSetHint: input.formatSetHint, suggestedSetHint: input.suggestedSetHint
  };
  const current = setPlan[activeSetIndex];
  const rows = setPlan.map((entry) => {
    if (entry.done) return doneSetRow(entry, sheet);
    if (entry.index === activeSetIndex && !allSetsDone) return activeSetRow(entry, sheet, unit);
    return upcomingSetRow(entry, sheet);
  }).join('');
  const instructions = exercise.instructions || [];
  // The accordion's open state is owned by the controller, not the DOM: logging a set or
  // jumping exercises re-renders this body, and a class toggled in place does not survive
  // it. (A page render does not reach in here, so it is not the cause.)
  const instructionsMarkup = instructions.length ? `<div class="session-instructions ${input.instructionsOpen ? 'open' : ''}" id="session-instructions">
    <button class="session-instructions-toggle" data-toggle-instructions="${html(slug)}" type="button" aria-expanded="${input.instructionsOpen}" aria-controls="session-instructions-body">
      ${icon('info')}
      <span>How to perform</span>${icon('chevron-down', { class: 'chev' })}
    </button>
    <div class="session-instructions-body" id="session-instructions-body">${instructions.map((step, index) => `<div class="session-instructions-step"><b>${index + 1}</b>${html(step)}</div>`).join('')}</div>
  </div>` : '';
  title.textContent = name;
  // A mixed session names its section on every card, so reaching the last strength
  // exercise never reads as reaching the end of the workout.
  const sectionPrefix = input.emomPending ? 'Strength · ' : '';
  const sectionSuffix = input.emomPending ? ' · EMOM next' : '';
  meta.textContent = input.superset
    ? `${sectionPrefix}${session.sheetName || 'Workout'} · Round ${input.superset.roundIndex + 1} of ${input.superset.rounds} · Move ${input.superset.stepIndex + 1} of ${input.superset.stepCount}${sectionSuffix}`
    : `${session.sheetName || 'Workout'} · Exercise ${exerciseIndex + 1}/${exercises.length}${sectionSuffix}`;
  const media = sessionHeroMedia(exercise, name);
  body.innerHTML = `<h2 class="sr-only">${html(name)}</h2>
    ${media}
    <div class="session-ex-target" aria-label="Target">
      ${targetTile('layers', String(targetSets), targetSets === 1 ? 'set' : 'sets')}
      ${targetTile(timed ? 'timer' : 'repeat', html(targetValue), timed ? 'time' : 'reps')}
      ${targetTile('hourglass', `${restSec}s`, 'rest')}
    </div>
    <section class="session-set-plan" aria-label="Sets for ${html(name)}">
      <div class="session-sets-label">${icon('list-ordered')}<span>Sets</span></div>
      <div class="session-set-row session-set-columns" aria-hidden="true"><span></span><span>${timed ? 'Time' : 'Reps'}</span><span>Load ${html(unit)}</span><span></span></div>
      <div class="session-sets" role="list">${rows}</div>
      ${allSetsDone ? `<div class="session-ex-complete"><span>${icon('circle-check')}Exercise complete</span><strong>${setCounts[slug]} set${setCounts[slug] === 1 ? '' : 's'} logged</strong></div>` : ''}
      <button class="session-add-set" data-add-session-set="${html(slug)}" type="button">${icon('plus')}<span>Add set</span></button>
    </section>${instructionsMarkup}`;
  const isLast = exerciseIndex >= exercises.length - 1;
  const nextLabel = input.superset && !input.superset.roundComplete ? 'Next move' : 'Next exercise';
  const prev = exerciseIndex > 0 ? `<button class="session-prev-btn" data-jump-ex="${exerciseIndex - 1}" type="button">${action('chevron-left', 'Prev')}</button>` : '';
  const logCurrent = current && !allSetsDone ? `<button class="session-next-btn session-log-primary" data-session-log="${html(slug)}" data-set-index="${current.index}" data-set-log-btn="${current.index}" data-rest="${restSec}" type="button">${action('check', `Log set ${current.index + 1}`)}</button>` : '';
  // The EMOM section is the next page of the same workout, so on the last strength card it
  // takes the advance slot outright. Offered early it is a shortcut, so it sits beside Next.
  const handoffEarly = input.startEmom && !(allSetsDone && isLast) ? `<button class="session-emom-btn" id="start-emom-section" type="button">${action('timer', 'Start EMOM')}</button>` : '';
  const advance = !allSetsDone
    ? logCurrent
    : input.startEmom && isLast
      ? `<button class="session-emom-btn" id="start-emom-section" type="button">${action('timer', 'Next: EMOM')}</button>`
      : isLast
        ? `<button class="session-finish-btn" id="finish-session" type="button">${action('flag', 'Finish session')}</button>`
        : `<button class="session-next-btn" data-jump-ex="${exerciseIndex + 1}" type="button">${action('chevron-right', nextLabel, true)}</button>`;
  // Stopping here abandons the EMOM section, so it is the exception rather than a peer of
  // the handoff — same wording and weight as the EMOM half's own early exit.
  const finishEarly = input.emomPending && isLast ? `<button class="session-finish-early" id="finish-session" type="button">${action('flag', 'Finish early')}</button>` : '';
  footer.innerHTML = `${prev}${handoffEarly}${advance}${finishEarly}`;
  input.bindControls();
}
