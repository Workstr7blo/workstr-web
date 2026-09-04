import type { AppState, View } from './state';
import { displayIdentity, exerciseFilterValues, html } from './format';
import { APP_VERSION } from './version';
import { countdownAudioState } from '../features/train/countdown-audio';
import { supportPanel } from '../features/support/views';
import { paymentModeCard } from '../features/support/payment-mode-views';
import { moneroMark } from '../features/sheets/monero-tip-view';
import { isFreeEquipment, ownedEquipmentKeys } from '../core/equipment';
import { normalizePaymentMode } from '../core/types';
import { normalizeWeightUnit } from '../core/units';
import { hasNip07 } from '../signer/nip07';
import { libraryPanel } from '../features/library/views';
import { discoverPanel } from '../features/discover/views';
import { historyCalendarPanel } from '../features/train/history-calendar';
import { workoutHistory } from '../features/train/history-timeline';
import { bodyView, trainingStatsView } from '../features/progress/views';
import { quickWorkoutPanel, recoveryView } from '../features/recovery/views';
import { programCard, sheetToProgram } from '../features/sheets/views';
import { programActiveFilters, programFilterSheet, programMatcher, programToolbar } from '../features/sheets/program-browser';
import { exerciseFilterSheet, exerciseSelectionBar } from './exercise-browser';
import { beastModeSettingsCard } from '../features/sheets/beast-mode';
import { moneroMode } from '../features/sheets/monero-tip-view';
import { backupPanel } from '../features/backup/views';
import { redactNwcSecrets } from '../nostr/nwc';

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'workouts', label: 'Workouts', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'statistics', label: 'Statistics', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' }
];

export function shellMarkup(state: AppState): string {
  const identity = displayIdentity(state);
  const initial = identity.trim().slice(0, 1).toUpperCase() || 'W';
  // The image must stay immediately before its fallback: the `onerror` handler reaches the
  // fallback through `nextElementSibling`, so anything inserted between them breaks a broken
  // avatar into a blank hole. The signed-in badge therefore goes last, after the fallback.
  const avatarFace = state.pubkey && state.profilePicture
    ? `<img class="connection-avatar" src="${html(state.profilePicture)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="connection-avatar fallback" hidden>${html(initial)}</span>`
    : `<span class="connection-avatar fallback">${html(initial)}</span>`;
  const avatar = `<span class="connection-avatar-wrap">${avatarFace}${state.pubkey ? '<span class="connection-identity-status" role="img" aria-label="Signed in"></span>' : ''}</span>`;
  const status = state.pubkey
    ? ''
    : '<span class="connection-chip-status"><span class="connection-dot"></span><span class="connection-chip-text">Local</span></span>';
  // Two separate states share the pill: the badge on the avatar answers "is my identity
  // connected", the medallion answers "which rail pays creators". Signed out, the rail is
  // not actionable and the chip already carries a second line, so only the badge is dropped.
  const monero = normalizePaymentMode(state.settings.paymentMode) === 'monero';
  const paymentLabel = monero ? 'Monero payments' : 'Lightning payments';
  const paymentMark = state.pubkey
    ? `<span class="connection-payment-mark" role="img" aria-label="${paymentLabel}" title="${monero ? 'Monero' : 'Lightning'} payment mode">${monero ? moneroMark(13) : '₿'}</span>`
    : '';
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
          ${avatar}
          <span class="connection-chip-main">
            <span class="connection-chip-label">${state.pubkey ? html(identity) : 'Account'}</span>
            ${status}
          </span>
          ${paymentMark}
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
    ${programFilterSheet(state)}
    ${exerciseFilterSheet(state)}
    ${exerciseSelectionBar(state)}
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
  const programMatches = programMatcher(state);
  const locals = state.sheets.map(sheetToProgram).filter(programMatches);
  const programs = state.programs.filter(programMatches);
  // Lightning popularity is not Monero popularity, so the top-zapped badge is not carried
  // over to the Monero rail. Nothing replaces it: the list is ordered by name either way,
  // and zaps only ever decorated it.
  const topProgramRanks = new Map(moneroMode(state) ? [] : programs
    .map((program) => ({ address: program.address, sats: state.programZapTotals?.[program.address]?.sats || 0 }))
    .filter((entry) => entry.sats > 0)
    .sort((a, b) => b.sats - a.sats)
    .slice(0, 3)
    .map((entry, index) => [entry.address, index + 1]));
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      ${programToolbar('programs', state)}
      ${programActiveFilters('programs', state)}
      <div class="program-list">${locals.map((program) => programCard(program, state, { showPayment: false })).join('') || '<div class="empty">No programs match yet. Build one, import from Discover, or clear a filter.</div>'}</div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      ${programToolbar('discover', state)}
      ${programActiveFilters('discover', state)}
      <div class="terminal-mini">${html(state.programStatus || 'program relay cache not loaded yet')}</div>
      <div class="program-list">${programs.map((program) => programCard(program, state, { showPayment: true, zapRank: topProgramRanks.get(program.address) })).join('') || `<div class="empty">${state.programs.length ? 'No relay programs match. Refresh or clear a filter.' : 'Relay programs published by Workstr and Beast Mode creators appear here. Importing one adds a local copy to your Programs library, which is what you edit and run.'}</div>`}</div>
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
  return `<div class="settings-inline-section equipment-details">
    <div class="settings-inline-heading"><span><strong>Equipment</strong><small>Used for Quick Workout suggestions.</small></span><span class="status-pill">${owned.size} selected</span></div>
    <div class="equip-options">${boxes}</div>
  </div>`;
}

