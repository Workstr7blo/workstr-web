import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { RECOVERY_BODY_SVG } from '../../app/bodymap';
import { getRecovery, type RecoveryGroup } from './recovery';

// Status hues are semantic and stay fixed; `untrained` is a theme surface, so it follows
// the token layer and turns graphite in Monero Mode.
export const RECOVERY_COLORS: Record<RecoveryGroup['status'], string> = { ready: '#00d084', partial: '#f7931a', recovering: '#ff3864', untrained: 'var(--chrome-raised)' };

function recoveryNote(group: RecoveryGroup): string {
  if (group.status === 'untrained') return 'not logged recently';
  return group.percent >= 100 ? 'fully recovered' : `${group.hoursRemaining}h to full`;
}

function recoveryBadge(group: RecoveryGroup): string {
  if (group.status === 'untrained') return 'Fresh';
  if (group.status === 'ready') return 'Ready';
  return `${group.percent}%`;
}

function recoveryRows(groups: RecoveryGroup[]): string {
  return groups.map((group) => {
    const track = group.status === 'untrained'
      ? '<div class="rtrack fresh"></div>'
      : `<div class="rtrack"><div class="rfill" style="width:${group.percent}%"></div></div>`;
    return `<div class="recovery-row ${group.status}">
      <div class="rname">${html(group.name)}</div>
      ${track}
      <div class="rmeta"><strong>${html(recoveryBadge(group))}</strong><small>${recoveryNote(group)}</small></div>
    </div>`;
  }).join('');
}

const RECOVERY_LABEL_TEXT = (x: number, label: string) => `<text x="${x}" y="225" text-anchor="middle" font-size="6" font-family="Jost,sans-serif" fill="#c0a880" letter-spacing="1.5" font-weight="600">${label}</text>`;

export function recoveryBodySvg(byMuscle: Record<string, RecoveryGroup>): string {
  return RECOVERY_BODY_SVG.replace(/<polygon([^>]*data-muscle="([^"]+)"[^>]*)>/g, (_match, attrs: string, muscle: string) => {
    const cleanAttrs = attrs.replace(/\s*\/$/, '');
    const status = byMuscle[muscle]?.status || 'untrained';
    return `<polygon${cleanAttrs} style="fill:${RECOVERY_COLORS[status]}"/>`;
  })
    .replace('<svg ', '<svg id="recovery-body" ')
    .replace('<!-- FRONT (anterior) -->', `<!-- FRONT (anterior) -->\n${RECOVERY_LABEL_TEXT(50, 'FRONT')}`)
    .replace('<!-- BACK (posterior) -->', `<!-- BACK (posterior) -->\n${RECOVERY_LABEL_TEXT(180, 'BACK')}`);
}

