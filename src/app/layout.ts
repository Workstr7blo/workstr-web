import type { AppState, View } from './state';
import { settingsView } from './settings-view';
import { accountChip, accountIdentity } from './account-chip';
import { html } from './format';
import { icon } from './icons';
import { libraryPanel } from '../features/library/views';
import { discoverPanel } from '../features/discover/views';
import { historyCalendarPanel } from '../features/train/history-calendar';
import { workoutHistory } from '../features/train/history-timeline';
import { bodyView, trainingStatsView } from '../features/progress/views';
import { quickWorkoutPanel, recoveryView } from '../features/recovery/views';
import { programCard, sheetToProgram } from '../features/sheets/views';
import { programActiveFilters, programFilterSheet, programMatcher, programToolbar, type ProgramBrowser } from '../features/sheets/program-browser';
import { exerciseFilterSheet, exerciseSelectionBar } from './exercise-browser';
import { tipJarNavIcon, tipJarView } from '../features/monero/tip-jar-view';
import { tipJarStatus } from '../features/monero/tip-jar-state';

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: icon('dumbbell') },
  { view: 'workouts', label: 'Workouts', icon: icon('clipboard-list') },
  { view: 'statistics', label: 'Statistics', icon: icon('chart-column') }
];

// Training destinations share one icon shape; the Tip Jar carries its own status badge.
function navItem(state: AppState, item: { view: View; label: string; icon: string }): string {
  return `<div class="nav-item ${state.view === item.view ? 'active' : ''}" data-view="${item.view}">${item.icon}<span>${item.label}</span></div>`;
}

// The whole app as one string: the frame with the current page already written into it.
// The running app mounts the frame once and writes pages into its host, so this is what the
// two produce together, and it is what the string-level view tests assert against.
export function shellMarkup(state: AppState): string {
  return shellFrame(state, appView(state), pageOverlays(state));
}

// Everything that outlives a page: the topbar, the navigation, the scroll pane, the live
// session overlay, the modal host and the toast. Mounted once. A page change writes into
// `#page-host` and `#page-overlays` and leaves the rest of this standing, which is what
// stops an avatar, a photo or an open modal being thrown away for a state change that had
// nothing to do with them.
export function shellFrame(state: AppState, page = '', overlays = ''): string {
  return `
    <div class="noise"></div>
    <div class="cyber-grid"></div>
    <header class="topbar">
      <div class="logo-zone">
        <div class="glyph"><img src="./favicon.svg" alt="" /></div>
        <div class="logo-text">
          <div class="logo-mark">Work<span>str</span></div>
          <div class="logo-tagline">sovereign training</div>
        </div>
      </div>
      <div class="topbar-actions">
        ${accountChip(accountIdentity(state))}
      </div>
    </header>
    <nav class="sidebar">
      <div class="nav-items">
        ${navItems.map((item) => navItem(state, item)).join('')}
        <div class="nav-item tip-jar-nav ${state.view === 'tipjar' ? 'active' : ''}" data-view="tipjar">${tipJarNavIcon(tipJarStatus(state))}</div>
      </div>
    </nav>
    <main class="content">
      <div id="page-host">${page}</div>
    </main>
    <div id="page-overlays">${overlays}</div>
    ${sessionOverlayMarkup(state)}
    <div id="modal" class="modal"><div class="modal-card"><button id="modal-close" class="modal-close" type="button" aria-label="Close">${icon('x')}</button><div id="modal-content"></div></div></div>
    <div id="toast"></div>
    <div id="vault-lock" class="vault-lock" hidden></div>`;
}


// Sheets and the selection bar belong to the browsing pages that open them, so they are
// written with the page rather than with the frame. They stay outside `.content` because
// they are fixed-position and the pane they would otherwise sit in scrolls.
export function pageOverlays(state: AppState): string {
  return `${programFilterSheet(state)}${exerciseFilterSheet(state)}${exerciseSelectionBar(state)}`;
}

function sessionOverlayMarkup(state: AppState): string {
  return `<div id="session-overlay" class="session-overlay ${state.activeSession ? 'open' : ''}">
    <div class="session-bg"></div>
    <div class="session-header">
      <div class="session-head-main">
        <div id="session-title" class="session-title">Workout</div>
        <div class="session-meta-line"><span id="session-meta" class="session-meta">Exercise 1 of 1</span><span class="session-elapsed-chip"><span class="session-live-dot" aria-hidden="true"></span><span class="sr-only">Live session, elapsed </span><span id="session-elapsed" class="session-elapsed">00:00</span></span></div>
      </div>
      <button id="session-close" class="session-close-btn" type="button">${icon('x')}<span>End</span></button>
    </div>
    <div class="session-progress"><div id="session-progress-fill" class="session-progress-fill"></div></div>
    <div id="session-ex-nav" class="session-ex-nav"></div>
    <div id="pr-toast" class="pr-toast"></div>
    <div id="session-body" class="session-body"></div>
    <div id="session-footer" class="session-footer"></div>
    <div id="session-rest-overlay" class="session-rest-overlay">
      <div class="rest-label">${icon('hourglass')}<span>Rest</span></div>
      <div class="rest-timer-wrap"><svg class="rest-ring" viewBox="0 0 120 120"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="rest-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="339.3" stroke-dashoffset="0"/></svg><div id="session-rest-val" class="rest-timer-val">90</div></div>
      <div id="rest-nextup" class="rest-nextup"></div>
      <div class="rest-adjust-btns"><button class="rest-adjust-btn" data-rest-adjust="-15" type="button" aria-label="Rest 15 seconds less">${icon('minus')}<span>15s</span></button><button class="rest-skip-btn" id="rest-skip" type="button">${icon('skip-forward')}<span>Skip rest</span></button><button class="rest-adjust-btn" data-rest-adjust="15" type="button" aria-label="Rest 15 seconds more">${icon('plus')}<span>15s</span></button></div>
    </div>
  </div>`;
}

