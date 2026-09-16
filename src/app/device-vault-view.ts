// Markup for the device vault: the lock screen, the device-code forms and the Settings card.
// Rendering only - `device-vault-controller.ts` binds these ids and owns every decision.
//
// A device code is entered as three boxes of three digits, because nine digits in one field
// are hard to read back. The boxes are one value: the controller joins them before anything
// checks it, and the code is never written into markup, so a re-render always starts empty.
import { nip19 } from 'nostr-tools';
import type { AppState } from './state';
import { html } from './format';

const SCOPE_NAMES: Record<string, string> = {
  'nostr.local-key': 'Your Nostr identity key',
  'monero.hot-wallet': 'Monero hot wallet secret'
};

// Monero wallets are stored per account, so their scopes end in the account's pubkey.
export const vaultScopeName = (scope: string): string => SCOPE_NAMES[scope]
  || (scope.startsWith('monero.hot-wallet.') ? 'Monero hot wallet secret' : '')
  || (scope.startsWith('monero.hot-wallet-data.') ? 'Monero wallet sync data' : '')
  || `Protected secret (${scope})`;

export const shortNpub = (pubkey: string): string => { const npub = nip19.npubEncode(pubkey); return `${npub.slice(0, 12)}…${npub.slice(-6)}`; };

// After unlocking, when a key saved before the device vault could not be moved into it. The
// identity is that key's account, or null when it could not be read.
export function unmovedLegacyKeyModalMarkup(identity: string | null): string {
  return `<div class="page-title">Old identity key not protected</div>
    <p class="section-help">Workstr could not move an identity key saved by an older version into the device vault, so it is still stored on this device without a device code.</p>
    ${identity ? `<div class="terminal-mini device-vault-identity">${html(identity)}</div>` : ''}
    <p class="section-help">Remove it only if you have its recovery key. Otherwise Workstr tries to move it again the next time it opens.</p>
    <div class="web-empty-actions">
      <button id="vault-legacy-remove" class="button danger" type="button">Remove old key</button>
      <button id="vault-legacy-later" class="button" type="button">Not now</button>
    </div>`;
}

export interface VaultFormOptions {
  error?: string | null;
  busy?: string | null;
}

// Masked in the box, like any code typed in view of other people, but a plain text input so
// phones show the numeric keypad and password managers do not offer to save it.
export function pinField(name: string, label: string, disabled = false): string {
  const groups = [0, 1, 2].map((index) => `<input class="device-pin-group" data-pin-group="${index}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="${index === 2 ? 'done' : 'next'}" aria-label="${html(label)}, digits ${index * 3 + 1} to ${index * 3 + 3}"${disabled ? ' disabled' : ''} />`).join('');
  return `<fieldset class="device-pin" data-pin-field="${html(name)}">
    <legend>${html(label)}</legend>
    <div class="device-pin-groups">${groups}</div>
  </fieldset>`;
}

function feedback({ error, busy }: VaultFormOptions): string {
  if (busy) return `<p class="section-help device-pin-busy" role="status">${html(busy)}</p>`;
  return error ? `<p class="auth-error" role="alert">${html(error)}</p>` : '';
}

function lockCard(title: string, body: string): string {
  return `<div class="vault-lock-card" role="dialog" aria-modal="true" aria-labelledby="vault-lock-title">
    <div class="page-title" id="vault-lock-title">${html(title)}</div>
    ${body}
  </div>`;
}

export function unlockScreenMarkup(options: VaultFormOptions = {}): string {
  const disabled = Boolean(options.busy);
  return lockCard('Unlock Workstr', `<p class="section-help">Enter your nine-digit device code.</p>
    <form id="vault-unlock-form" class="device-pin-form" novalidate>
      ${pinField('unlock', 'Device code', disabled)}
      ${feedback(options)}
      <div class="web-empty-actions"><button id="vault-unlock" class="button primary" type="submit"${disabled ? ' disabled' : ''}>Unlock</button></div>
    </form>
    <button id="vault-forgot" class="auth-link-button" type="button"${disabled ? ' disabled' : ''}>Forgot your device code?</button>`);
}

// Lists what a reset destroys by name, so the confirmation stays honest once the vault holds
// more than the Nostr key - a wallet seed that was never backed up is money, not a sign-in.
export function forgotScreenMarkup(secrets: string[]): string {
  const list = secrets.length ? `<ul class="device-vault-scopes">${secrets.map((name) => `<li>${html(name)}</li>`).join('')}</ul>` : '';
  return lockCard('Forgot your device code?', `<p class="section-help">Your code cannot be recovered. You can reset the encrypted vault on this device and restore your identity using your recovery key or another trusted device.</p>
    ${list ? `<p class="section-help">Resetting deletes from this device:</p>${list}` : ''}
    <p class="section-help">Your training data on this device is kept.</p>
    <div class="web-empty-actions">
      <button id="vault-reset" class="button danger" type="button">Reset device vault</button>
      <button id="vault-reset-cancel" class="button" type="button">Cancel</button>
    </div>`);
}