export function recoveryView(state: AppState): string {
  const data = getRecovery(state.finishedSessions, state.exercises);
  const byMuscle: Record<string, RecoveryGroup> = {};
  for (const group of data.muscleGroups) byMuscle[group.name] = group;
  const order: Record<RecoveryGroup['status'], number> = { recovering: 0, partial: 1, ready: 2, untrained: 3 };
  const sorted = [...data.muscleGroups].sort((a, b) => (order[a.status] - order[b.status]) || a.percent - b.percent);
  const trained = sorted.filter((group) => group.status !== 'untrained');
  const fresh = sorted.filter((group) => group.status === 'untrained');
  const statusLine = data.readyCount === data.totalCount ? 'All trained groups are ready.' : `${data.readyCount} of ${data.totalCount} groups ready.`;
  const trainedSection = trained.length ? `<div class="recovery-section"><div class="recovery-section-title">Recently trained</div>${recoveryRows(trained)}</div>` : '';
  // One line for every muscle that is simply available. These used to be a full row each -
  // name, empty track, "Fresh", "not logged recently" - which said the same thing ten times
  // over on a profile with no history.
  const freshSection = fresh.length
    ? `<div class="recovery-section fresh-section">
      <div class="recovery-fresh-summary">
        <strong>Fresh</strong>
        <span>${fresh.map((group) => html(group.name)).join(' · ')}</span>
        <small>Not logged in the last 10 days, so available now.</small>
      </div>
    </div>`
    : '';
  // Nothing trained means the readiness figures have nothing behind them: `overallReadiness`
  // falls back to a literal 100 and `readyCount` counts untrained groups as ready, so the
  // header would claim full recovery from no data. Report the absence instead of the numbers.
  const nothingTrained = trained.length === 0;
  const summary = nothingTrained
    ? `<div class="recovery-first-run">
      <strong>No training logged yet</strong>
      <p>Finish a workout and this shows how recovered each muscle group is, so you know what is ready to train next.</p>
      <button class="button primary" data-parent="workouts" data-subtab="programs" type="button">Pick a program</button>
    </div>`
    : `<div class="recovery-summary">
      <strong><span id="recovery-ready">${data.readyCount} of ${data.totalCount}</span> ready</strong>
      <small>${html(statusLine)}</small>
    </div>
    <p class="section-help">Readiness from your last 10 days of training.</p>`;
  return `<div class="panel recovery-panel">
    <div class="panel-head"><span>Muscle recovery</span>${nothingTrained ? '' : `<strong id="recovery-overall">${data.overallReadiness}%</strong>`}</div>
    ${summary}
    <div class="recovery-layout compact">
      <div class="recovery-map">
        ${recoveryBodySvg(byMuscle)}
        <div class="recovery-legend">
          <span class="rl ready">Ready</span>
          <span class="rl partial">Partial</span>
          <span class="rl recovering">Recovering</span>
          <span class="rl untrained">Fresh</span>
        </div>
        <div id="recovery-tip" class="recovery-tip" hidden></div>
      </div>
      <div id="recovery-list" class="recovery">${nothingTrained ? '' : `${trainedSection}${freshSection}`}</div>
    </div>
    <details class="recovery-explainer"><summary>How this works</summary><p class="section-help">Bigger groups recover slower, and higher set volume extends recovery. Muscles not logged recently are marked Fresh so they stay available for quick workouts.</p></details>
  </div>`;
}

export function quickWorkoutPanel(state: AppState): string {
  const qw = state.qw;
  return `<div class="panel" id="quick-workout-panel">
    <div class="panel-head"><span>Quick workout</span>
      <div class="qw-duration" id="qw-duration">
        ${[20, 30, 45, 60].map((minutes) => `<button class="qw-dur-btn ${qw.duration === minutes ? 'active' : ''}" data-qw-dur="${minutes}">${minutes}</button>`).join('')}
        <span class="qw-dur-unit">min</span>
      </div>
    </div>
    <p class="section-help">Uses ready muscles. Edit before starting.</p>
    <button class="button primary" id="qw-generate" style="width:100%">Build quick workout</button>
    <div id="qw-result" class="qw-result" ${qw.visible && qw.exercises.length ? '' : 'hidden'}>
      <div class="qw-meta" id="qw-meta">${html(qw.meta)}</div>
      <div class="qw-list" id="qw-list">${qw.exercises.map((exercise, index) => {
        const hasSwap = (qw.pool[exercise.muscleGroup] || []).length > 0;
        return `<div class="qw-item">
          <div class="qw-item-info">
            <div class="qw-item-name">${html(exercise.name)}</div>
            <div class="qw-item-meta">${html(exercise.muscleGroup)} · ${exercise.sets} × ${html(exercise.reps)}</div>
          </div>
          <div class="qw-item-actions">
            ${hasSwap ? `<button class="button small" data-qw-swap="${index}">Swap</button>` : ''}
            <button class="button quiet small" data-qw-remove="${index}" title="Remove">✕</button>
          </div>
        </div>`;
      }).join('')}</div>
      <div class="qw-actions">
        <button class="button primary" id="qw-start">Start workout</button>
      </div>
    </div>
  </div>`;
}
