import type { Exercise } from '../core/types';
import { responsiveImageUrl } from '../core/media';
import { formatTaxonomyLabel, normalizeTrainingLevel, TRAINING_LEVELS } from '../core/training-taxonomy';
import { EX_PLACEHOLDER, html } from './format';

// The one exercise card Library and Discover both draw, so the two cannot drift apart. It says
// what the exercise is, what it trains and what level it suits; source, movement type, secondary
// muscles and equipment are in the exercise details. It lives in `app/` because both features use
// it. Each view supplies only what differs: the favourite star in Library, the import action in
// Discover.

const SELECTED_CHECK = '<span class="sel-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';

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
