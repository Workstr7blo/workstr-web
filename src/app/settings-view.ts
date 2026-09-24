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
  cards: string[];
}

function settingsGroup(group: SettingsGroup): string {
  const cards = group.cards.filter(Boolean);
  if (!cards.length) return '';
  return `<section class="settings-group" aria-labelledby="settings-group-${group.id}">
    <div class="settings-group-head">
      <h2 class="settings-group-label" id="settings-group-${group.id}">${html(group.label)}</h2>
    </div>
    <div class="settings-group-cards">${cards.join('')}</div>
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
  const tipJarCards = signedIn ? [moneroTipsCard(state)] : [];
  const securityCards = [
    deviceSecurityCard(state),
    backupPanel(backupPanelState(state, tipJarBackupSection(state))),
    advancedCard(state)
  ];
  return `<div class="page active settings-page">
    <div class="page-title">Settings</div>
    <p class="page-blurb">Profile, training and app preferences.</p>
    ${settingsGroup({ id: 'profile', label: 'Profile', cards: [profileCard(state)] })}
    ${settingsGroup({ id: 'training', label: 'Training', cards: trainingCards })}
    ${settingsGroup({ id: 'tip-jar', label: 'Tip Jar', cards: tipJarCards })}
    ${settingsGroup({ id: 'security-data', label: 'Security & Data', cards: securityCards })}
    ${signedIn ? supportPanel() : ''}
  </div>`;
}
