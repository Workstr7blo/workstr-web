import type { AppState } from './state';
import { accountIdentity, avatarFace } from './account-chip';
import { displayIdentity, displayNpub, exerciseFilterValues, html } from './format';
import { APP_VERSION } from './version';
import { countdownAudioState } from '../features/train/countdown-audio';
import { supportPanel } from '../features/support/views';
import { paymentModeCard } from '../features/support/payment-mode-views';
import { isFreeEquipment, ownedEquipmentKeys } from '../core/equipment';
import { normalizePaymentMode } from '../core/types';
import { normalizeWeightUnit } from '../core/units';
import { hasNip07 } from '../signer/nip07';
import { beastModeSettingsCard } from '../features/sheets/beast-mode';
import { backupPanel, backupPanelState } from '../features/backup/views';
import { redactNwcSecrets } from '../nostr/nwc';

// Settings is read top to bottom by someone who is not thinking in features: who I am, how I
// train, how I pay, how I support this, and then the technical drawer. The cards themselves
// are unchanged and still come from the feature that owns each one; what this file decides is
// the order they appear in and the groups they appear under.
//
// Cards in a group share one bordered container and are divided by a line rather than a gap,
// so a group reads as one object. Whitespace separates groups. A group holding a single card
// is indistinguishable from a standalone card, which is what Account and Support want.
interface SettingsGroup {
  id: string;
  label: string;
  blurb: string;
  icon: string;
  cards: string[];
  variant?: string;
}

// Stroke icons in the sidebar's style. Decorative: the label beside each one already names
// the group, so they are hidden from assistive technology rather than described twice.
const GROUP_ICONS = {
  account: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  training: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>',
  payments: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  support: '<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"/>'
};

function settingsGroup(group: SettingsGroup): string {
  const cards = group.cards.filter(Boolean);
  if (!cards.length) return '';
  return `<section class="settings-group" aria-labelledby="settings-group-${group.id}">
    <div class="settings-group-head">
      <span class="settings-group-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${group.icon}</svg></span>
      <span class="settings-group-copy">
        <h2 class="settings-group-label" id="settings-group-${group.id}">${html(group.label)}</h2>
        <small>${html(group.blurb)}</small>
      </span>
    </div>
    <div class="settings-group-cards${group.variant ? ` settings-group-cards--${group.variant}` : ''}">${cards.join('')}</div>
  </section>`;
}

// Kit options come from the library plus the Workstr catalog, so equipment can
// be ticked before any exercise using it has been imported.
//
// One preference block inside Training Preferences, shaped like the weight unit above it:
// title, description, status on the right. The chips are the control, so they sit under both
// columns rather than in a bordered section of their own.

// The two strings the card derives from settings, read by the view below and by
// `updateTrainingPreferences`. They are written once because a patcher that computes its own
// copy is a patcher that drifts from the view the day someone edits one of them - which is
// exactly how the Account summary broke in #201.
function trainingSummary(state: AppState): string {
  return `${normalizeWeightUnit(state.settings.unit) === 'kg' ? 'Kilograms' : 'Pounds'} · ${ownedEquipmentKeys(state.settings.ownedEquipment).length} equipment`;
}

function equipmentSelected(state: AppState): string {
  return `${ownedEquipmentKeys(state.settings.ownedEquipment).length} selected`;
}

// Writes what a preference change moves and nothing else. The select holds the value the
// reader just picked and the checkboxes hold the boxes they just ticked, so the card is
// already correct apart from these two strings - and rebuilding it to write them would throw
// away the disclosure the reader is working inside. False when the card is not on screen, so
// the caller can fall back to a render.
export function updateTrainingPreferences(root: ParentNode, state: AppState): boolean {
  const card = root.querySelector('.training-preferences-card');
  if (!card) return false;
  const summary = card.querySelector(':scope > summary .settings-category-copy small');
  if (summary) summary.textContent = trainingSummary(state);
  const pill = card.querySelector('.training-preference-block .status-pill');
  if (pill) pill.textContent = equipmentSelected(state);
  return true;
}