export function protectIntroMarkup(error: string | null = null): string {
  return lockCard('Protect this device', `<p class="section-help">Create a nine-digit device code to protect your Workstr identity on this device.</p>
    ${error ? `<p class="auth-error" role="alert">${html(error)}</p>` : ''}
    <div class="web-empty-actions"><button id="vault-protect-start" class="button primary" type="button">Create device code</button></div>
    <button id="vault-protect-restore" class="auth-link-button" type="button">Use my recovery key instead</button>`);
}

function newPinFields(disabled: boolean): string {
  return `${pinField('new', 'Device code', disabled)}${pinField('confirm', 'Enter it again', disabled)}`;
}

export function protectCreateMarkup(options: VaultFormOptions = {}): string {
  const disabled = Boolean(options.busy);
  return lockCard('Create a device code', `<p class="section-help">You will enter it each time Workstr opens. It never leaves this device and cannot be recovered, so keep your recovery key too.</p>
    <form id="vault-protect-form" class="device-pin-form" novalidate>
      ${newPinFields(disabled)}
      ${feedback(options)}
      <div class="web-empty-actions">
        <button id="vault-protect-submit" class="button primary" type="submit"${disabled ? ' disabled' : ''}>Protect this device</button>
        <button id="vault-protect-back" class="button" type="button"${disabled ? ' disabled' : ''}>Back</button>
      </div>
    </form>`);
}

// Shown in the modal while an account is being created, restored or received. The identity
// line is the account the code is about to protect, derived from the key in memory.
export function newPinModalMarkup(identity: string, options: VaultFormOptions = {}): string {
  const disabled = Boolean(options.busy);
  return `<div class="page-title">Create a device code</div>
    <p class="section-help">Choose a nine-digit code that unlocks Workstr on this device. It never leaves this device and is not part of your recovery key.</p>
    <div class="terminal-mini device-vault-identity">${html(identity)}</div>
    <form id="vault-new-pin-form" class="device-pin-form" novalidate>
      ${newPinFields(disabled)}
      ${feedback(options)}
      <div class="web-empty-actions"><button id="vault-new-pin-submit" class="button primary" type="submit"${disabled ? ' disabled' : ''}>Protect and sign in</button></div>
    </form>`;
}

export function unlockModalMarkup(identity: string, options: VaultFormOptions = {}): string {
  const disabled = Boolean(options.busy);
  return `<div class="page-title">Enter your device code</div>
    <p class="section-help">This device already has a device code. Enter it to store this identity with your other protected secrets.</p>
    <div class="terminal-mini device-vault-identity">${html(identity)}</div>
    <form id="vault-modal-unlock-form" class="device-pin-form" novalidate>
      ${pinField('unlock', 'Device code', disabled)}
      ${feedback(options)}
      <div class="web-empty-actions"><button id="vault-modal-unlock" class="button primary" type="submit"${disabled ? ' disabled' : ''}>Continue</button></div>
    </form>`;
}

export function changePinModalMarkup(options: VaultFormOptions = {}): string {
  const disabled = Boolean(options.busy);
  return `<div class="page-title">Change device code</div>
    <p class="section-help">Your protected secrets stay as they are; only the code that unlocks them changes.</p>
    <form id="vault-change-pin-form" class="device-pin-form" novalidate>
      ${pinField('current', 'Current device code', disabled)}
      ${newPinFields(disabled)}
      ${feedback(options)}
      <div class="web-empty-actions"><button id="vault-change-pin-submit" class="button primary" type="submit"${disabled ? ' disabled' : ''}>Change device code</button></div>
    </form>`;
}

export function vaultMessageModalMarkup(title: string, message: string): string {
  return `<div class="page-title">${html(title)}</div>
    <p class="auth-error" role="alert">${html(message)}</p>
    <div class="web-empty-actions"><button id="vault-message-close" class="button primary" type="button">Close</button></div>`;
}

export function vaultBusyModalMarkup(message: string): string {
  return `<div class="page-title">One moment</div><p class="section-help" role="status">${html(message)}</p>`;
}

// Present only while there is an unlocked vault: a locked one is behind the lock screen, and
// a device with no vault has no code to change.
export function deviceSecurityCard(state: AppState): string {
  if (state.deviceVault !== 'unlocked') return '';
  return `<details class="settings-category device-security-card" data-settings-section="device-security">
    <summary><span class="settings-category-copy"><strong>Device security</strong><small>Protected by a nine-digit device code</small></span><span class="status-pill ok">UNLOCKED</span></summary>
    <div class="settings-category-body"><div class="settings-row-main account-row">
      <div><strong>Device code</strong><small>Your local identity is protected by a nine-digit code.</small></div>
      <div class="settings-row-actions"><button id="change-device-code" class="button small" type="button">Change device code</button><button id="lock-workstr" class="button small" type="button">Lock Workstr</button></div>
    </div></div>
  </details>`;
}
