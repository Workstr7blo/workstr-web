import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
import { RECOVERY_BODY_SVG } from '../../app/bodymap';
import { getRecovery, type RecoveryGroup } from './recovery';

// Status hues are semantic and stay fixed; `untrained` is a theme surface, so it follows
// the token layer and turns graphite in Monero Mode.
export const RECOVERY_COLORS: Record<RecoveryGroup['status'], string> = { ready: '#00d084', partial: '#f7931a', recovering: '#ff3864', untrained: 'var(--chrome-raised)' };

const STATUS_ICONS: Record<RecoveryGroup['status'], IconName> = { ready: 'circle-check', partial: 'battery-charging', recovering: 'hourglass', untrained: 'leaf' };

function recoveryNote(group: RecoveryGroup): string {
  if (group.status === 'untrained') return 'not logged recently';
  return group.percent >= 100 ? 'recovered' : `${Math.ceil(group.hoursRemaining)}h to full`;
}

function recoveryBadge(group: RecoveryGroup): string {
  if (group.status === 'untrained') return 'Fresh';
  if (group.status === 'ready') return 'Ready';
  return `${group.percent}%`;
}

function trainedAgo(group: RecoveryGroup): string {
  if (!group.lastTrained) return '';
  const hours = Math.max(0, (Date.now() - new Date(group.lastTrained).getTime()) / 3600000);
  const ago = hours < 1 ? 'just now' : hours < 24 ? `${Math.floor(hours)}h ago` : `${Math.floor(hours / 24)}d ago`;
  return `${ago} · ${group.totalSets} ${group.totalSets === 1 ? 'set' : 'sets'}`;
}

function recoveryRows(groups: RecoveryGroup[]): string {
  return groups.map((group) => {
    const track = group.status === 'untrained'
      ? '<div class="rtrack fresh"></div>'
      : `<div class="rtrack"><div class="rfill" style="width:${group.percent}%"></div></div>`;
    return `<div class="recovery-row ${group.status}">
      <span class="rstatus">${icon(STATUS_ICONS[group.status])}</span>
      <div class="rname">${html(group.name)}<small>${html(trainedAgo(group))}</small></div>
      ${track}
      <div class="rmeta"><strong>${html(recoveryBadge(group))}</strong><small>${recoveryNote(group)}</small></div>
    </div>`;
  }).join('');
}

// The ring is data, not an interface icon, so it is drawn here rather than through icon().
// Its colour comes from the status class, keeping every fill on the token layer.
function readinessRing(percent: number): string {
  const tone = percent >= 80 ? 'ready' : percent >= 50 ? 'partial' : 'recovering';
  return `<div class="recovery-ring ${tone}">
    <svg viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle class="recovery-ring-track" cx="22" cy="22" r="18" pathLength="100"/><circle class="recovery-ring-fill" cx="22" cy="22" r="18" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - percent}" transform="rotate(-90 22 22)"/></svg>
    <span><strong id="recovery-overall">${percent}%</strong><small>ready</small></span>
  </div>`;
}

function statTile(name: IconName, value: string, label: string, tone = ''): string {
  return `<div class="recovery-stat${tone ? ` ${tone}` : ''}"><span class="recovery-stat-icon">${icon(name)}</span><span class="recovery-stat-copy"><strong>${value}</strong><small>${html(label)}</small></span></div>`;
}

