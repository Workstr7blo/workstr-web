import type { AppState } from './state';
import { displayIdentity, exerciseFilterValues, html } from './format';
import { APP_VERSION } from './version';
import { countdownAudioState } from '../features/train/countdown-audio';
import { supportPanel } from '../features/support/views';
import { moneroTipsCard } from '../features/support/payment-mode-views';
import { moneroWalletDiagnostics } from '../features/monero/wallet-view';
import { isFreeEquipment, ownedEquipmentKeys } from '../core/equipment';
import { normalizeWeightUnit } from '../core/units';
import { beastModeSettingsCard } from '../features/sheets/beast-mode';
import { backupPanel, backupPanelState } from '../features/backup/views';
import { tipJarBackupSection } from '../features/monero/wallet-backup-view';
import { deviceSecurityCard } from './device-vault-view';
import { profileCard } from './profile-view';

// Settings is read top to bottom by someone who is not thinking in features: who I am, how I
// train, how I pay, how this device reaches my account, how I support this, and then the
// technical drawer. The cards themselves
// are unchanged and still come from the feature that owns each one; what this file decides is
// the order they appear in and the groups they appear under.
//
// Cards in a group share one bordered container and are divided by a line rather than a gap,
// so a group reads as one object. Whitespace separates groups. A group holding a single card
// is indistinguishable from a standalone card, which is what Profile and Support want.
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
  profile: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  access: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
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
// exactly how the old Account summary broke in #201.
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

// How this device reaches the account, and the actions that affect only this device. Who the
// account is belongs to the Profile card above, so nothing here repeats the avatar or name.
// Removing local data is destructive and sits apart from the routine actions, behind its
// confirmation in the identity controller.
function accessCard(state: AppState): string {
  if (!state.pubkey) return '';
  return `<details class="settings-category access-card" data-settings-section="access">
    <summary><span class="settings-category-copy"><strong>Account access</strong><small>Add a device or sign out of this one</small></span></summary>
    <div class="settings-category-body access-card-body">
      <div class="settings-row-main account-row">
        <div><strong>Add device</strong><small>Show a pairing code to sign in on another device.</small></div>
        <div class="settings-row-actions"><button id="add-device-settings" class="button small" type="button">Add device</button></div>
      </div>
      <div class="settings-row-main account-row">
        <div><strong>Sign out</strong><small>Your training data stays on this device.</small></div>
        <div class="settings-row-actions"><button id="sign-out-settings" class="button small" type="button">Sign out</button></div>
      </div>
      <div class="settings-row-main account-row access-danger">
        <div><strong>Remove local data</strong><small>Deletes this account's training data from this device and signs out.</small></div>
        <div class="settings-row-actions"><button id="remove-account-data" class="button danger small" type="button">Remove local data</button></div>
      </div>
    </div>
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
  const identityMode = state.pubkey ? 'workstr account' : 'local only';
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  const workstrDiagnostics = `version: ${html(APP_VERSION)}\nsecure context: ${secureContext}\ncountdown audio: ${html(countdownAudioState())}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'local (this device only)')}\nidentity mode: ${html(identityMode)}\nrelay: ${html(relay)}\n${state.signInStatus ? html(state.signInStatus) : ''}`;
  const tipJarDiagnostics = state.pubkey ? moneroWalletDiagnostics(state) : '';
  return `<details class="settings-category advanced-settings" data-settings-section="advanced">
    <summary><span class="settings-category-copy"><strong>Advanced</strong><small>Diagnostics, relay, and technical state</small></span></summary>
    <div class="settings-category-body">
      <details class="settings-inline-advanced settings-diagnostics">
        <summary>Diagnostics</summary>
        <div class="settings-diagnostics-body">
          <div class="terminal-mini">${workstrDiagnostics}</div>
          ${tipJarDiagnostics}
        </div>
      </details>
    </div>
  </details>`;
}

export function settingsView(state: AppState): string {
  const signedIn = Boolean(state.pubkey);
  const trainingCards = [
    trainingPreferencesCard(state),
    signedIn ? beastModeSettingsCard(state) : ''
  ];
  const paymentCards = signedIn ? [moneroTipsCard(state)] : [];
  // Supporting Workstr is not creator tipping, so it does not follow the Monero tips switch.
  const supportCards = signedIn ? [supportPanel()] : [];
  return `<div class="page active settings-page">
    <div class="page-title">Settings</div>
    <p class="page-blurb">Customize your experience, keep your data safe, and support a stronger, more sovereign future.</p>
    ${settingsGroup({ id: 'profile', label: 'Profile', blurb: 'Your public Nostr profile', icon: GROUP_ICONS.profile, cards: [profileCard(state)] })}
    ${settingsGroup({ id: 'training', label: 'Training', blurb: 'Configure your training experience', icon: GROUP_ICONS.training, cards: trainingCards })}
    ${settingsGroup({ id: 'payments', label: 'Payments', blurb: 'Tip program creators with Monero', icon: GROUP_ICONS.payments, cards: paymentCards })}
    ${settingsGroup({ id: 'access', label: 'Access & Security', blurb: 'How this device reaches your account', icon: GROUP_ICONS.access, cards: [accessCard(state), deviceSecurityCard(state)] })}
    ${settingsGroup({ id: 'support', label: 'Support', blurb: 'Help keep Workstr independent', icon: GROUP_ICONS.support, cards: supportCards, variant: 'support' })}
    ${settingsGroup({ id: 'system', label: 'System & Data', blurb: 'Manage your data and advanced settings', icon: GROUP_ICONS.system, cards: [backupPanel(backupPanelState(state, tipJarBackupSection(state))), advancedCard(state)] })}
  </div>`;
}