function equipmentPreference(state: AppState): string {
  const options = exerciseFilterValues([...state.library, ...state.discoverExercises]).equipment
    .filter((item) => !isFreeEquipment(item.key));
  const owned = new Set(ownedEquipmentKeys(state.settings.ownedEquipment));
  const blurb = options.length
    ? 'Used for Quick Workout suggestions.'
    : 'No equipment listed yet. Import exercises from Discover and equipment appears here.';
  const chips = options.map((item) => `<label class="equip-option"><input type="checkbox" class="equip-toggle" value="${html(item.key)}" ${owned.has(item.key) ? 'checked' : ''} /><span>${html(item.label)}</span></label>`).join('');
  return `<div class="training-preference training-preference-block">
    <div class="training-preference-copy"><strong>Equipment</strong><small>${blurb}</small></div>
    <span class="status-pill">${equipmentSelected(state)}</span>
    ${options.length ? `<div class="equip-options">${chips}</div>` : ''}
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

// Only worth a line of its own when it is not already the name above it: with no profile
// the display name *is* the shortened npub, and printing it twice says nothing.
function npubLine(state: AppState): string {
  if (!state.pubkey) return '';
  const short = displayNpub(state.pubkey);
  return displayIdentity(state) === short ? '' : `<small class="settings-account-npub">${html(short)}</small>`;
}

function accountCard(state: AppState): string {
  const keyLine = state.signerType === 'local' ? 'Device-managed key for faster sync.' : 'Keys stay in your signer.';
  const accountAvatar = avatarFace('settings-account-avatar', accountIdentity(state));
  const account = state.pubkey
    ? `<div class="settings-row-main account-row"><div class="settings-account-identity">${accountAvatar}<span><strong>${html(displayIdentity(state))}</strong><small>${html(keyLine)}</small></span></div><div class="settings-row-actions"><button id="add-device-settings" class="button small">Add device</button><button id="sign-out-settings" class="button small">Sign out</button><button id="remove-account-data" class="button quiet danger small">Remove data</button></div></div>`
    : `<div class="settings-row-main account-row"><div><strong>Local only</strong><small>Use Workstr now, add encrypted sync when ready.</small></div><div class="settings-row-actions"><button id="sign-in-settings" class="button primary">Account</button></div></div>`;
  // The identity is the summary here rather than a word: the avatar, the name and the npub
  // are what someone checks when they open Settings to see who they are signed in as.
  //
  // `patchSettingsAccount` in `account-chip.ts` writes the name and the avatar here when a
  // profile arrives, so those two carry the classes it looks for. The signer line and the
  // npub do not change once signed in, and it leaves them alone.
  const identityLine = state.pubkey
    ? `<span class="settings-account-summary">${avatarFace('settings-account-summary-avatar', accountIdentity(state))}<span class="settings-category-copy"><strong>${html(displayIdentity(state))}</strong><small>Signed in with ${state.signerType === 'local' ? 'a device key' : 'your signer'}</small>${npubLine(state)}</span></span>`
    : '<span class="settings-category-copy"><strong>Local only</strong><small>Not connected to an account yet</small></span>';
  return `<details class="settings-category account-card" data-settings-section="account">
    <summary>${identityLine}<span class="status-pill ${state.pubkey ? 'ok' : ''}">${state.pubkey ? 'SIGNED IN' : 'LOCAL'}</span></summary>
    <div class="settings-category-body">${account}</div>
  </details>`;
}

function trainingPreferencesCard(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  return `<details class="settings-category training-preferences-card" data-settings-section="training-preferences">
    <summary><span class="settings-category-copy"><strong>Training Preferences</strong><small>${trainingSummary(state)}</small></span></summary>
    <div class="settings-category-body training-preferences-body">
      <div class="training-preference training-preference-row">
        <div class="training-preference-copy"><strong>Weight unit</strong><small>Choose how weights are displayed.</small></div>
        <label class="compact-select"><select id="unit-select" aria-label="Weight unit"><option value="kg" ${unit === 'kg' ? 'selected' : ''}>Kilograms</option><option value="lbs" ${unit === 'lbs' ? 'selected' : ''}>Pounds</option></select></label>
      </div>
      <div class="training-preference-divider"></div>
      ${equipmentPreference(state)}
    </div>
  </details>`;
}

function advancedCard(state: AppState): string {
  const relay = state.settings.workstrRelay || 'default Workstr relay';
  const signerType = state.signerType || (state.pubkey ? 'unknown' : 'none');
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  return `<details class="settings-category advanced-settings" data-settings-section="advanced">
    <summary><span class="settings-category-copy"><strong>Advanced</strong><small>Diagnostics, relay, signer, and technical state</small></span></summary>
    <div class="settings-category-body"><div class="terminal-mini">version: ${html(APP_VERSION)}\nsecure context: ${secureContext}\ncountdown audio: ${html(countdownAudioState())}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'local (this device only)')}\nsigner type: ${html(signerType)}\nrelay: ${html(relay)}\n${state.signInStatus ? html(state.signInStatus) : ''}</div></div>
  </details>`;
}

export function settingsView(state: AppState): string {
  const signedIn = Boolean(state.pubkey);
  const nwc = state.nwc ?? { active: false, status: 'idle' as const };
  // Monero Mode replaces the wallet layer rather than adding to it: an NWC connection is a
  // Lightning instrument, and offering to connect one while creator support is on Monero
  // would be an invitation to pay over a rail this mode has switched off. The stored
  // connection is untouched — picking Lightning again brings the card back as it was.
  const moneroMode = normalizePaymentMode(state.settings.paymentMode) === 'monero';
  const nwcCard = !signedIn || moneroMode ? '' : `<details class="settings-category nwc-card" data-settings-section="zap-wallet">
      <summary><span class="settings-category-copy"><strong>Zap Wallet</strong><small>${nwc.active ? html(nwc.walletLabel || 'Wallet connected') : 'Not connected'}</small></span><span class="status-pill ${nwc.active ? 'ok' : ''}">${nwc.active ? 'ACTIVE' : 'OFF'}</span></summary>
      <div class="settings-category-body">${nwcWalletRows({ ...state, nwc })}</div>
    </details>`;
  const trainingCards = [
    trainingPreferencesCard(state),
    signedIn ? beastModeSettingsCard(state) : ''
  ];
  const paymentCards = signedIn ? [paymentModeCard(state), nwcCard] : [];
  const supportCards = signedIn ? [supportPanel(state.support, nwc, true, moneroMode)] : [];
  return `<div class="page active settings-page">
    <div class="page-title">Settings</div>
    <p class="page-blurb">Customize your experience, keep your data safe, and support a stronger, more sovereign future.</p>
    ${settingsGroup({ id: 'account', label: 'Account', blurb: 'Your identity and device connection', icon: GROUP_ICONS.account, cards: [accountCard(state)] })}
    ${settingsGroup({ id: 'training', label: 'Training', blurb: 'Configure your training experience', icon: GROUP_ICONS.training, cards: trainingCards })}
    ${settingsGroup({ id: 'payments', label: 'Payments', blurb: 'Choose your creator support method', icon: GROUP_ICONS.payments, cards: paymentCards })}
    ${settingsGroup({ id: 'support', label: 'Support', blurb: 'Help keep Workstr independent', icon: GROUP_ICONS.support, cards: supportCards, variant: 'support' })}
    ${settingsGroup({ id: 'system', label: 'System & Data', blurb: 'Manage your data and advanced settings', icon: GROUP_ICONS.system, cards: [backupPanel(backupPanelState(state)), advancedCard(state)] })}
  </div>`;
}
