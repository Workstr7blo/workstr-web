import { displayWeightKg, type WeightUnit } from '../../core/units';
import { html } from '../../app/format';
import type { BuilderEmomSection, BuilderRow, BuilderState } from './views';
import { responsiveImageUrl } from '../../core/media';

const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>';

// Exported because the duration field rewrites this line in place while it is being typed into.
export function emomSectionSummary(section: BuilderEmomSection, moveCount: number): string {
  const minutes = Math.max(1, Math.floor(Number(section.durationMin) || 1));
  const intervals = Math.floor((minutes * 60) / Math.max(1, Number(section.intervalSec) || 60));
  return `${minutes} min · ${intervals} interval${intervals === 1 ? '' : 's'} · ${moveCount} move${moveCount === 1 ? '' : 's'}`;
}

// A move's minute is its place in the list, so there is nothing to type. The order changes with
// the arrow buttons rather than drag and drop, which is unreliable on iOS.
function prescriptionRowMarkup(row: BuilderRow, index: number, position: number, count: number): string {
  const name = html(row.exerciseName);
  const targetType = row.durationSec ? 'seconds' : row.reps ? 'reps' : 'open';
  const targetValue = targetType === 'seconds' ? row.durationSec : targetType === 'reps' ? row.reps : '';
  return `<div class="emom-prescription-row" data-i="${index}">
    <div class="emom-rx-head">
      <span class="emom-rx-minute-label">Minute ${position + 1}</span>
      <button class="emom-rx-remove" type="button" data-rm="${index}" aria-label="Remove ${name}" title="Remove ${name}">${TRASH}</button>
    </div>
    <div class="emom-rx-name">
      <strong>${name}</strong>
      ${row.muscleGroup ? `<small>${html(row.muscleGroup)}</small>` : ''}
    </div>
    <div class="emom-rx-target">
      <select class="emom-rx-type" aria-label="Target type for ${name}" data-target-type="${index}">
        <option value="reps" ${targetType === 'reps' ? 'selected' : ''}>Reps</option>
        <option value="seconds" ${targetType === 'seconds' ? 'selected' : ''}>Seconds</option>
        <option value="open" ${targetType === 'open' ? 'selected' : ''}>Open</option>
      </select>
      ${targetType !== 'open' ? `<input class="emom-rx-value" aria-label="${targetType === 'reps' ? 'Repetitions' : 'Work seconds'} for ${name}" type="number" min="1" max="${targetType === 'seconds' ? 60 : 999}" data-f="targetValue" data-target-type="${targetType}" value="${html(String(targetValue))}">` : '<span class="emom-rx-open">open</span>'}
    </div>
    <div class="emom-rx-order">
      <button class="emom-rx-move" type="button" data-move="${index}" data-dir="-1" aria-label="Move ${name} up" ${position === 0 ? 'disabled' : ''}>↑</button>
      <button class="emom-rx-move" type="button" data-move="${index}" data-dir="1" aria-label="Move ${name} down" ${position === count - 1 ? 'disabled' : ''}>↓</button>
    </div>
  </div>`;
}

function strengthRowMarkup(row: BuilderRow, index: number, current: BuilderState, unit: WeightUnit): string {
  const src = current.library.find((exercise) => exercise.slug === row.exerciseSlug)?.image_url || row.imageUrl;
  const img = src
    ? `<img class="wex-img" src="${html(responsiveImageUrl(src, 240))}" alt="" loading="lazy" decoding="async" data-fallback="replace" data-fallback-tag="div" data-fallback-class="wex-img placeholder">`
    : `<div class="wex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg></div>`;
  return `<div class="wex-row" data-i="${index}">
    <div class="wex-move-btns">
      <button class="wex-move-btn" type="button" data-move="${index}" data-dir="-1" title="Move up">↑</button>
      <button class="wex-move-btn" type="button" data-move="${index}" data-dir="1" title="Move down">↓</button>
    </div>
    ${img}
    <div class="wex-info">
      <div class="wex-name">${html(row.exerciseName)}${row.muscleGroup ? `<span class="wex-muscle">${html(row.muscleGroup)}</span>` : ''}</div>
      <div class="wex-params">
        <div class="wex-param-group"><div class="wex-param-label">Sets</div><input class="wex-param-input" type="number" min="1" max="20" data-f="sets" value="${row.sets}"></div>
        <div class="wex-param-group"><div class="wex-param-label">Reps</div><input class="wex-param-input reps" data-f="reps" value="${html(row.reps)}"></div>
        <div class="wex-param-group"><div class="wex-param-label">${unit}</div><input class="wex-param-input" type="number" min="0" step="0.5" data-f="weight" placeholder="—" value="${row.weight != null ? displayWeightKg(row.weight, unit) : ''}"></div>
        <div class="wex-param-group"><div class="wex-param-label">Rest</div><input class="wex-param-input" type="number" min="0" step="5" data-f="restSec" value="${row.restSec}"></div>
      </div>
      ${index > 0 ? `<button class="wex-superset-toggle ${row.supersetWithPrevious ? 'active' : ''}" type="button" data-toggle-superset="${index}" aria-pressed="${row.supersetWithPrevious ? 'true' : 'false'}">${row.supersetWithPrevious ? 'Linked in superset' : 'Pair with previous'}</button>` : ''}
    </div>
    <button class="wex-remove" type="button" data-rm="${index}" title="Remove">✕</button>
  </div>`;
}

