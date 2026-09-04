import { displayWeightKg, type WeightUnit } from '../../core/units';
import { formatMinutes, html } from '../../app/format';
import type { BuilderRow, BuilderState } from './views';

// Rows with sectionIndex < 0 are the strength half; the rest belong to an EMOM section.
function prescriptionRowMarkup(row: BuilderRow, index: number): string {
  const targetType = row.durationSec ? 'seconds' : row.reps ? 'reps' : 'open';
  const targetValue = targetType === 'seconds' ? row.durationSec : targetType === 'reps' ? row.reps : '';
  return `<div class="emom-prescription-row" data-i="${index}">
    <div class="emom-rx-name">
      <strong>${html(row.exerciseName)}</strong>
      ${row.muscleGroup ? `<small>${html(row.muscleGroup)}</small>` : ''}
    </div>
    <div class="emom-rx-target">
      <label class="emom-rx-minute"><span>Minute</span><input aria-label="Minute for ${html(row.exerciseName)}" type="number" min="1" max="999" data-f="intervalIndex" value="${row.intervalIndex + 1}"></label>
      <select class="emom-rx-type" aria-label="Target type for ${html(row.exerciseName)}" data-target-type="${index}">
        <option value="reps" ${targetType === 'reps' ? 'selected' : ''}>Reps</option>
        <option value="seconds" ${targetType === 'seconds' ? 'selected' : ''}>Seconds</option>
        <option value="open" ${targetType === 'open' ? 'selected' : ''}>Open</option>
      </select>
      ${targetType !== 'open' ? `<input class="emom-rx-value" aria-label="${targetType === 'reps' ? 'Repetitions' : 'Work seconds'} for ${html(row.exerciseName)}" type="number" min="1" max="999" data-f="targetValue" data-target-type="${targetType}" value="${html(String(targetValue))}">` : '<span class="emom-rx-open">open</span>'}
    </div>
    <button class="emom-rx-remove" type="button" data-rm="${index}" title="Remove ${html(row.exerciseName)}">✕</button>
  </div>`;
}

function strengthRowMarkup(row: BuilderRow, index: number, current: BuilderState, unit: WeightUnit): string {
  const src = row.imageUrl || current.library.find((exercise) => exercise.slug === row.exerciseSlug)?.image_url;
  const img = src
    ? `<img class="wex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wex-img placeholder'}))">`
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

function emomSectionsMarkup(current: BuilderState, unit: WeightUnit): string {
  const exerciseOptions = [...current.library]
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))
    .map((exercise) => `<button type="button" data-section-exercise="SECTION_INDEX" data-slug="${html(exercise.slug)}">${html(exercise.name)}</button>`).join('');
  return `<div class="emom-section-list">${current.emomSections.map((section, sectionIndex) => {
    const rows = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sectionIndex === sectionIndex);
    const sectionSeconds = section.rounds * section.intervalSec;
    const summary = `${section.rounds} min · every ${formatMinutes(section.intervalSec / 60) || '1 min'} · ${rows.length} move${rows.length === 1 ? '' : 's'}`;
    const sectionActions = current.emomSections.length > 1
      ? `<div class="emom-section-actions">
          <button type="button" data-move-section="${sectionIndex}" data-dir="-1" title="Move section up" ${sectionIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move-section="${sectionIndex}" data-dir="1" title="Move section down" ${sectionIndex === current.emomSections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-remove-section="${sectionIndex}" title="Remove section">✕</button>
        </div>`
      : '';
    return `<section class="emom-section-card" data-section="${sectionIndex}">
      <div class="emom-section-header">
        <div class="emom-section-title"><strong>Section ${sectionIndex + 1}</strong><span>${html(summary)}</span></div>
        ${sectionActions}
      </div>
      <div class="emom-section-settings">
        <label class="emom-duration-inline"><span>Duration</span><input data-section-field="rounds" type="number" min="1" max="999" value="${section.rounds}"><strong>min</strong></label>
        <small>${Math.ceil(sectionSeconds / 60)} rounds · every 1:00</small>
      </div>
      <div class="emom-section-exercises">
        <div class="emom-section-exercise-head"><span>Every minute</span><button class="button small" type="button" data-toggle-section-picker="${sectionIndex}">+ Add move</button></div>
        <div class="emom-library-picker" data-section-picker="${sectionIndex}" hidden>${exerciseOptions.replaceAll('SECTION_INDEX', String(sectionIndex)) || '<div class="empty">Your library is empty.</div>'}</div>
        ${rows.length ? `<div class="emom-rx-list">${rows.map(({ row, index }) => rowMarkup(row, index, current, unit)).join('')}</div>` : '<div class="empty emom-section-empty">Choose one exercise for this section.</div>'}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function rowMarkup(row: BuilderRow, index: number, current: BuilderState, unit: WeightUnit): string {
  return row.sectionIndex >= 0 ? prescriptionRowMarkup(row, index) : strengthRowMarkup(row, index, current, unit);
}

// Indices stay global across both halves: the click handlers address current.rows directly.
export function builderRowsMarkup(current: BuilderState, unit: WeightUnit): string {
  if (current.mode === 'emom') return emomSectionsMarkup(current, unit);
  const strengthRows = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.sectionIndex < 0);
  const strengthMarkup = strengthRows.length
    ? strengthRows.map(({ row, index }) => rowMarkup(row, index, current, unit)).join('')
    : '<div class="empty" style="padding:8px 0">No normal exercises yet. Search above to add.</div>';
  if (current.mode === 'normal') return strengthMarkup;
  return `<div class="normal-section-list">${strengthMarkup}</div><div class="subsection-head"><span>EMOM sections</span></div>${emomSectionsMarkup(current, unit)}`;
}
