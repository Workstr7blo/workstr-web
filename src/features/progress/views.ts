import type { BodyWeightEntry } from '../../core/types';
import { displayWeightKg, normalizeWeightUnit, type WeightUnit } from '../../core/units';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
import { monthLabel, type MonthKey } from '../../core/dates';
import { getStats, normalizeStatsRange, STATS_RANGE_LABELS, STATS_RANGE_SHORT, STATS_RANGES } from './stats';

// Every heading on both Statistics tabs: an icon, the name, and an optional quiet note.
export function statsSectionHead(name: IconName, title: string, note = ''): string {
  return `<div class="subsection-head stats-section-head"><span class="stats-section-title">${icon(name)}<span>${title}</span></span>${note ? `<small>${note}</small>` : ''}</div>`;
}

function statsHero(name: IconName, title: string, help: string, aside = ''): string {
  return `<div class="stats-hero-card">
    <div class="stats-hero-icon">${icon(name)}</div>
    <div class="stats-hero-copy"><span>${html(title)}</span><p>${html(help)}</p></div>
    ${aside}
  </div>`;
}

function statTile(name: IconName, value: string, label: string, options: { iconId?: string; iconClass?: string; tone?: string } = {}): string {
  return `<div class="summary-stat${options.tone ? ` ${options.tone}` : ''}">
      <span class="ss-icon">${icon(name, { id: options.iconId, class: options.iconClass })}</span>
      <div class="ss-val">${value}</div>
      <div class="ss-label">${label}</div>
    </div>`;
}

