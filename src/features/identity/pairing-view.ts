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

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…${npub.slice(-6)}`;

export function qrMarkup(uri: string, expiresInSeconds: number): string {
  return `<div class="page-title">Add this device</div>
    <p class="section-help">On your other Workstr device, open Settings, choose Add another device, and scan this code.</p>
    <div class="signer-qr pairing-qr" data-pairing-uri="${html(uri)}">${renderSVG(uri, { border: 2 })}</div>
    <p class="section-help" data-pairing-countdown>This code expires in ${Math.max(0, Math.round(expiresInSeconds / 60))} minutes.</p>
    <p class="section-help">The code carries no private key. A photograph of it is not enough to take your account.</p>
    <div class="web-empty-actions">
      <button id="pairing-cancel" class="button" type="button">Cancel</button>
    </div>`;
}

export function waitingMarkup(): string {
  return `<div class="page-title">Waiting for approval</div>
    <p class="section-help">Approve the transfer on your other device. You can leave this screen open.</p>
    <div class="web-empty-actions">
      <button id="pairing-cancel" class="button" type="button">Cancel</button>
    </div>`;
}

export function scannerMarkup(): string {
  return `<div class="page-title">Scan the code</div>
    <p class="section-help">Point this device at the code shown on the device you are adding.</p>
    <video id="pairing-video" class="pairing-video" playsinline muted></video>
    <div class="web-empty-actions">
      <button id="pairing-cancel" class="button" type="button">Cancel</button>
    </div>`;
}

// Deliberately blunt. Someone who did not start this needs to understand what approving
// does before they tap, and "grant access" would understate it: this copies the key.
export function approvalMarkup(): string {
  return `<div class="page-title">Add another Workstr device?</div>
    <p class="section-help">This will copy your recovery key to the device showing that code, giving it full access to your account and training data.</p>
    <p class="section-help">Only approve this if you are holding that device and you started this yourself. Nobody from Workstr will ever ask you to scan a code.</p>
    <div class="web-empty-actions">
      <button id="pairing-approve" class="button primary" type="button">Approve transfer</button>
      <button id="pairing-cancel" class="button" type="button">Cancel</button>
    </div>`;
}

export function sendingMarkup(): string {
  return `<div class="page-title">Sending</div>
    <p class="section-help">Encrypting and sending to the new device.</p>`;
}

export function sentMarkup(): string {
  return `<div class="page-title">Device added</div>
    <p class="section-help">The new device has your account. Nothing further to do here.</p>
    <div class="web-empty-actions">
      <button id="pairing-done" class="button primary" type="button">Done</button>
    </div>`;
}

// The account name is the point of this screen, not a flourish: it is where someone would
// notice they had been handed an account that is not theirs.
export function successMarkup(npub: string): string {
  return `<div class="page-title">Signed in</div>
    <p class="section-help">This device now uses your Workstr account.</p>
    <div class="terminal-mini recovery-key-box">${html(shortNpub(npub))}</div>
    <p class="section-help">Check this matches the account on your other device. If it does not, sign out and do not use this device.</p>
    <div class="web-empty-actions">
      <button id="pairing-done" class="button primary" type="button">Continue</button>
    </div>`;
}

export function expiredMarkup(): string {
  return `<div class="page-title">This transfer request expired</div>
    <p class="section-help">Codes are short-lived on purpose. Generate a new one to try again.</p>
    <div class="web-empty-actions">
      <button id="pairing-restart" class="button primary" type="button">Generate new code</button>
      <button id="pairing-cancel" class="button" type="button">Close</button>
    </div>`;
}

export function errorMarkup(message: string): string {
  return `<div class="page-title">Transfer failed</div>
    <p class="auth-error" role="alert">${html(message)}</p>
    <div class="web-empty-actions">
      <button id="pairing-restart" class="button primary" type="button">Try again</button>
      <button id="pairing-cancel" class="button" type="button">Close</button>
    </div>`;
}

// Shown on the trusted device when the account it holds is not one it can transfer.
export function externalSignerMarkup(): string {
  return `<div class="page-title">This account uses an external signer</div>
    <p class="section-help">Workstr does not hold the private key for this account, so it cannot copy it to another device. Connect the same signer there instead.</p>
    <div class="web-empty-actions">
      <button id="pairing-cancel" class="button primary" type="button">Close</button>
    </div>`;
}
