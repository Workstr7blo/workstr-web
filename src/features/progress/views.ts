import type { BodyWeightEntry } from '../../core/types';
import { displayWeightKg, normalizeWeightUnit, type WeightUnit } from '../../core/units';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { getStats } from './stats';

export function trainingStatsView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const stats = getStats(state.finishedSessions, state.exercises);
  const max = Math.max(1, ...stats.weekly.map((week) => week.volume));
  const bars = stats.weekly.length
    ? stats.weekly.map((week) => `<div class="bar"><div class="fill" style="height:${Math.round((week.volume / max) * 100)}%"></div><span class="blabel">${html(week.week.split('-')[1])}</span></div>`).join('')
    : '<div class="empty">No volume logged yet.</div>';
  const distMax = Math.max(1, ...stats.muscle.map((entry) => entry.sets));
  const dist = stats.muscle.length
    ? `<div id="prog-dist" class="dist">${stats.muscle.map((entry) => `<div class="dist-row"><small>${html(entry.muscle)}</small><div class="track"><div class="fill" style="width:${Math.round((entry.sets / distMax) * 100)}%"></div></div><small>${entry.sets}</small></div>`).join('')}</div>`
    : '<div id="prog-dist" class="dist empty">No logged sets yet.</div>';
  const prs = stats.prs.length
    ? `<div id="prog-prs" class="list">${stats.prs.map((record) => `<div class="row"><div><strong>${html(record.name)}</strong><small>top ${displayWeightKg(record.topWeight, unit)} ${unit}</small></div><span class="badge muscle">${displayWeightKg(record.e1rm, unit)} ${unit} 1RM</span></div>`).join('')}</div>`
    : '<div id="prog-prs" class="list empty">No records yet.</div>';
  return `<div class="stats-hero">
    <div class="summary-stat">
      <div class="ss-val"><svg id="stat-streak-flame" class="flame ${stats.streak > 0 ? 'active' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4-2.5-7-6.5-7-11 0-3 2-5.5 4-7 .5 2.5 2 4 4 5 0-3 1.5-6 3-8 1.5 2 3 5 3 8 2-1 3.5-2.5 4-5 1.5 2.5 1 6-1 9s-5.5 5.5-10 9z"/></svg><span id="stat-streak">${stats.streak}</span></div>
      <div class="ss-label">Day streak</div>
    </div>
    <div class="summary-stat">
      <div class="ss-val"><span id="stat-sessions">${stats.totalSessions}</span></div>
      <div class="ss-label">Total sessions</div>
    </div>
    <div class="summary-stat">
      <div class="ss-val"><span id="stat-volume">${Math.round(displayWeightKg(stats.totalVolume, unit) || 0).toLocaleString()}</span><small id="stat-volume-unit" class="ss-unit">${unit}</small></div>
      <div class="ss-label">Total volume</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><span>Weekly volume</span></div>
    <div id="prog-bars" class="bars">${bars}</div>
    <div class="subsection-head"><span>Muscle distribution</span><small>by working sets</small></div>
    ${dist}
    <div class="subsection-head"><span>Personal records</span><small>best estimated 1RM (Epley)</small></div>
    ${prs}
  </div>`;
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
  return `<div class="subsection-head"><span>BMI</span><small>${bmi.toFixed(1)} · ${label}</small></div>
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
  return `<div class="subsection-head"><span>Weight trend</span><small>${n} entr${n === 1 ? 'y' : 'ies'}</small></div>
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

export function bodyView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const wd = (kg: number) => displayWeightKg(kg, unit) || 0;
  const entries = state.bodyEntries;
  let cards = '', bmi = '', chart = '', goal = '';
  let listHtml = '<div id="body-list" class="list empty">No entries yet.</div>';
  if (entries.length) {
    // Entries are newest-first; sort oldest-first for trend/average maths.
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0], latest = sorted[sorted.length - 1];
    const latestW = latest.weight_kg;
    const last7 = sorted.slice(-7);
    const avg7 = last7.reduce((sum, entry) => sum + entry.weight_kg, 0) / last7.length;
    const totalChange = latestW - first.weight_kg;
    const changeColor = totalChange > 0 ? 'var(--danger-red)' : totalChange < 0 ? 'var(--success-green)' : 'var(--muted)';
    cards = `<div class="body-cards">
      <div class="body-card"><div class="body-card-val">${wd(latestW).toFixed(1)}</div><div class="body-card-lbl">Current (${unit})</div></div>
      <div class="body-card"><div class="body-card-val">${wd(avg7).toFixed(1)}</div><div class="body-card-lbl">7-day avg</div></div>
      <div class="body-card"><div class="body-card-val" style="color:${changeColor}">${totalChange > 0 ? '+' : ''}${wd(totalChange).toFixed(1)}</div><div class="body-card-lbl">Total change</div></div>
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
      goal = `<div class="subsection-head"><span>Goal progress</span></div>
        <div class="body-goal-bar"><div class="body-goal-fill" style="width:${pct.toFixed(0)}%"></div></div>
        <div class="body-goal-labels"><span>${wd(startW).toFixed(1)} ${unit}</span><span>${remaining > 0 ? '+' : ''}${wd(remaining).toFixed(1)} ${unit} to go</span><span>${wd(targetKg).toFixed(1)} ${unit}</span></div>`;
    }
    listHtml = `<div id="body-list" class="list">${entries.map((entry) => `<div class="row"><div><strong>${wd(entry.weight_kg)} ${unit}</strong><small>${html(entry.date)}${entry.notes ? ' · ' + html(entry.notes) : ''}</small></div><button class="button danger small" data-del-body="${entry.id}">×</button></div>`).join('')}</div>`;
  }
  return `<div class="panel">
    <div class="panel-head"><span>Body weight</span><span class="section-label" id="body-unit">${unit}</span></div>
    <div id="body-empty" class="empty" style="display:${entries.length ? 'none' : ''}">No entries yet. Log your weight below to start tracking.</div>
    <div id="body-cards">${cards}</div>
    <div id="body-bmi">${bmi}</div>
    <div id="body-chart">${chart}</div>
    <div id="body-goal">${goal}</div>
    <div class="subsection-head"><span>Log weight</span></div>
    <form id="body-form" class="form-grid">
      <label>Date<input type="date" name="date" /></label>
      <label><span>Weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="weightKg" step="0.1" placeholder="e.g. 80" /></label>
      <div class="form-actions span-2"><button class="button primary" type="submit">Log weight</button></div>
    </form>
    ${listHtml}
    <div class="subsection-head"><span>Profile</span><small>for BMI &amp; goal</small></div>
    <form id="body-profile-form" class="form-grid">
      <label>Height (cm)<input type="number" name="heightCm" step="1" min="100" max="250" placeholder="e.g. 175" value="${state.settings.heightCm || ''}" /></label>
      <label><span>Target weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="targetWeightKg" step="0.1" min="0" placeholder="e.g. 75" value="${state.settings.targetWeightKg ? wd(state.settings.targetWeightKg) : ''}" /></label>
      <div class="form-actions span-2"><button class="button" type="submit">Save profile</button></div>
    </form>
  </div>`;
}