export function trainingStatsView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const range = normalizeStatsRange(state.statsRange);
  const stats = getStats(state.finishedSessions, state.exercises, new Date(), range);
  const scopeNote = range === 'all' ? '' : ` <small class="stat-scope">${html(STATS_RANGE_LABELS[range].toLowerCase())}</small>`;
  const rangeBar = `<div class="stats-range" role="group" aria-label="Statistics date range">
    ${STATS_RANGES.map((option) => `<button class="stats-range-btn ${option === range ? 'active' : ''}" type="button" data-stats-range="${option}" aria-pressed="${option === range}" aria-label="${html(STATS_RANGE_LABELS[option])}">${html(STATS_RANGE_SHORT[option])}</button>`).join('')}
  </div>`;
  const max = Math.max(1, ...stats.weekly.map((week) => week.volume));
  const barLabel = (key: string) => stats.bucket === 'month'
    ? monthLabel(key as MonthKey).slice(0, 3)
    : key.split('-')[1];
  const volumeText = (kg: number) => `${Math.round(displayWeightKg(kg, unit) || 0).toLocaleString()} ${unit}`;
  const peak = stats.weekly.reduce<(typeof stats.weekly)[number] | null>((best, week) => (!best || week.volume > best.volume ? week : best), null);
  const bars = stats.weekly.map((week) => `<div class="bar${week === peak && week.volume > 0 ? ' peak' : ''}" title="${html(barLabel(week.week))}: ${html(volumeText(week.volume))}"><div class="fill" style="height:${Math.round((week.volume / max) * 100)}%"></div><span class="blabel">${html(barLabel(week.week))}</span></div>`).join('');
  const bucketName = stats.bucket === 'month' ? 'month' : 'week';
  const peakNote = peak && peak.volume > 0 ? `best ${bucketName} ${html(volumeText(peak.volume))}` : '';
  const distMax = Math.max(1, ...stats.muscle.map((entry) => entry.sets));
  const dist = stats.muscle.length
    ? `<div id="prog-dist" class="dist">${stats.muscle.map((entry) => `<div class="dist-row"><small>${html(entry.muscle)}</small><div class="track"><div class="fill" style="width:${Math.round((entry.sets / distMax) * 100)}%"></div></div><small>${entry.sets}</small></div>`).join('')}</div>`
    : '<div id="prog-dist" class="dist empty">No logged sets yet.</div>';
  const prs = stats.prs.length
    ? `<div id="prog-prs" class="list stats-records">${stats.prs.map((record, index) => `<div class="row stats-record${index < 3 ? ` top-${index + 1}` : ''}"><span class="stats-record-rank">${index === 0 ? icon('trophy') : index + 1}</span><div><strong>${html(record.name)}</strong><small>top set ${displayWeightKg(record.topWeight, unit)} ${unit}</small></div><span class="badge muscle">${displayWeightKg(record.e1rm, unit)} ${unit} 1RM</span></div>`).join('')}</div>`
    : '<div id="prog-prs" class="list empty">No records yet.</div>';
  // Volume, distribution and records are all empty for the same reason, so a profile with
  // no finished session gets one message naming what to do instead of three restatements
  // of the same absence under three headings.
  const nothingLogged = !stats.weekly.length && !stats.muscle.length && !stats.prs.length;
  const body = nothingLogged
    ? `<div id="prog-bars" class="bars" hidden></div><div id="prog-dist" class="dist" hidden></div><div id="prog-prs" class="list" hidden></div>
    <div class="stats-first-run">
      <span class="stats-first-run-icon">${icon('chart-column')}</span>
      <strong>Nothing logged yet</strong>
      <p>Finish a workout and this fills in: weekly volume, which muscles you are actually training, and your best estimated 1RM for every lift.</p>
      <button class="button primary stats-action" data-view="workouts" type="button">${icon('dumbbell')}<span>Go to Workouts</span></button>
    </div>`
    : `<div class="panel stats-panel">
    ${statsSectionHead('chart-column', `${stats.bucket === 'month' ? 'Monthly' : 'Weekly'} volume`, peakNote)}
    <div id="prog-bars" class="bars">${bars}</div>
    ${statsSectionHead('biceps-flexed', 'Muscle distribution', `by working sets${range === 'all' ? '' : `, ${html(STATS_RANGE_LABELS[range].toLowerCase())}`}`)}
    ${dist}
    ${statsSectionHead('trophy', 'Personal records', 'best estimated 1RM (Epley), all time')}
    ${prs}
  </div>`;
  const help = range === 'all' ? 'Streak, volume and records from every finished workout.' : `Volume and muscle split for the last ${STATS_RANGE_LABELS[range].toLowerCase()}. Streak and records stay all-time.`;
  return `${statsHero('chart-column', 'Training stats', help)}
  <div class="stats-hero">
    ${statTile('flame', `<span id="stat-streak">${stats.streak}</span>`, 'Day streak', { iconId: 'stat-streak-flame', iconClass: `flame ${stats.streak > 0 ? 'active' : ''}`, tone: stats.streak > 0 ? 'streak' : '' })}
    ${statTile('calendar-check', `<span id="stat-sessions">${stats.totalSessions}</span>`, `${range === 'all' ? 'Total sessions' : 'Sessions'}${scopeNote}`)}
    ${statTile('weight', `<span id="stat-volume">${Math.round(displayWeightKg(stats.totalVolume, unit) || 0).toLocaleString()}</span><small id="stat-volume-unit" class="ss-unit">${unit}</small>`, `${range === 'all' ? 'Total volume' : 'Volume'}${scopeNote}`)}
  </div>
  ${rangeBar}
  ${body}`;
}

export function bmiMarkup(bmi: number): string {
  const barMin = 15, barMax = 40, range = barMax - barMin;
  const zones = [
    { name: 'Under', cls: 'under', min: barMin, max: 18.5 },
    { name: 'Normal', cls: 'normal', min: 18.5, max: 25 },
    { name: 'Over', cls: 'over', min: 25, max: 30 },
    { name: 'Obese', cls: 'obese', min: 30, max: barMax }
  ];
  const pct = ((Math.max(barMin, Math.min(barMax, bmi)) - barMin) / range) * 100;
  const label = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  return `${statsSectionHead('gauge', 'BMI', `${bmi.toFixed(1)} · ${label}`)}
    <div class="bmi-bar">
      ${zones.map((zone) => `<div class="bmi-zone ${zone.cls}" style="flex:0 0 ${(((zone.max - zone.min) / range) * 100).toFixed(1)}%">${zone.name}</div>`).join('')}
      <div class="bmi-marker" style="left:${pct.toFixed(1)}%"></div>
    </div>
    <div class="bmi-scale"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>40+</span></div>`;
}

