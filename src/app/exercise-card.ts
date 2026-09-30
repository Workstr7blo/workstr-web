import type { Exercise } from '../core/types';
import { responsiveImageUrl } from '../core/media';
import { formatTaxonomyLabel, normalizeTrainingLevel, TRAINING_LEVELS } from '../core/training-taxonomy';
import { EX_PLACEHOLDER, html } from './format';
import { icon, type IconName } from './icons';

// The one exercise card Library and Discover both draw, so the two cannot drift apart. It says
// what the exercise is, what it trains and what level it suits; source, movement type, secondary
// muscles and equipment are in the exercise details. It lives in `app/` because both features use
// it. Each view supplies only what differs: the favourite star in Library, the import action in
// Discover.

const SELECTED_CHECK = `<span class="sel-check">${icon('check', { size: 14 })}</span>`;

// Muscle and level on one line, either alone when the other is missing, and no line at all when
// both are. The level's dot is the separator, so a narrow card that wraps the line starts the
// second row cleanly instead of leaving a stray "·" at the end of the first; its colour repeats
// what the word already says.
export function exerciseMetaLine(exercise: Exercise): string {
  const muscle = (exercise.muscle_group || '').trim();
  const level = trainingLevelMark(exercise.difficulty);
  if (!muscle && !level) return '';
  return `<div class="card-meta">${muscle ? `<span class="muscle">${html(muscle)}</span>` : ''}${level}</div>`;
}

// A level the way every card shows it - exercise and program alike: its word, behind a dot
// whose colour repeats that word. An unrecognised level gets a neutral dot.
export function trainingLevelMark(difficulty: string | undefined): string {
  const level = normalizeTrainingLevel(difficulty);
  if (!level) return '';
  const known = (TRAINING_LEVELS as readonly string[]).includes(level) ? ` level-${level}` : '';
  return `<span class="card-level${known}">${html(formatTaxonomyLabel(level))}</span>`;
}

export interface ExerciseCardParts {
  exercise: Exercise;
  // The key attribute the view's grid and click delegation read, e.g. `data-slug="..."`.
  keyAttribute: string;
  classes?: string;
  selectable?: boolean;
  nameAction?: string;
  footer?: string;
}

export function exerciseCard({ exercise, keyAttribute, classes = '', selectable = false, nameAction = '', footer = '' }: ExerciseCardParts): string {
  const src = exercise.image_url || '';
  const photo = src ? `<img class="card-photo" src="${html(responsiveImageUrl(src, 360))}" alt="" loading="lazy" decoding="async" data-fallback="remove">` : '';
  return `
    <div class="ex-card${classes}" ${keyAttribute}>
      <div class="card-img">
        ${EX_PLACEHOLDER}${photo}
        ${selectable ? SELECTED_CHECK : ''}
      </div>
      <div class="card-body">
        <div class="card-name"><span class="card-name-text">${html(exercise.name)}</span>${nameAction}</div>
        ${exerciseMetaLine(exercise)}
        ${footer}
      </div>
    </div>`;
}

// The header both exercise tabs open with, in the same shape as the Workouts tab heroes.
// `detail` is trusted markup: a view passes counts, or the status line the shell patches.
export function exerciseBrowseHero(name: IconName, title: string, copy: string, detail = ''): string {
  return `<div class="exercise-hero">
    <div class="exercise-hero-icon">${icon(name)}</div>
    <div class="exercise-hero-copy"><span>${html(title)}</span><p>${html(copy)}</p>${detail ? `<div class="exercise-hero-stats">${detail}</div>` : ''}</div>
  </div>`;
}
