// Markup for the pairing screens. Rendering only: no crypto, no relay, no camera.
//
// Two of these are load-bearing security rather than decoration, and their copy should be
// treated as carefully as the protocol:
//
//   approvalMarkup    the only thing standing between a social-engineered scan and a
//                     transferred recovery key
//   successMarkup     names the account that arrived, which is the only defence against a
//                     response that consistently uses an attacker's own key - every
//                     cryptographic check passes for one of those
import { renderSVG } from 'uqr';
import { html } from '../../app/format';
import { icon } from '../../app/icons';
import { accountFlowHead, accountNote } from '../../app/account-choice-view';

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;

const EYEBROW = 'Device pairing';
const cancelButton = (label = 'Cancel', primary = false) => `<button id="pairing-cancel" class="button${primary ? ' primary' : ''}" type="button">${label}</button>`;

export function qrMarkup(uri: string, expiresInSeconds: number): string {
  return `${accountFlowHead('qr-code', 'Add this device', EYEBROW)}
    <p class="section-help">On your other Workstr device, open Settings, choose Add another device, and scan this code.</p>
    <div class="signer-qr pairing-qr" data-pairing-uri="${html(uri)}">${renderSVG(uri, { border: 2 })}</div>
    <div class="account-notes">
      ${accountNote('clock', `This code expires in ${Math.max(0, Math.round(expiresInSeconds / 60))} minutes.`, 'info', ' data-pairing-countdown')}
      ${accountNote('shield-check', 'The code carries no private key. A photograph of it is not enough to take your account.', 'ok')}
    </div>
    <div class="web-empty-actions">${cancelButton()}</div>`;
}

export function waitingMarkup(): string {
  return `${accountFlowHead('hourglass', 'Waiting for approval', EYEBROW)}
    <p class="section-help">Approve the transfer on your other device. You can leave this screen open.</p>
    <div class="pairing-progress" aria-hidden="true"><span></span></div>
    <div class="web-empty-actions">${cancelButton()}</div>`;
}

export function scannerMarkup(): string {
  return `${accountFlowHead('scan-line', 'Scan the code', EYEBROW)}
    <p class="section-help">Point this device at the code shown on the device you are adding.</p>
    <video id="pairing-video" class="pairing-video" playsinline muted></video>
    <div class="web-empty-actions">${cancelButton()}</div>`;
}

// Deliberately blunt. Someone who did not start this needs to understand what approving
// does before they tap, and "grant access" would understate it: this copies the key.
export function approvalMarkup(): string {
  return `${accountFlowHead('triangle-alert', 'Add another Workstr device?', EYEBROW, 'warn')}
    <p class="section-help">This will copy your recovery key to the device showing that code, giving it full access to your account and training data.</p>
    ${accountNote('triangle-alert', 'Only approve this if you are holding that device and you started this yourself. Nobody from Workstr will ever ask you to scan a code.', 'warn')}
    <div class="web-empty-actions">
      <button id="pairing-approve" class="button primary" type="button">${icon('send')}<span>Approve transfer</span></button>
      ${cancelButton()}
    </div>`;
}

export function sendingMarkup(): string {
  return `${accountFlowHead('send', 'Sending', EYEBROW)}
    <p class="section-help">Encrypting and sending to the new device.</p>
    <div class="pairing-progress" aria-hidden="true"><span></span></div>`;
}

export function sentMarkup(): string {
  return `${accountFlowHead('circle-check', 'Device added', EYEBROW, 'ok')}
    <p class="section-help">The new device has your account. Nothing further to do here.</p>
    <div class="web-empty-actions">
      <button id="pairing-done" class="button primary" type="button">${icon('check')}<span>Done</span></button>
    </div>`;
}

// The account name is the point of this screen, not a flourish: it is where someone would
// notice they had been handed an account that is not theirs.
export function successMarkup(npub: string): string {
  return `${accountFlowHead('circle-check', 'Signed in', EYEBROW, 'ok')}
    <p class="section-help">This device now uses your Workstr account.</p>
    <div class="terminal-mini recovery-key-box">${html(shortNpub(npub))}</div>
    ${accountNote('info', 'Check this matches the account on your other device. If it does not, sign out and do not use this device.', 'warn')}
    <div class="web-empty-actions">
      <button id="pairing-done" class="button primary" type="button">${icon('arrow-right')}<span>Continue</span></button>
    </div>`;
}

export function expiredMarkup(): string {
  return `${accountFlowHead('clock', 'This transfer request expired', EYEBROW, 'warn')}
    <p class="section-help">Codes are short-lived on purpose. Generate a new one to try again.</p>
    <div class="web-empty-actions">
      <button id="pairing-restart" class="button primary" type="button">${icon('refresh-cw')}<span>Generate new code</span></button>
      ${cancelButton('Close')}
    </div>`;
}

export function errorMarkup(message: string): string {
  return `${accountFlowHead('circle-alert', 'Transfer failed', EYEBROW, 'danger')}
    <p class="auth-error account-note danger" role="alert">${icon('circle-alert')}<span>${html(message)}</span></p>
    <div class="web-empty-actions">
      <button id="pairing-restart" class="button primary" type="button">${icon('refresh-cw')}<span>Try again</span></button>
      ${cancelButton('Close')}
    </div>`;
}

// Shown on the trusted device when the account it holds is not one it can transfer.
export function externalSignerMarkup(): string {
  return `${accountFlowHead('key', 'This account uses an external signer', EYEBROW)}
    <p class="section-help">Workstr does not hold the private key for this account, so it cannot copy it to another device. Connect the same signer there instead.</p>
    <div class="web-empty-actions">${cancelButton('Close', true)}</div>`;
}

// Shown on the trusted device when its key is behind a locked device vault.
export function lockedMarkup(): string {
  return `${accountFlowHead('lock', 'Unlock Workstr first', EYEBROW)}
    <p class="section-help">This device's identity is locked. Unlock Workstr with your device code, then add the other device.</p>
    <div class="web-empty-actions">${cancelButton('Close', true)}</div>`;
}