export function bodyChartMarkup(sorted: BodyWeightEntry[], unit: WeightUnit): string {
  if (sorted.length < 2) return '';
  const wd = (kg: number) => displayWeightKg(kg, unit) || 0;
  const W = 400, H = 120, pad = 30, n = sorted.length;
  const vals = sorted.map((entry) => entry.weight_kg);
  const min = Math.min(...vals) * 0.995, max = Math.max(...vals) * 1.005, range = (max - min) || 1;
  const pts = vals.map((value, index) => {
    const x = pad + (index / (n - 1)) * (W - pad * 2);
    const y = pad / 2 + (1 - (value - min) / range) * (H - pad);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const polyline = pts.map((point) => point.join(',')).join(' ');
  const areaPath = `M${pts[0].join(',')} ${pts.slice(1).map((point) => 'L' + point.join(',')).join(' ')} L${pts[n - 1][0]},${H - pad / 2} L${pts[0][0]},${H - pad / 2} Z`;
  const dots = pts.map(([x, y], index) => {
    const label = new Date(sorted[index].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
    return `<circle cx="${x}" cy="${y}" r="3" fill="var(--purple-2)" stroke="var(--void)" stroke-width="1.5"><title>${label}: ${wd(sorted[index].weight_kg).toFixed(1)} ${unit}</title></circle>`;
  }).join('');
  let yLabels = '';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const value = min + (range * i / ySteps);
    const y = pad / 2 + (1 - i / ySteps) * (H - pad);
    yLabels += `<text x="${pad - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--dim)" dominant-baseline="middle">${wd(value).toFixed(0)}</text>`;
    yLabels += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="0.5"/>`;
  }
  const firstDate = new Date(sorted[0].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const lastDate = new Date(sorted[n - 1].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return `${statsSectionHead('chart-line', 'Weight trend', `${n} entr${n === 1 ? 'y' : 'ies'}`)}
    <div class="body-chart">
      <svg viewBox="0 0 ${W} ${H + 16}">
        ${yLabels}
        <path d="${areaPath}" fill="var(--sovereign-purple)" opacity=".12"/>
        <polyline points="${polyline}" fill="none" stroke="var(--purple-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${pad}" y="${H + 10}" font-size="9" fill="var(--dim)">${firstDate}</text>
        <text x="${W - pad}" y="${H + 10}" font-size="9" fill="var(--dim)" text-anchor="end">${lastDate}</text>
      </svg>
    </div>`;
}

function bodyCard(name: IconName, value: string, label: string, tone = ''): string {
  return `<div class="body-card${tone ? ` ${tone}` : ''}"><span class="body-card-icon">${icon(name)}</span><div class="body-card-val">${value}</div><div class="body-card-lbl">${label}</div></div>`;
}

export function bodyView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const wd = (kg: number) => displayWeightKg(kg, unit) || 0;
  const entries = state.bodyEntries;
  let cards = '', bmi = '', chart = '', goal = '';
  // Empty says it once, at the top, where it can also say what to do. The list keeps its
  // id either way because the shell patches that node directly.
  let listHtml = '<div id="body-list" class="list" hidden></div>';
  if (entries.length) {
    // Entries are newest-first; sort oldest-first for trend/average maths.
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0], latest = sorted[sorted.length - 1];
    const latestW = latest.weight_kg;
    const last7 = sorted.slice(-7);
    const avg7 = last7.reduce((sum, entry) => sum + entry.weight_kg, 0) / last7.length;
    const totalChange = latestW - first.weight_kg;
    const changeTone = totalChange > 0 ? 'up' : totalChange < 0 ? 'down' : '';
    cards = `<div class="body-cards">
      ${bodyCard('weight', wd(latestW).toFixed(1), `Current (${unit})`)}
      ${bodyCard('activity', wd(avg7).toFixed(1), '7-day avg')}
      ${bodyCard(totalChange > 0 ? 'trending-up' : totalChange < 0 ? 'trending-down' : 'minus', `${totalChange > 0 ? '+' : ''}${wd(totalChange).toFixed(1)}`, 'Total change', changeTone)}
    </div>`;
    const heightCm = state.settings.heightCm || 0;
    if (heightCm > 0) { const meters = heightCm / 100; bmi = bmiMarkup(latestW / (meters * meters)); }
    chart = bodyChartMarkup(sorted, unit);
    const targetKg = state.settings.targetWeightKg || 0;
    if (targetKg > 0) {
      const startW = first.weight_kg;
      const totalNeeded = targetKg - startW;
      const pct = totalNeeded !== 0 ? Math.min(100, Math.max(0, ((latestW - startW) / totalNeeded) * 100)) : 100;
      const remaining = targetKg - latestW;
      goal = `${statsSectionHead('target', 'Goal progress', `${pct.toFixed(0)}%`)}
        <div class="body-goal-bar"><div class="body-goal-fill" style="width:${pct.toFixed(0)}%"></div></div>
        <div class="body-goal-labels"><span>${wd(startW).toFixed(1)} ${unit}</span><span>${remaining > 0 ? '+' : ''}${wd(remaining).toFixed(1)} ${unit} to go</span><span>${wd(targetKg).toFixed(1)} ${unit}</span></div>`;
    }
    const dateLabel = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    listHtml = `<div id="body-list" class="list body-entries">${entries.map((entry) => `<div class="row body-entry"><span class="body-entry-icon">${icon('weight')}</span><div><strong>${wd(entry.weight_kg)} ${unit}</strong><small>${html(dateLabel(entry.date))}${entry.notes ? ' · ' + html(entry.notes) : ''}</small></div><button class="button quiet danger small body-entry-delete" type="button" data-del-body="${entry.id}" aria-label="Delete ${wd(entry.weight_kg)} ${unit} on ${html(entry.date)}">${icon('trash-2')}</button></div>`).join('')}</div>`;
  }
  const latestLine = entries.length
    ? `Last logged ${new Date(entries.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}. Weights in <span id="body-unit">${unit}</span>.`
    : `Track weight over time. Weights in <span id="body-unit">${unit}</span>.`;
  return `<div class="stats-hero-card">
    <div class="stats-hero-icon">${icon('weight')}</div>
    <div class="stats-hero-copy"><span>Body weight</span><p>${latestLine}</p></div>
  </div>
  <div class="panel stats-panel body-panel">
    <div id="body-empty" class="empty stats-empty" style="display:${entries.length ? 'none' : ''}">${icon('weight')}<span>No entries yet. Log your weight below to start tracking.</span></div>
    <div id="body-cards">${cards}</div>
    <div id="body-bmi">${bmi}</div>
    <div id="body-chart">${chart}</div>
    <div id="body-goal">${goal}</div>
    ${entries.length ? statsSectionHead('history', 'Entries', 'newest first') : ''}
    ${listHtml}
  </div>
  <div class="panel stats-panel body-forms">
    ${statsSectionHead('plus', 'Log weight')}
    <form id="body-form" class="form-grid">
      <label>Date<input type="date" name="date" /></label>
      <label><span>Weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="weightKg" step="0.1" inputmode="decimal" placeholder="e.g. 80" /></label>
      <div class="form-actions span-2"><button class="button primary stats-action" type="submit">${icon('plus')}<span>Log weight</span></button></div>
    </form>
    ${statsSectionHead('ruler', 'Profile', 'for BMI &amp; goal')}
    <form id="body-profile-form" class="form-grid">
      <label>Height (cm)<input type="number" name="heightCm" step="1" min="100" max="250" inputmode="numeric" placeholder="e.g. 175" value="${state.settings.heightCm || ''}" /></label>
      <label><span>Target weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="targetWeightKg" step="0.1" min="0" inputmode="decimal" placeholder="e.g. 75" value="${state.settings.targetWeightKg ? wd(state.settings.targetWeightKg) : ''}" /></label>
      <div class="form-actions span-2"><button class="button stats-action" type="submit">${icon('check')}<span>Save profile</span></button></div>
    </form>
  </div>`;
}
