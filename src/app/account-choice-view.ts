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
  key: '<path d="M15.5 7.5a3.5 3.5 0 1 1-3.4 4.4L9 15h-2v2H5v2H2v-3l7.1-7.1A3.5 3.5 0 0 1 15.5 7.5z"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2v2h-2zM14 19h2v2h-2zM19 14h2v3h-2z"/>',
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'
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
    <span class="account-path-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path.icon}</svg></span>
    <span class="account-path-copy">
      <strong>${path.title}${path.recommended ? '<span class="account-path-badge">Recommended</span>' : ''}</strong>
      <small>${path.blurb}</small>
    </span>
    <span class="account-path-chevron" aria-hidden="true">›</span>
  </button>`;
}

export function accountChoiceMarkup(): string {
  return `<div class="page-title">Workstr account</div>
    <p class="section-help">Use Workstr locally, or create a Workstr account to keep your training available across devices.</p>
    <div class="account-create">
      <span class="account-create-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATH_ICONS.key}</svg></span>
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
