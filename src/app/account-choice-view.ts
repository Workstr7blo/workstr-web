import { html } from './format';
import { icon, type IconName } from './icons';

// The account modal, as markup only. Every action behind it already exists in
// `identity-controller.ts`, which binds these ids; this file decides nothing about identity
// and holds no state.
//
// Workstr now has only two identity modes: local-only, or a Workstr-managed account whose
// recovery key is protected by the device vault. Existing accounts come from another Workstr
// device or a saved recovery key. External NIP-07/NIP-46 signer routes are intentionally gone.

interface AccountPath {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  recommended?: boolean;
}

const PATH_ICONS = {
  key: icon('key'),
  qr: icon('qr-code'),
  document: icon('file-text')
};

// Order is deliberate and is the answer to "which of these should I pick?". Pairing needs no
// typing and no understanding of what a key is, so it leads; recovery key paste is the manual
// fallback for an existing Workstr account.
function existingAccountPaths(): AccountPath[] {
  return [
    { id: 'pair-new-device', title: 'Scan from another device', blurb: 'Fastest way to connect this device.', icon: PATH_ICONS.qr, recommended: true },
    { id: 'restore-local-account', title: 'Restore with recovery key', blurb: "Use a recovery key you've already saved.", icon: PATH_ICONS.document }
  ];
}

function pathRow(path: AccountPath): string {
  // A real button, so it is reachable and operable from the keyboard for free. The
  // recommendation is said in text as well as shown as a badge - a badge alone is a colour,
  // and a colour is not available to everyone reading this.
  return `<button id="${path.id}" class="account-path${path.recommended ? ' recommended' : ''}" type="button">
    <span class="account-path-icon" aria-hidden="true">${path.icon}</span>
    <span class="account-path-copy">
      <strong>${path.title}${path.recommended ? '<span class="account-path-badge">Recommended</span>' : ''}</strong>
      <small>${path.blurb}</small>
    </span>
    <span class="account-path-chevron" aria-hidden="true">${icon('chevron-right')}</span>
  </button>`;
}

export type AccountNoteTone = 'info' | 'warn' | 'danger' | 'ok';

/**
 * The head every account and pairing modal opens with: an icon tile, a quiet eyebrow naming
 * the flow, and the title. Same shape as the device vault's lock card, so the steps between
 * choosing an account and setting a device code read as one sequence.
 */
export function accountFlowHead(name: IconName, title: string, eyebrow = 'Workstr account', tone: AccountNoteTone = 'info'): string {
  return `<div class="account-flow-head ${tone}">
    <span class="account-flow-icon" aria-hidden="true">${icon(name)}</span>
    <div class="account-flow-title"><span class="account-flow-eyebrow">${html(eyebrow)}</span><div class="page-title">${html(title)}</div></div>
  </div>`;
}

// `body` is markup, not text: callers escape what they interpolate into it.
export function accountNote(name: IconName, body: string, tone: AccountNoteTone = 'info', attributes = ''): string {
  return `<p class="account-note ${tone}"${attributes}>${icon(name)}<span>${body}</span></p>`;
}

export function accountBackButton(): string {
  return `<button id="account-back" class="auth-back-button" type="button">${icon('arrow-left')}<span>Back</span></button>`;
}

export function accountChoiceMarkup(): string {
  return `${accountFlowHead('user-round', 'Workstr account', 'Sign in')}
    <p class="section-help">Use Workstr locally, or create a Workstr account to keep your training available across devices.</p>
    <div class="account-create">
      <span class="account-create-icon" aria-hidden="true">${PATH_ICONS.key}</span>
      <span class="account-create-copy">
        <strong>Create a new Workstr account</strong>
        <small>Workstr will generate a private recovery key for you. Save it somewhere safe — it can restore your account on another device.</small>
      </span>
      <button id="create-local-account" class="button primary account-create-cta" type="button">Create account</button>
    </div>
    <div class="account-divider"><span>Already have an account?</span></div>
    <div class="account-paths">${existingAccountPaths().map(pathRow).join('')}</div>
    <div class="account-local-row"><button id="continue-local" class="auth-link-button" type="button">Continue locally on this device</button></div>`;
}
