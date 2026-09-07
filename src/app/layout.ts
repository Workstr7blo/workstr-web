import type { AppState, View } from './state';
import { settingsView } from './settings-view';
import { accountChip, accountIdentity } from './account-chip';
import { html } from './format';
import { libraryPanel } from '../features/library/views';
import { discoverPanel } from '../features/discover/views';
import { historyCalendarPanel } from '../features/train/history-calendar';
import { workoutHistory } from '../features/train/history-timeline';
import { bodyView, trainingStatsView } from '../features/progress/views';
import { quickWorkoutPanel, recoveryView } from '../features/recovery/views';
import { programCard, sheetToProgram } from '../features/sheets/views';
import { programActiveFilters, programFilterSheet, programMatcher, programToolbar, type ProgramBrowser } from '../features/sheets/program-browser';
import { exerciseFilterSheet, exerciseSelectionBar } from './exercise-browser';
import { moneroMode } from '../features/sheets/monero-tip-view';

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'workouts', label: 'Workouts', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'statistics', label: 'Statistics', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' }
];

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
        ${navItems.map((item, index) => `${index === navItems.length - 1 ? '<div class="nav-bottom">' : ''}<div class="nav-item ${state.view === item.view ? 'active' : ''}" data-view="${item.view}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span>${item.label}</span></div>${index === navItems.length - 1 ? '</div>' : ''}`).join('')}
      </div>
    </nav>
    <main class="content">
      <div id="page-host">${page}</div>
    </main>
    <div id="page-overlays">${overlays}</div>
    ${sessionOverlayMarkup(state)}
    <div id="modal" class="modal"><div class="modal-card"><button id="modal-close" class="modal-close" type="button">×</button><div id="modal-content"></div></div></div>
    <div id="toast"></div>`;
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
        <div class="session-eyebrow">Live session</div>
        <div id="session-title" class="session-title">Workout</div>
        <div class="session-meta-line"><span id="session-meta" class="session-meta">Exercise 1 of 1</span><span class="session-elapsed-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span id="session-elapsed" class="session-elapsed">00:00</span></span></div>
      </div>
      <button id="session-close" class="session-close-btn" type="button">End</button>
    </div>
    <div class="session-progress"><div id="session-progress-fill" class="session-progress-fill"></div></div>
    <div id="session-ex-nav" class="session-ex-nav"></div>
    <div id="pr-toast" class="pr-toast"></div>
    <div id="session-body" class="session-body"></div>
    <div id="session-footer" class="session-footer"></div>
    <div id="session-rest-overlay" class="session-rest-overlay">
      <div class="rest-label">Rest</div>
      <div class="rest-timer-wrap"><svg class="rest-ring" viewBox="0 0 120 120"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="rest-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="339.3" stroke-dashoffset="0"/></svg><div id="session-rest-val" class="rest-timer-val">90</div></div>
      <div id="rest-nextup" class="rest-nextup"></div>
      <div class="rest-adjust-btns"><button class="rest-adjust-btn" data-rest-adjust="-15" type="button">-15s</button><button class="rest-skip-btn" id="rest-skip" type="button">Skip Rest</button><button class="rest-adjust-btn" data-rest-adjust="15" type="button">+15s</button></div>
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
  // Lightning popularity is not Monero popularity, so the top-zapped badge is not carried
  // over to the Monero rail. Nothing replaces it: the list is ordered by name either way,
  // and zaps only ever decorated it.
  const topProgramRanks = new Map(moneroMode(state) ? [] : programs
    .map((program) => ({ address: program.address, sats: state.programZapTotals?.[program.address]?.sats || 0 }))
    .filter((entry) => entry.sats > 0)
    .sort((a, b) => b.sats - a.sats)
    .slice(0, 3)
    .map((entry, index) => [entry.address, index + 1]));
  return programs.map((program) => programCard(program, state, { showPayment: true, zapRank: topProgramRanks.get(program.address) })).join('')
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
      <div class="panel"><div class="panel-head"><span>Workout history</span></div><p class="section-help">Your training month at a glance, then every session below.</p>${historyCalendarPanel(state)}${workoutHistory(state)}</div>
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
