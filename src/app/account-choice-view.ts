import { hasNip07 } from '../signer/nip07';

// The account modal, as markup only. Every action behind it already exists in
// `identity-controller.ts`, which binds these ids; this file decides nothing about identity
// and holds no state.
//
// It used to be two tabs, Log in and Create account, which put the two halves side by side
// as if they were the same kind of choice. They are not: there is exactly one way to create
// a Workstr account - generate a key and show its recovery phrase - and four ways to reach
// one that already exists. The tabs also listed "use mobile signer" and "use browser
// extension" under Create, where they never belonged: an external signer holds an identity
// that already exists, it does not make a new one.
//
// So: one page. Create at the top as the strongest thing on it, the existing-account paths
// under a divider as a menu, and continuing without an account last and quietest.

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
  document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  extension: '<path d="M9 4a2 2 0 1 1 4 0h3a1 1 0 0 1 1 1v3a2 2 0 1 0 0 4v3a1 1 0 0 1-1 1h-3a2 2 0 1 0-4 0H6a1 1 0 0 1-1-1v-3a2 2 0 1 1 0-4V5a1 1 0 0 1 1-1z"/>'
};

// Order is deliberate and is the answer to "which of these should I pick?". Pairing needs no
// typing and no understanding of what a key is, so it leads; the two signer paths are last
// because someone who wants them already knows what they are.
function existingAccountPaths(): AccountPath[] {
  const paths: AccountPath[] = [
    { id: 'pair-new-device', title: 'Scan from another device', blurb: 'Fastest way to connect this device.', icon: PATH_ICONS.qr, recommended: true },
    { id: 'restore-local-account', title: 'Restore with recovery key', blurb: "Use a recovery key you've already saved.", icon: PATH_ICONS.document },
    { id: 'connect-remote-signer', title: 'Use mobile signer', blurb: 'Sign with an external Nostr signer.', icon: PATH_ICONS.phone }
  ];
  // Absent rather than disabled when there is no extension: a row that cannot do anything is
  // worse than no row, and this is the one path whose availability we can actually detect.
  if (hasNip07()) paths.push({ id: 'connect-extension-signer', title: 'Use browser extension', blurb: 'Connect a NIP-07 browser signer.', icon: PATH_ICONS.extension });
  return paths;
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
    <p class="section-help">Use Workstr locally, or connect an account to keep your training available across devices.</p>
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