function nwcWalletRows(state: AppState): string {
  const detail = state.nwc.message || (state.nwc.active
    ? `${state.nwc.walletLabel || 'Wallet connected'}${state.nwc.relayLabel ? ` · ${state.nwc.relayLabel}` : ''}`
    : 'Paste the NWC string from your wallet. Workstr validates it before saving.');
  return `<div class="settings-row-main nwc-wallet-row">
    <div><strong>Zap wallet (NWC)</strong><small>${html(redactNwcSecrets(detail))}</small></div>
    <div class="settings-row-actions">
      <button id="nwc-connect" class="button ${state.nwc.active ? '' : 'payment'}">${state.nwc.active ? 'Replace wallet' : 'Connect wallet'}</button>
      ${state.nwc.active ? '<button id="nwc-disconnect" class="button quiet">Disconnect</button>' : ''}
    </div>
  </div>`;
}

function settingsView(state: AppState): string {
  const nwc = state.nwc ?? { active: false, status: 'idle' as const };
  const unit = normalizeWeightUnit(state.settings.unit);
  const keyLine = state.signerType === 'local' ? 'Device-managed key for faster sync.' : 'Keys stay in your signer.';
  const accountSummary = state.pubkey ? `Signed in · ${displayIdentity(state)}` : 'Local only';
  const initial = displayIdentity(state).trim().slice(0, 1).toUpperCase() || 'W';
  const accountAvatar = state.profilePicture
    ? `<img class="settings-account-avatar" src="${html(state.profilePicture)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="settings-account-avatar fallback" hidden>${html(initial)}</span>`
    : `<span class="settings-account-avatar fallback">${html(initial)}</span>`;
  const account = state.pubkey
    ? `<div class="settings-row-main account-row"><div class="settings-account-identity">${accountAvatar}<span><strong>${html(displayIdentity(state))}</strong><small>${html(keyLine)}</small></span></div><div class="settings-row-actions"><button id="sign-out-settings" class="button small">Sign out</button><button id="remove-account-data" class="button quiet danger small">Remove data</button></div></div>`
    : `<div class="settings-row-main account-row"><div><strong>Local only</strong><small>Use Workstr now, add encrypted sync when ready.</small></div><div class="settings-row-actions"><button id="sign-in-settings" class="button primary">Account</button></div></div>`;
  const relay = state.settings.workstrRelay || 'default Workstr relay';
  const signerType = state.signerType || (state.pubkey ? 'unknown' : 'none');
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  // Monero Mode replaces the wallet layer rather than adding to it: an NWC connection is a
  // Lightning instrument, and offering to connect one while creator support is on Monero
  // would be an invitation to pay over a rail this mode has switched off. The stored
  // connection is untouched — picking Lightning again brings the card back as it was.
  const moneroMode = normalizePaymentMode(state.settings.paymentMode) === 'monero';
  const nwcCard = moneroMode ? '' : `<details class="settings-category nwc-card">
      <summary><span class="settings-category-copy"><strong>Zap wallet</strong><small>${nwc.active ? html(nwc.walletLabel || 'Wallet connected') : 'Not connected'}</small></span><span class="status-pill ${nwc.active ? 'ok' : ''}">${nwc.active ? 'ACTIVE' : 'OFF'}</span></summary>
      <div class="settings-category-body">${nwcWalletRows({ ...state, nwc })}</div>
    </details>`;
  return `<div class="page active settings-page"><div class="page-title">Settings</div>
    <details class="settings-category account-card">
      <summary><span class="settings-category-copy"><strong>Account</strong><small>${html(accountSummary)}</small></span><span class="status-pill ${state.pubkey ? 'ok' : ''}">${state.pubkey ? 'SIGNED IN' : 'LOCAL'}</span></summary>
      <div class="settings-category-body">${account}</div>
    </details>
    ${beastModeSettingsCard(state)}
    ${backupPanel({ signedIn: Boolean(state.pubkey), enabled: Boolean(state.settings.backup?.enabled), sync: state.backup, backup: state.settings.backup })}
    ${nwcCard}
    ${paymentModeCard(state)}
    <details class="settings-category training-preferences-card">
      <summary><span class="settings-category-copy"><strong>Training Preferences</strong><small>${unit === 'kg' ? 'Kilograms' : 'Pounds'} · ${ownedEquipmentKeys(state.settings.ownedEquipment).length} equipment</small></span></summary>
      <div class="settings-category-body">
        <div class="settings-row-main"><div><strong>Weight unit</strong><small>Weights are stored in kilograms and converted for display.</small></div><label class="compact-select"><select id="unit-select"><option value="kg" ${unit === 'kg' ? 'selected' : ''}>Kilograms</option><option value="lbs" ${unit === 'lbs' ? 'selected' : ''}>Pounds</option></select></label></div>
        ${equipmentRows(state)}
      </div>
    </details>
    ${supportPanel(state.support, nwc, Boolean(state.pubkey), moneroMode)}
    <details class="settings-category advanced-settings">
      <summary><span class="settings-category-copy"><strong>Advanced</strong><small>Diagnostics, relay, signer, and technical state</small></span></summary>
      <div class="settings-category-body"><div class="terminal-mini">version: ${html(APP_VERSION)}\nsecure context: ${secureContext}\ncountdown audio: ${html(countdownAudioState())}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'local (this device only)')}\nsigner type: ${html(signerType)}\nrelay: ${html(relay)}\n${state.signInStatus ? html(state.signInStatus) : ''}</div></div>
    </details>
  </div>`;
}