// The active item is a class, not a different navigation, so it is patched. Scoped to the
// sidebar: a page can carry a `[data-view]` button of its own - Statistics offers "Go to
// Workouts" - and those are links, not navigation state.
export function updateNavigation(root: ParentNode, state: AppState): void {
  root.querySelectorAll<HTMLElement>('.sidebar [data-view]').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === state.view);
  });
}

// The current page. Everything on it is rebuilt from state, which is why replacing it
// wholesale is right where replacing the frame was not.
export function appView(state: AppState): string {
  if (state.view === 'workouts') return workoutsView(state);
  if (state.view === 'statistics') return statisticsView(state);
  if (state.view === 'tipjar') return tipJarView(state);
  if (state.view === 'settings') return settingsView(state);
  return exercisesView(state);
}

function subTabs(parent: View, active: string, tabs: string[]): string {
  return `<div class="sub-tabs">${tabs.map((tab) => {
    const value = tab.toLowerCase();
    return `<div class="sub-tab ${active === value ? 'active' : ''}" data-parent="${parent}" data-subtab="${value}">${html(tab)}</div>`;
  }).join('')}</div>`;
}

function exercisesView(state: AppState): string {
  const active = state.subState.exercises;
  return `<div class="page active" id="page-exercises">
    <div class="page-title">Exercises</div>
    ${subTabs('exercises', active, ['Library', 'Discover'])}
    <div class="sub-panel ${active === 'library' ? 'active' : ''}" id="sub-exercises-library">
      ${libraryPanel(state)}
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-exercises-discover">
      ${discoverPanel(state)}
    </div>
  </div>`;
}

// Exported because a background refresh repaints this line in place rather than through a
// page render; the fallback wording must not drift between the two.
export function programStatusLine(state: AppState): string {
  return state.programStatus || 'program relay cache not loaded yet';
}

// The cards of one program list, written on their own when a filter changes. Card clicks
// are delegated to the list element, so replacing what is inside it costs no listeners.
export function programListMarkup(context: ProgramBrowser, state: AppState): string {
  const matches = programMatcher(state);
  if (context === 'programs') {
    const locals = state.sheets.map(sheetToProgram).filter(matches);
    return locals.map((program) => programCard(program, state, { showPayment: false })).join('')
      || '<div class="empty">No programs match yet. Build one, import from Discover, or clear a filter.</div>';
  }
  const programs = state.programs.filter(matches);
  return programs.map((program) => programCard(program, state, { showPayment: true })).join('')
    || `<div class="empty">${state.programs.length ? 'No relay programs match. Refresh or clear a filter.' : 'Relay programs published by Workstr and Beast Mode creators appear here. Importing one adds a local copy to your Programs library, which is what you edit and run.'}</div>`;
}

function workoutsView(state: AppState): string {
  const active = state.subState.workouts;
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      ${programToolbar('programs', state)}
      ${programActiveFilters('programs', state)}
      <div class="program-list" id="programs-list">${programListMarkup('programs', state)}</div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      ${programToolbar('discover', state)}
      ${programActiveFilters('discover', state)}
      <div id="program-status" class="terminal-mini">${html(programStatusLine(state))}</div>
      <div class="program-list" id="program-discover-list">${programListMarkup('discover', state)}</div>
    </div>
    <div class="sub-panel ${active === 'history' ? 'active' : ''}" id="sub-workouts-history">
      <div class="panel history-panel"><div class="history-hero"><div class="history-hero-icon">${icon('clipboard-list')}</div><div class="history-hero-copy"><span>Training history</span><p>Month rhythm, session receipts, and repeatable workouts.</p></div></div>${historyCalendarPanel(state)}${workoutHistory(state)}</div>
    </div>
    <div class="sub-panel ${active === 'recovery' ? 'active' : ''}" id="sub-workouts-recovery">
      ${recoveryView(state)}
      ${quickWorkoutPanel(state)}
    </div>
  </div>`;
}

function statisticsView(state: AppState): string {
  const active = state.subState.statistics;
  return `<div class="page active" id="page-statistics">
    <div class="page-title">Statistics</div>
    ${subTabs('statistics', active, ['Training', 'Body'])}
    <div class="sub-panel ${active === 'training' ? 'active' : ''}" id="sub-statistics-training">
      ${trainingStatsView(state)}
    </div>
    <div class="sub-panel ${active === 'body' ? 'active' : ''}" id="sub-statistics-body">
      ${bodyView(state)}
    </div>
  </div>`;
}
