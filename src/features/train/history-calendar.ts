import { html } from '../../app/format';
import { dateLabel, isDateKey, type DateKey } from '../../core/dates';
import type { AppState } from '../../app/state';
import { buildHistoryModel, type HistoryCell, type HistoryModel } from './history-model';

// Monday-first, matching core/dates. Headers are decorative: every day button carries its
// own full date in its accessible name, so a screen reader never needs the column.
const WEEKDAY_INITIALS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function dayAccessibleLabel(cell: HistoryCell, selected: boolean): string {
  const parts = [dateLabel(cell.key)];
  if (cell.day) {
    const { sessionCount, setCount } = cell.day;
    parts.push(`${sessionCount} workout${sessionCount === 1 ? '' : 's'}, ${setCount} set${setCount === 1 ? '' : 's'}`);
  } else {
    parts.push('no workout');
  }
  if (cell.isToday) parts.push('today');
  if (selected) parts.push('selected');
  return parts.join(', ');
}

// Intensity reads three ways, so colour is never the only channel: a dot count, a data
// attribute for CSS, and the workout/set counts in the accessible name.
function intensityDots(count: 1 | 2 | 3): string {
  return `<span class="history-cal-dots" aria-hidden="true">${'<i></i>'.repeat(count)}</span>`;
}

function dayCell(cell: HistoryCell, selectedDate: DateKey | null): string {
  if (!cell.inMonth) return '<span class="history-cal-day pad" aria-hidden="true"></span>';
  const selected = selectedDate === cell.key;
  const classes = ['history-cal-day'];
  if (cell.day) classes.push('done');
  if (cell.isToday) classes.push('today');
  if (selected) classes.push('selected');
  if (cell.isFuture) classes.push('future');
  // Dots and the session count share one row below the date. A corner badge collides with
  // the date at the ~31px cells a 320px phone gives you.
  const badge = cell.day && cell.day.sessionCount > 1
    ? `<span class="history-cal-count" aria-hidden="true">×${cell.day.sessionCount}</span>`
    : '';
  const marks = cell.day
    ? `<span class="history-cal-marks">${intensityDots(cell.day.intensity as 1 | 2 | 3)}${badge}</span>`
    : '';
  // Days with nothing to open stay in the layout but out of the tab order, so tabbing the
  // calendar walks the workouts rather than every square. They keep their accessible name,
  // so a reader browsing the grid still hears "no workout". Selecting a future day is
  // inert by construction: this release never schedules anything.
  const attributes = [
    `class="${classes.join(' ')}"`,
    `data-history-date="${cell.key}"`,
    `data-intensity="${cell.day?.intensity ?? 0}"`,
    `aria-label="${html(dayAccessibleLabel(cell, selected))}"`,
    cell.isToday ? 'aria-current="date"' : '',
    cell.day ? `aria-pressed="${selected}"` : '',
    cell.isFuture || !cell.day ? 'disabled' : '',
    'type="button"'
  ].filter(Boolean).join(' ');
  return `<button ${attributes}><span class="history-cal-num">${cell.dayOfMonth}</span>${marks}</button>`;
}

function summaryCards(model: HistoryModel): string {
  const { workoutsInMonth, activeWeekStreak, daysSinceLatest } = model.summary;
  const monthName = model.monthLabel.split(' ')[0];
  const cards = [
    {
      value: String(workoutsInMonth),
      label: `workout${workoutsInMonth === 1 ? '' : 's'} in ${monthName}`
    },
    {
      value: String(activeWeekStreak),
      label: `active week${activeWeekStreak === 1 ? '' : 's'} in a row`
    },
    {
      value: daysSinceLatest == null ? '—' : String(daysSinceLatest),
      label: daysSinceLatest == null
        ? 'no workout logged yet'
        : daysSinceLatest === 0 ? 'you trained today' : `day${daysSinceLatest === 1 ? '' : 's'} since your last workout`
    }
  ];
  return `<div class="history-cards">${cards.map((card) => `<div class="history-card">
    <div class="history-card-value">${html(card.value)}</div>
    <div class="history-card-label">${html(card.label)}</div>
  </div>`).join('')}</div>`;
}

// State-facing entry point. The model is rebuilt on every render, which is cheap next to
// the root rerender the shell already does and keeps the calendar honest after a session is
// completed or deleted.
export function historyCalendarPanel(state: AppState, now?: Date): string {
  const selected = isDateKey(state.history.selectedDate) ? state.history.selectedDate : null;
  const model = buildHistoryModel(state.finishedSessions, { monthKey: state.history.monthKey, now });
  return historyCalendar(model, selected, state.finishedSessions.length > 0);
}

export function historyCalendar(model: HistoryModel, selectedDate: DateKey | null, hasHistory: boolean): string {
  const grid = model.weeks.map((week) =>
    `<div class="history-cal-week">${week.map((cell) => dayCell(cell, selectedDate)).join('')}</div>`
  ).join('');
  const empty = hasHistory ? '' : '<p class="history-cal-empty">No workouts yet. Finish a session and the day it lands on fills in here.</p>';
  return `<div class="history-calendar" id="history-calendar">
    <div class="history-cal-head">
      <button class="history-cal-nav" data-history-month="prev" type="button" aria-label="Previous month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>
      </button>
      <div class="history-cal-title" aria-live="polite">${html(model.monthLabel)}</div>
      <button class="history-cal-nav" data-history-month="next" type="button" aria-label="Next month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
      </button>
      <button class="history-cal-today" data-history-month="today" type="button" aria-label="Go to the current month">Today</button>
    </div>
    <div class="history-cal-grid" role="group" aria-label="Workout calendar for ${html(model.monthLabel)}">
      <div class="history-cal-week history-cal-weekdays" aria-hidden="true">${WEEKDAY_INITIALS.map((day) => `<span>${day}</span>`).join('')}</div>
      ${grid}
    </div>
    ${empty}
    ${summaryCards(model)}
  </div>`;
}
