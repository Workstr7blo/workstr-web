import { displayWeightKg, normalizeWeightUnit, type WeightUnit } from '../../core/units';
import { dateKeyFromDate, dateLabel, isDateKey, relativeDayLabel, type DateKey } from '../../core/dates';
import type { ActiveSession, AppState } from '../../app/state';
import { formatSessionDate, html } from '../../app/format';
import { paintBodyMapSvg } from '../../app/bodymap';
import { groupSessionsForTimeline, sessionsOnDay, type HistoryDayGroup } from './history-model';
import { sessionDetail, sessionDuration, sessionMuscleGroupNames, sessionMuscleSets, workoutVolume } from './views';

function sessionCard(session: ActiveSession, state: AppState, unit: WeightUnit): string {
  const doneSets = session.sets.filter((set) => set.done);
  const volume = workoutVolume(session);
  const exerciseCount = new Set(doneSets.map((set) => set.exerciseSlug)).size || session.exercises.length;
  const meta = [formatSessionDate(session.finishedAt || session.startedAt), sessionDuration(session)].filter(Boolean).join(' · ');
  const volumeLabel = volume > 0 ? `${Math.round(displayWeightKg(volume, unit) || 0)} ${unit}` : '';
  const stats = [
    `${doneSets.length} set${doneSets.length === 1 ? '' : 's'}`,
    `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`,
    volumeLabel ? `${volumeLabel} volume` : ''
  ].filter(Boolean).map((item) => `<span class="history-stat-pill">${html(item)}</span>`).join('');
  const groups = sessionMuscleGroupNames(session, state.exercises);
  const { primary, secondary } = sessionMuscleSets(session, state.exercises);
  const map = paintBodyMapSvg(primary, secondary);
  const expanded = state.expandedSessionId === session.id;
  return `<div class="workout-card history-session-card ${expanded ? 'expanded' : ''}" data-session="${session.id}">
    <div class="workout-card-header" data-toggle-session="${session.id}">
      <div class="workout-card-map ${map ? 'has-map' : ''}" data-session-map="${session.id}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'}</div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(session.sheetName || 'Freestyle')}</div>
        <div class="workout-card-meta">${meta}</div>
        <div class="history-stat-row">${stats}</div>
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(' · '))}</div>` : ''}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body" data-session-body="${session.id}">${expanded ? sessionDetail(session, unit, Boolean(state.pubkey), state.publishingSessionId === session.id, state.publishingStatus || 'Waiting for signer...') : ''}</div>
  </div>`;
}

function groupHeading(key: DateKey, todayKey: DateKey, sessionCount: number): string {
  const count = sessionCount > 1 ? `<span class="history-group-count">${sessionCount} workouts</span>` : '';
  return `<div class="history-group-head"><h4>${html(relativeDayLabel(key, todayKey))}</h4>${count}</div>`;
}

function renderGroups(groups: HistoryDayGroup[], state: AppState, unit: WeightUnit, todayKey: DateKey): string {
  return groups.map((group) => `<div class="history-group" data-history-group="${group.key}">
    ${groupHeading(group.key, todayKey, group.sessions.length)}
    <div class="program-list">${group.sessions.map((session) => sessionCard(session, state, unit)).join('')}</div>
  </div>`).join('');
}

export function workoutHistory(state: AppState, now?: Date): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  if (!state.finishedSessions.length) return '<div class="list empty">No completed sessions yet. Finish a workout to see it here.</div>';
  const todayKey = dateKeyFromDate(now || new Date());
  const selected = isDateKey(state.history.selectedDate) ? state.history.selectedDate : null;

  if (selected) {
    // Only the selected day is built, so a long history costs nothing to filter: no cards
    // are rendered and no handlers are bound for the days you are not looking at.
    const sessions = sessionsOnDay(state.finishedSessions, selected);
    const heading = `<div class="history-filter">
      <div class="history-filter-text">
        <b>${html(relativeDayLabel(selected, todayKey))}</b>
        <span>${sessions.length ? `${sessions.length} workout${sessions.length === 1 ? '' : 's'} on ${html(dateLabel(selected))}` : `Nothing logged on ${html(dateLabel(selected))}`}</span>
      </div>
      <button class="button ghost small" id="history-clear-filter" type="button">Show all</button>
    </div>`;
    const body = sessions.length
      ? `<div id="history-list">${renderGroups([{ key: selected, sessions }], state, unit, todayKey)}</div>`
      : '<div class="list empty">No workouts on this day. Pick another, or show all.</div>';
    return `${heading}${body}`;
  }

  const groups = groupSessionsForTimeline(state.finishedSessions);
  const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const count = `<div class="history-count">${total} workout${total === 1 ? '' : 's'} logged across ${groups.length} day${groups.length === 1 ? '' : 's'}</div>`;
  return `${count}<div id="history-list">${renderGroups(groups, state, unit, todayKey)}</div>`;
}