function listNames(names: string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
  const tired = trained.filter((group) => group.status === 'recovering' || group.status === 'partial');
  // An untrained muscle is a ready one: nothing is fatiguing it, and Quick Workout draws
  // from it. So the readiness figures are meaningful before the first session too, and the
  // only thing that needed fixing at zero was a sentence about trained groups when there
  // are none.
  const nothingTrained = trained.length === 0;
  // The tiles already carry the count, so the sentence names what is holding readiness back.
  const statusLine = nothingTrained
    ? 'Nothing trained recently, so everything is available.'
    : !tired.length ? 'All trained groups are ready.' : `${listNames(tired.map((group) => group.name))} still ${tired.length === 1 ? 'needs' : 'need'} time.`;
  const helpLine = nothingTrained
    ? 'Finish a workout and this fills in with how recovered each muscle group is.'
    : 'Readiness from your last 10 days of training.';
  const next = [...trained].filter((group) => group.percent < 100).sort((a, b) => a.hoursRemaining - b.hoursRemaining)[0];
  const trainedSection = trained.length ? `<div class="recovery-section"><div class="recovery-section-title">${icon('activity')}<span>Recently trained</span></div>${recoveryRows(trained)}</div>` : '';
  // One block for every muscle that is simply available. These used to be a full row each -
  // name, empty track, "Fresh", "not logged recently" - which said the same thing ten times
  // over on a profile with no history.
  const freshSection = fresh.length
    ? `<div class="recovery-section fresh-section">
      <div class="recovery-fresh-summary">
        <strong>${icon('leaf')}<span>Fresh</span></strong>
        <span class="recovery-fresh-chips">${fresh.map((group) => `<span>${html(group.name)}</span>`).join('')}</span>
        <small>Not logged in the last 10 days, so available now.</small>
      </div>
    </div>`
    : '';
  return `<div class="panel recovery-panel">
    <div class="recovery-hero">
      <div class="recovery-hero-icon">${icon('heart-pulse')}</div>
      <div class="recovery-hero-copy"><span>Muscle recovery</span><p>${html(helpLine)}</p></div>
      ${readinessRing(data.overallReadiness)}
    </div>
    <div class="recovery-stats">
      ${statTile('circle-check', `<span id="recovery-ready">${data.readyCount} of ${data.totalCount}</span>`, 'groups ready', 'ready')}
      ${statTile('hourglass', String(tired.length), tired.length === 1 ? 'group recovering' : 'groups recovering', tired.length ? 'recovering' : '')}
      ${statTile('clock', next ? `${Math.ceil(next.hoursRemaining)}h` : 'Now', next ? `until ${next.name} is full` : 'all clear')}
    </div>
    <p class="recovery-status">${icon('info')}<span>${html(statusLine)}</span></p>
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
      <div id="recovery-list" class="recovery">${trainedSection}${freshSection}</div>
    </div>
    <details class="recovery-explainer"><summary>${icon('info')}<span>How this works</span>${icon('chevron-down', { class: 'recovery-explainer-chevron' })}</summary><p class="section-help">Bigger groups recover slower, and higher set volume extends recovery. A group counts as ready at 80%. Muscles not logged recently are marked Fresh so they stay available for quick workouts.</p></details>
  </div>`;
}

export function quickWorkoutPanel(state: AppState): string {
  const qw = state.qw;
  return `<div class="panel qw-panel" id="quick-workout-panel">
    <div class="recovery-hero qw-hero">
      <div class="recovery-hero-icon">${icon('zap')}</div>
      <div class="recovery-hero-copy"><span>Quick workout</span><p>Uses ready muscles. Edit before starting.</p></div>
    </div>
    <div class="qw-duration" id="qw-duration" role="group" aria-label="Workout length">
      <span class="qw-dur-label">${icon('timer')}<span>Length</span></span>
      ${[20, 30, 45, 60].map((minutes) => `<button class="qw-dur-btn ${qw.duration === minutes ? 'active' : ''}" data-qw-dur="${minutes}">${minutes}<small>min</small></button>`).join('')}
    </div>
    <button class="button primary qw-generate" id="qw-generate">${icon('sparkles')}<span>Build quick workout</span></button>
    <div id="qw-result" class="qw-result" ${qw.visible && qw.exercises.length ? '' : 'hidden'}>
      <div class="qw-meta" id="qw-meta">${icon('clipboard-list')}<span>${html(qw.meta)}</span></div>
      <div class="qw-list" id="qw-list">${qw.exercises.map((exercise, index) => {
        const hasSwap = (qw.pool[exercise.muscleGroup] || []).length > 0;
        return `<div class="qw-item">
          <span class="qw-item-index">${String(index + 1).padStart(2, '0')}</span>
          <div class="qw-item-info">
            <div class="qw-item-name">${html(exercise.name)}</div>
            <div class="qw-item-meta"><span class="qw-item-muscle">${html(exercise.muscleGroup)}</span><span>${exercise.sets} × ${html(exercise.reps)}</span></div>
          </div>
          <div class="qw-item-actions">
            ${hasSwap ? `<button class="button small qw-icon-btn" data-qw-swap="${index}" title="Swap for another ${html(exercise.muscleGroup)} exercise" aria-label="Swap ${html(exercise.name)}">${icon('shuffle')}<span class="qw-swap-label">Swap</span></button>` : ''}
            <button class="button quiet small qw-icon-btn qw-remove" data-qw-remove="${index}" title="Remove" aria-label="Remove ${html(exercise.name)}">${icon('x')}</button>
          </div>
        </div>`;
      }).join('')}</div>
      <div class="qw-actions">
        <button class="button primary" id="qw-start">${icon('play', { filled: true })}<span>Start workout</span></button>
      </div>
    </div>
  </div>`;
}