function emomSectionsMarkup(current: BuilderState): string {
  const exerciseOptions = [...current.library]
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))
    .map((exercise) => `<button type="button" data-section-exercise="SECTION_INDEX" data-slug="${html(exercise.slug)}">${html(exercise.name)}</button>`).join('');
  return `<div class="emom-section-list">${current.emomSections.map((section, sectionIndex) => {
    const rows = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sectionIndex === sectionIndex);
    const sectionActions = current.emomSections.length > 1
      ? `<div class="emom-section-actions">
          <button type="button" data-move-section="${sectionIndex}" data-dir="-1" title="Move section up" ${sectionIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move-section="${sectionIndex}" data-dir="1" title="Move section down" ${sectionIndex === current.emomSections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-remove-section="${sectionIndex}" title="Remove section">✕</button>
        </div>`
      : '';
    return `<section class="emom-section-card" data-section="${sectionIndex}">
      <div class="emom-section-header">
        <div class="emom-section-title"><strong>Section ${sectionIndex + 1}</strong><span>${html(emomSectionSummary(section, rows.length))}</span></div>
        ${sectionActions}
      </div>
      <div class="emom-section-settings">
        <label class="emom-duration-inline"><span>Total duration</span><input data-section-field="durationMin" type="number" min="1" max="999" aria-label="Total duration of section ${sectionIndex + 1} in minutes" value="${section.durationMin}"><strong>min</strong></label>
      </div>
      <div class="emom-section-exercises">
        <div class="emom-section-exercise-head"><span>Moves</span><button class="button small" type="button" data-toggle-section-picker="${sectionIndex}">+ Add move</button></div>
        <p class="emom-section-help">One move begins each minute, in the order shown.</p>
        ${section.splitMinutes ? '<p class="emom-section-note">Moves that shared a minute now each start their own minute. Save to keep this order.</p>' : ''}
        <div class="emom-library-picker" data-section-picker="${sectionIndex}" hidden>${exerciseOptions.replaceAll('SECTION_INDEX', String(sectionIndex)) || '<div class="empty">Your library is empty.</div>'}</div>
        ${rows.length ? `<div class="emom-rx-list">${rows.map(({ row, index }, position) => prescriptionRowMarkup(row, index, position, rows.length)).join('')}</div>` : '<div class="empty emom-section-empty">Add at least one move to this section.</div>'}
      </div>
    </section>`;
  }).join('')}</div>`;
}

// Indices stay global across both halves: the click handlers address current.rows directly.
// Rows with sectionIndex < 0 are the strength half; the rest belong to an EMOM section.
export function builderRowsMarkup(current: BuilderState, unit: WeightUnit): string {
  if (current.mode === 'emom') return emomSectionsMarkup(current);
  const strengthRows = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sectionIndex < 0);
  const strengthMarkup = strengthRows.length
    ? strengthRows.map(({ row, index }) => strengthRowMarkup(row, index, current, unit)).join('')
    : '<div class="empty" style="padding:8px 0">No normal exercises yet. Search above to add.</div>';
  if (current.mode === 'normal') return strengthMarkup;
  return `<div class="normal-section-list">${strengthMarkup}</div><div class="subsection-head"><span>EMOM sections</span></div>${emomSectionsMarkup(current)}`;
}
