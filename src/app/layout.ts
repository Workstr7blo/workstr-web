import type { AppState, View } from './state';
import { displayIdentity, exerciseFilterValues, html } from './format';
import { APP_VERSION } from './version';
import { countdownAudioState } from '../features/train/countdown-audio';
import { supportPanel } from '../features/support/views';
import { isFreeEquipment, ownedEquipmentKeys } from '../core/equipment';
import { normalizeWeightUnit } from '../core/units';
import { hasNip07 } from '../signer/nip07';
import { libraryPanel } from '../features/library/views';
import { discoverPanel } from '../features/discover/views';
import { historyCalendarPanel } from '../features/train/history-calendar';
import { workoutHistory } from '../features/train/history-timeline';
import { bodyView, trainingStatsView } from '../features/progress/views';
import { quickWorkoutPanel, recoveryView } from '../features/recovery/views';
import { programCard, sheetToProgram } from '../features/sheets/views';
import { backupPanel } from '../features/backup/views';

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'workouts', label: 'Workouts', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'statistics', label: 'Statistics', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' }
];

export function shellMarkup(state: AppState): string {
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
        <button class="connection-chip ${state.pubkey ? 'ok' : ''}" id="account-chip" type="button" title="Open settings" aria-label="Open settings">
          <span class="connection-chip-main">
            <span class="connection-chip-label">Account</span>
            <span class="connection-chip-status">
              <span class="connection-dot"></span>
              <span class="connection-chip-text">${state.pubkey ? html(displayIdentity(state)) : 'Local — this device'}</span>
            </span>
          </span>
          <svg class="connection-chip-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </header>
    <nav class="sidebar">
      <div class="nav-items">
        ${navItems.map((item, index) => `${index === navItems.length - 1 ? '<div class="nav-bottom">' : ''}<div class="nav-item ${state.view === item.view ? 'active' : ''}" data-view="${item.view}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span>${item.label}</span></div>${index === navItems.length - 1 ? '</div>' : ''}`).join('')}
      </div>
    </nav>
    <main class="content">
      ${appView(state)}
    </main>
    ${sessionOverlayMarkup(state)}
    <div id="modal" class="modal"><div class="modal-card"><button id="modal-close" class="modal-close" type="button">×</button><div id="modal-content"></div></div></div>
    <div id="toast"></div>`;
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

function appView(state: AppState): string {
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

function workoutsView(state: AppState): string {
  const active = state.subState.workouts;
  const query = state.programFilter.toLowerCase();
  const programMatches = (program: { name: string; description: string; difficulty?: string; tags: string[] }) => [program.name, program.description, program.difficulty || '', ...program.tags].join(' ').toLowerCase().includes(query);
  const locals = state.sheets.map(sheetToProgram).filter(programMatches);
  const programs = state.programs.filter(programMatches);
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      <div class="panel"><div class="panel-head"><span>Programs</span><button class="button primary small" id="new-program">+ New program</button></div><p class="section-help">Your local program library: routines you created here or imported from Discover. Relay-only programs stay in Discover until you import them.</p><div class="filter-bar"><input class="grow" id="program-filter" placeholder="Search programs..." autocomplete="off" value="${html(state.programFilter)}" /></div><div class="program-list">${locals.map((program) => programCard(program, state)).join('') || '<div class="empty">No programs in your library yet. Build one or import from Discover.</div>'}</div></div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      <div class="panel"><div class="panel-head"><span>Discover programs</span><button class="button ghost small" id="program-discover-refresh" type="button">Refresh</button></div><p class="section-help">Relay programs published by Workstr. Import a program to add a local copy to your Programs library before editing or running it.</p><div class="filter-bar"><input class="grow" id="program-discover-filter" placeholder="Search relay programs..." autocomplete="off" value="${html(state.programFilter)}" /></div><div class="terminal-mini">${html(state.programStatus || 'program relay cache not loaded yet')}</div><div class="program-list">${programs.map((program) => programCard(program, state)).join('') || '<div class="empty">No relay programs loaded yet. Tap Refresh.</div>'}</div></div>
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

// Kit options come from the library plus the Workstr catalog, so equipment can
// be ticked before any exercise using it has been imported.
function equipmentRows(state: AppState): string {
  const options = exerciseFilterValues([...state.library, ...state.discoverExercises]).equipment
    .filter((item) => !isFreeEquipment(item.key));
  const owned = new Set(ownedEquipmentKeys(state.settings.ownedEquipment));
  if (!options.length) {
    return `<div class="settings-row-main"><div><strong>Equipment</strong><small>No equipment listed yet. Import exercises from Discover and equipment appears here.</small></div><span class="status-pill">0 selected</span></div>`;
  }
  const boxes = options.map((item) => `<label class="equip-option"><input type="checkbox" class="equip-toggle" value="${html(item.key)}" ${owned.has(item.key) ? 'checked' : ''} />${html(item.label)}</label>`).join('');
  return `<details class="settings-details equipment-details">
    <summary><span>Equipment</span><strong>${owned.size} selected</strong></summary>
    <p class="section-help">Choose available equipment so Quick Workout avoids exercises you cannot do. Bodyweight exercises are always available.</p>
    <div class="equip-options">${boxes}</div>
  </details>`;
}

function settingsView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const keyLine = state.signerType === 'local' ? 'Device-managed key for faster sync.' : 'Keys stay in your signer.';
  const account = state.pubkey
    ? `<div class="settings-row-main account-row"><div><strong>${html(displayIdentity(state))}</strong><small>${html(keyLine)}</small></div><div class="settings-row-actions"><button id="sign-out-settings" class="button ghost">Sign out</button><button id="remove-account-data" class="button ghost">Remove data</button></div></div>`
    : `<div class="settings-row-main account-row"><div><strong>Local only</strong><small>Use Workstr now, add encrypted sync when ready.</small></div><div class="settings-row-actions"><button id="create-account-settings" class="button primary">Create sync account</button><button id="restore-account-settings" class="button ghost">Restore account</button><button id="sign-in-settings" class="button ghost">Signer options</button>${hasNip07() ? '<button id="sign-in-nip07" class="button ghost">Use extension</button>' : ''}</div></div>`;
  const relay = state.settings.workstrRelay || 'default Workstr relay';
  const signerType = state.signerType || (state.pubkey ? 'unknown' : 'none');
  return `<div class="page active settings-page"><div class="page-title">Settings</div>
    <div class="panel settings-card account-card"><div class="panel-head"><span>Account</span><span class="status-pill ${state.pubkey ? 'ok' : ''}">${state.pubkey ? 'signed in' : 'local'}</span></div>${account}</div>
    ${backupPanel({ signedIn: Boolean(state.pubkey), enabled: Boolean(state.settings.backup?.enabled), sync: state.backup, backup: state.settings.backup })}
    <div class="panel settings-card training-preferences-card">
      <div class="panel-head"><span>Training Preferences</span></div>
      <div class="settings-row-main"><div><strong>Weight unit</strong><small>Weights are stored in kilograms and converted for display.</small></div><label class="compact-select"><select id="unit-select"><option value="kg" ${unit === 'kg' ? 'selected' : ''}>Kilograms</option><option value="lbs" ${unit === 'lbs' ? 'selected' : ''}>Pounds</option></select></label></div>
      ${equipmentRows(state)}
    </div>
    ${supportPanel(state.support)}
    <details class="panel settings-card advanced-settings">
      <summary><span>Advanced</span><small>Diagnostics, relay, signer, and technical state</small></summary>
      <div class="terminal-mini">version: ${html(APP_VERSION)}\nsecure context: ${window.isSecureContext}\ncountdown audio: ${html(countdownAudioState())}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'local (this device only)')}\nsigner type: ${html(signerType)}\nrelay: ${html(relay)}\n${state.signInStatus ? html(state.signInStatus) : ''}</div>
    </details>
  </div>`;
}
