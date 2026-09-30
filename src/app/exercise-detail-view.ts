import type { Exercise } from '../core/types';
import { responsiveImageUrl } from '../core/media';
import { formatTaxonomyLabel, normalizeMovementType, normalizeTrainingLevel } from '../core/training-taxonomy';
import { discoverImportState } from '../features/discover/views';
import { authorPill, EX_PLACEHOLDER, exerciseSourceLabel, html } from './format';
import { icon, type IconName } from './icons';
import type { AppState } from './state';

// The exercise detail sheet opened from a Library or Discover card. Markup only: the catalog
// controller opens it, paints the muscle map into `#detail-muscle-map` and binds the actions.

export function exerciseDetailMuscles(exercise: Exercise): string[] {
  const muscles = (exercise.muscles || []).filter(Boolean);
  return muscles.length ? muscles : (exercise.muscle_group ? [exercise.muscle_group] : []);
}

// Written in place by the controller when the star is toggled, so the modal need not redraw.
export function favouriteButtonContent(on: boolean): string {
  return `${icon('star', { filled: on })}<span>${on ? 'Remove from favorites' : 'Add to favorites'}</span>`;
}

function section(name: IconName, title: string, body: string): string {
  return `<div class="subsection-head detail-section-head"><span>${icon(name)}<span>${html(title)}</span></span></div>${body}`;
}

function setsItem(name: IconName, value: string, label: string): string {
  return `<div class="sets-item"><span class="sets-icon">${icon(name)}</span><div class="val">${value}</div><div class="lbl">${label}</div></div>`;
}

export function exerciseDetailMarkup(exercise: Exercise, source: 'library' | 'discover', state: AppState): string {
  const src = exercise.image_url || '';
  const equipment = (exercise.equipment || []).filter(Boolean);
  const tags = (exercise.tags || []).filter(Boolean);
  const pills = (list: string[]) => list.map((item) => `<span class="tag-pill">${html(item)}</span>`).join('');
  const muscleList = exerciseDetailMuscles(exercise);
  const sourceLabel = exerciseSourceLabel(exercise);
  const instructions = (exercise.instructions || []).map((line) => line.trim()).filter(Boolean);
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  // Canon events carry instructions in the event content; older imports have that
  // same text copied into description — show it only when it adds something.
  const description = (exercise.description || '').trim();
  const showDescription = description && normalize(description) !== normalize(instructions.join(' '));
  const importState = discoverImportState(exercise, state.library);
  const importLabel = importState === 'update' ? 'Update' : importState === 'in-library' ? 'In library' : 'Import';
  const importIcon: IconName = importState === 'update' ? 'refresh-cw' : importState === 'in-library' ? 'check' : 'download';
  const importCls = importState === 'in-library' ? '' : 'primary';
  // What the compact card leaves out is here: the source and, for a Nostr exercise, who published it.
  const sourceName = ({ ai: 'AI', manual: 'Manual' } as Record<string, string>)[sourceLabel] || sourceLabel;
  const creator = exercise.nostr_pubkey ? authorPill(state.authorProfiles?.[exercise.nostr_pubkey], exercise.nostr_pubkey, { compact: true }) : '';
  const actions = source === 'library'
    ? `<button class="button" id="ex-detail-fav" type="button" aria-pressed="${exercise.favourite}">${favouriteButtonContent(Boolean(exercise.favourite))}</button><button class="button quiet danger" id="ex-detail-delete">${icon('trash-2')}<span>Delete</span></button>`
    : `<button class="button ${importCls}" id="ex-import"${importState === 'in-library' ? ' disabled' : ''}>${icon(importIcon)}<span>${importLabel}</span></button>`;
  return `
    <div class="detail-img${src ? '' : ' placeholder'}">${src ? `<img src="${html(responsiveImageUrl(src, 720))}" alt="" loading="lazy" decoding="async" data-fallback="parent-placeholder">` : EX_PLACEHOLDER}</div>
    <h3 class="detail-title">${html(exercise.name)}</h3>
    <div class="detail-badges">
      ${exercise.difficulty ? `<span class="badge diff">${html(formatTaxonomyLabel(normalizeTrainingLevel(exercise.difficulty)))}</span>` : ''}
      ${exercise.category ? `<span class="badge cat">${html(formatTaxonomyLabel(normalizeMovementType(exercise.category)))}</span>` : ''}
    </div>
    <div class="detail-source"><span>Source</span>${html(sourceName)}${creator}</div>
    ${showDescription ? `<p class="detail-desc">${html(description)}</p>` : ''}
    <div class="sets-info">
      ${setsItem('layers', String(exercise.default_sets ?? 3), 'Sets')}
      ${setsItem('repeat', html(String(exercise.default_reps || '8-12')), 'Reps')}
      ${setsItem('timer', `${exercise.default_rest ?? 90}s`, 'Rest')}
    </div>
    ${muscleList.length ? section('target', 'Target muscles', `<div class="tag-row">${pills(muscleList)}</div><div id="detail-muscle-map" class="detail-muscle-map"></div>`) : ''}
    ${equipment.length ? section('dumbbell', 'Equipment', `<div class="tag-row">${pills(equipment)}</div>`) : ''}
    ${tags.length ? section('tag', 'Tags', `<div class="tag-row">${pills(tags)}</div>`) : ''}
    ${instructions.length ? section('list-ordered', 'Instructions', `<ol class="instruction-list">${instructions.map((line) => `<li>${html(line)}</li>`).join('')}</ol>`) : ''}
    <div class="form-actions detail-actions">${actions}</div>`;
}
