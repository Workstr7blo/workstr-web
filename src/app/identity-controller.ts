import { renderSVG } from 'uqr';
import { copyNamespace, deleteNamespace, LOCAL_NAMESPACE, namespaceHasUserData } from '../db/adopt';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { clearNip46State, createBunkerSigner, createCachedNip46Signer, createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { clearLocalKey, createCachedLocalKeySigner, createLocalAccount, importLocalAccount } from '../signer/local-key';
import { forgetAutoApprove } from '../signer/auto-approve';
import type { Signer } from '../signer/types';
import type { AppState } from './state';
import { html } from './format';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';

export function launchSignerUri(uri: string, mobile: boolean, doc: Document = document): void {
  const link = doc.createElement('a');
  link.href = uri;
  if (!mobile) link.target = '_blank';
  link.rel = 'noreferrer'; link.style.display = 'none';
  doc.body.appendChild(link); link.click(); link.remove();
}

export interface IdentityControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  openModal(content: string): void;
  closeModal(): void;
  openLocal(): Promise<void>;
  openIdentity(pubkey: string, persist?: boolean, signerType?: AppState['signerType']): Promise<void>;
}

export function createIdentityController(ctx: IdentityControllerContext) {
  const { root, state, render, openModal, closeModal, openLocal, openIdentity } = ctx;
  let activeSigner: Signer | null = null;
  let pendingConnect: { uri: string; mobile: boolean } | null = null;

async function signOut(): Promise<void> {
  activeSigner = null;
  clearNip46State();
  clearLocalKey();
  // It describes the permissions one connection was granted, not this device. The next
  // signer may prompt for everything, and retrying early at it would prompt twice.
  forgetAutoApprove();
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SIGNER_TYPE_KEY);
  state.editingId = null;
  state.librarySelect = { active: false, slugs: new Set() };
  state.discoverSelect = { active: false, addresses: new Set() };
  await openLocal();
  render();
}

async function signOutAndRemoveData(): Promise<void> {
  const pubkey = state.pubkey;
  if (!pubkey) return;
  if (!window.confirm("Remove this identity's training data from this device and sign out? This cannot be undone.")) return;
  state.store?.close();
  state.store = null;
  await deleteNamespace(pubkey);
  await signOut();
}

// Sign-in always starts from the anonymous local account. Adoption policy
// (plan decision 6): a fresh identity adopts the local data wholesale; an
// identity that already has data on this device asks once — never merge.
// A purely seeded local account has nothing worth adopting, so it skips
// both the copy and the prompt.
async function completeSignIn(pubkey: string, signerType: AppState['signerType']): Promise<void> {
  if (state.pubkey || !(await namespaceHasUserData(LOCAL_NAMESPACE))) {
    await openAndRender(pubkey, signerType);
    return;
  }
  if (await namespaceHasUserData(pubkey)) {
    askAdoptChoice(pubkey, signerType);
    return;
  }
  await adoptLocalAndOpen(pubkey, signerType);
}

async function adoptLocalAndOpen(pubkey: string, signerType: AppState['signerType']): Promise<void> {
  state.store?.close();
  state.store = null;
  await copyNamespace(LOCAL_NAMESPACE, pubkey);
  await deleteNamespace(LOCAL_NAMESPACE);
  await openAndRender(pubkey, signerType);
}

function askAdoptChoice(pubkey: string, signerType: AppState['signerType']): void {
  openModal(`<div class="page-title">Existing account data</div>
    <p class="section-help">This identity already has Workstr data on this device. Pick the dataset to continue with — the two are never merged. Keeping this device's data replaces the identity's copy on this device.</p>
    <div class="web-empty-actions">
      <button id="adopt-keep-device" class="button primary">Keep this device's data</button>
      <button id="adopt-use-account" class="button ghost">Use the account's data</button>
    </div>`);
  root.querySelector('#adopt-keep-device')?.addEventListener('click', () => { closeModal(); void adoptLocalAndOpen(pubkey, signerType); });
  root.querySelector('#adopt-use-account')?.addEventListener('click', () => { closeModal(); void openAndRender(pubkey, signerType); });
}


async function getActiveSigner(): Promise<Signer | null> {
  if (activeSigner) return activeSigner;
  if (state.signerType === 'nip07' && hasNip07()) {
    activeSigner = createNip07Signer();
    return activeSigner;
  }
  if (state.signerType === 'nip46') {
    // The signed-in key is already known here — it names the database this session is
    // reading — so the reconnected signer never has to ask the bunker for it.
    activeSigner = createCachedNip46Signer(state.pubkey || undefined, { onAuthUrl: launchSignerRequest });
    return activeSigner;
  }
  if (state.signerType === 'local') {
    activeSigner = createCachedLocalKeySigner();
    return activeSigner;
  }
  return null;
}

// Thrown away when a call to it times out. A NIP-46 signer holds a relay subscription that
// its answers arrive on, and a phone that backgrounds the app kills that socket without
// the signer noticing: it keeps reporting itself open while every request goes nowhere.
// Dropping it means the next attempt builds a fresh connection instead of retrying into a
// dead one until the user reloads the page.
function dropActiveSigner(): void {
  activeSigner = null;
}



async function connectNip07(): Promise<void> {
  try {
    const signer = createNip07Signer();
    const pubkey = await signer.getPublicKey();
    activeSigner = signer;
    clearLocalKey();
    await completeSignIn(pubkey, 'nip07');
  } catch (error) {
    state.signInStatus = `extension signer error ${(error as Error).message}`;
    render();
  }
}

async function startRemoteSignerRequest(): Promise<void> {
  try {
    state.signInStatus = 'creating signer connect request...'; render();
    const request = createNostrConnectSignerRequest(defaultBunkerRelays(), { onAuthUrl: launchSignerRequest });
    const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    state.signInStatus = `waiting for signer approval on ${request.relays.join(', ')}`;
    render();
    showSignerConnectModal(request.uri, mobile);
    await request.ready;
    if (mobile) launchSignerRequest(request.uri);
    const connected = await request.signer;
    activeSigner = connected.signer;
    clearLocalKey();
    closeModal();
    await completeSignIn(connected.pubkey, 'nip46');
  } catch (error) {
    closeModal();
    state.signInStatus = `signer error ${(error as Error).message}`;
    render();
  }
}


function startAccountChoice(tab: 'login' | 'create' = 'login'): void {
  const isLogin = tab === 'login';
  openModal(`<div class="page-title">Workstr account</div>
    <p class="section-help">Use Workstr locally, or connect a private encrypted sync account when you want training on every device.</p>
    <div class="auth-tabs" role="tablist" aria-label="Account flow">
      <button id="auth-tab-login" class="auth-tab ${isLogin ? 'active' : ''}" type="button" role="tab" aria-selected="${isLogin}">Log in</button>
      <button id="auth-tab-create" class="auth-tab ${!isLogin ? 'active' : ''}" type="button" role="tab" aria-selected="${!isLogin}">Create account</button>
    </div>
    ${isLogin ? loginTabMarkup() : createTabMarkup()}`);
  root.querySelector('#auth-tab-login')?.addEventListener('click', () => startAccountChoice('login'));
  root.querySelector('#auth-tab-create')?.addEventListener('click', () => startAccountChoice('create'));
  root.querySelector('#create-local-account')?.addEventListener('click', createLocalAccountFlow);
  root.querySelector('#restore-local-account')?.addEventListener('click', () => showRestoreLocalAccountModal());
  root.querySelector('#connect-remote-signer')?.addEventListener('click', () => { closeModal(); void startRemoteSignerRequest(); });
  root.querySelector('#connect-extension-signer')?.addEventListener('click', () => { closeModal(); void connectNip07(); });
  root.querySelector('#continue-local')?.addEventListener('click', closeModal);
}

function loginTabMarkup(): string {
  return `<div class="auth-panel" role="tabpanel" aria-labelledby="auth-tab-login">
    <p class="section-help">Restore an existing Workstr account with your recovery key, or connect a mobile signer.</p>
    <div class="settings-auth-options single-column">
      <button id="restore-local-account" class="button primary" type="button">Restore with recovery key</button>
      <button id="connect-remote-signer" class="button ghost" type="button">Use mobile signer</button>
      ${hasNip07() ? '<button id="connect-extension-signer" class="button ghost" type="button">Use browser extension</button>' : ''}
    </div>
    <button id="continue-local" class="auth-link-button" type="button">Continue locally on this device</button>
  </div>`;
}

function createTabMarkup(): string {
  return `<div class="auth-panel" role="tabpanel" aria-labelledby="auth-tab-create">
    <p class="section-help">Create a device-managed account for fast encrypted sync. Workstr will show a recovery key next — save it in your password manager.</p>
    <div class="settings-auth-options single-column">
      <button id="create-local-account" class="button primary" type="button">Create encrypted sync account</button>
      <button id="connect-remote-signer" class="button ghost" type="button">Use mobile signer instead</button>
      ${hasNip07() ? '<button id="connect-extension-signer" class="button ghost" type="button">Use browser extension instead</button>' : ''}
    </div>
    <button id="continue-local" class="auth-link-button" type="button">Continue locally for now</button>
  </div>`;
}

function createLocalAccountFlow(): void {
  try {
    const account = createLocalAccount();
    activeSigner = account.signer;
    showRecoveryKeyModal(account.pubkey, account.nsec);
  } catch (error) {
    state.signInStatus = `local account error ${(error as Error).message}`;
    render();
  }
}

function showRecoveryKeyModal(pubkey: string, nsec: string): void {
  openModal(`<div class="page-title">Save your recovery key</div>
    <p class="section-help">This key restores your encrypted training data on another device. Workstr cannot recover it for you. Store it in a password manager and never share it.</p>
    <div class="terminal-mini recovery-key-box">${html(nsec)}</div>
    <div class="web-empty-actions">
      <button id="copy-recovery-key" class="button ghost" type="button">Copy recovery key</button>
      <button id="continue-local-account" class="button primary" type="button">I saved it</button>
    </div>
    <p class="section-help">Workstr saves this key only in this browser profile on this device. This is convenient, but less protected than a dedicated signer.</p>`);
  root.querySelector('#copy-recovery-key')?.addEventListener('click', (event) => {
    void navigator.clipboard.writeText(nsec);
    (event.currentTarget as HTMLButtonElement).textContent = 'Copied';
  });
  root.querySelector('#continue-local-account')?.addEventListener('click', () => { closeModal(); void completeSignIn(pubkey, 'local'); });
}

function showRestoreLocalAccountModal(input = '', error: string | null = null): void {
  openModal(`<div class="page-title">Restore with recovery key</div>
    <p class="section-help">Paste an nsec recovery key. It stays in this browser profile on this device so sync can run without signer prompts.</p>
    <textarea id="local-key-input" class="auth-key-input" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="nsec1...">${html(input)}</textarea>
    ${error ? `<p class="auth-error" role="alert">Recovery key error: ${html(error)}</p>` : ''}
    <p class="section-help">Only use this on a device you trust. For maximum key protection, use a dedicated signer instead.</p>
    <div class="web-empty-actions">
      <button id="restore-local-key" class="button primary" type="button">Use this key</button>
      <button id="restore-use-signer" class="button ghost" type="button">Use signer instead</button>
    </div>`);
  const keyInput = root.querySelector<HTMLTextAreaElement>('#local-key-input');
  if (input && keyInput) {
    keyInput.focus();
    keyInput.setSelectionRange(keyInput.value.length, keyInput.value.length);
  }
  root.querySelector('#restore-local-key')?.addEventListener('click', () => {
    const value = keyInput?.value || '';
    try {
      const account = importLocalAccount(value);
      activeSigner = account.signer;
      closeModal();
      void completeSignIn(account.pubkey, 'local');
    } catch (err) {
      // Re-open with the paste preserved: retyping a 63-character nsec from scratch
      // after a typo punishes the exact person this flow exists for.
      showRestoreLocalAccountModal(value, (err as Error).message);
    }
  });
  root.querySelector('#restore-use-signer')?.addEventListener('click', () => { closeModal(); void startRemoteSignerRequest(); });
}

function showSignerConnectModal(uri: string, mobile: boolean): void {
  pendingConnect = { uri, mobile };
  renderConnectModal();
}

function renderConnectModal(): void {
  if (!pendingConnect) return;
  const { uri, mobile } = pendingConnect;
  openModal(`<div class="page-title">Connect mobile signer</div>
    <p class="section-help">${mobile
      ? 'Approve the request in your signer app, then return to this tab. You can also scan the QR code from another device.'
      : 'Scan the QR code with your NIP-46 signer app (Clave, Amber, ...). Once you approve, this tab signs in automatically.'}</p>
    <div class="signer-qr">${renderSVG(uri, { border: 2 })}</div>
    <div class="web-empty-actions">
      <button id="connect-copy" class="button ghost" type="button">Copy secret</button>
      <button id="connect-open" class="button ghost" type="button">Open signer app</button>
    </div>
    <details class="auth-bunker-details">
      <summary>Paste bunker URL instead</summary>
      <textarea id="bunker-input" class="auth-key-input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="bunker://... or signer@example.com"></textarea>
      <button id="connect-bunker" class="button primary" type="button">Connect bunker</button>
    </details>`);
  root.querySelector('#connect-copy')?.addEventListener('click', (event) => {
    void navigator.clipboard.writeText(uri);
    (event.currentTarget as HTMLButtonElement).textContent = 'Copied';
  });
  root.querySelector('#connect-open')?.addEventListener('click', () => launchSignerRequest(uri));
  root.querySelector('#connect-bunker')?.addEventListener('click', () => { void connectBunkerInput(); });
}

async function connectBunkerInput(): Promise<void> {
  const input = root.querySelector<HTMLTextAreaElement>('#bunker-input')?.value || '';
  try {
    state.signInStatus = 'connecting bunker signer...';
    const signer = await createBunkerSigner(input, { onAuthUrl: launchSignerRequest });
    const pubkey = await signer.getPublicKey();
    activeSigner = signer;
    clearLocalKey();
    pendingConnect = null;
    closeModal();
    await completeSignIn(pubkey, 'nip46');
  } catch (error) {
    state.signInStatus = `bunker signer error ${(error as Error).message}`;
    renderConnectModal();
  }
}

function launchSignerRequest(uri: string): void {
  launchSignerUri(uri, /android|iphone|ipad|ipod/i.test(navigator.userAgent));
}

async function openAndRender(pubkey: string, signerType: AppState['signerType'] = state.signerType): Promise<void> {
  await openIdentity(pubkey, true, signerType);
  render();
}
  return {
    signOut, signOutAndRemoveData, connectNip07, startRemoteSignerRequest, startAccountChoice, startLocalAccount: createLocalAccountFlow, startRestoreLocalAccount: () => showRestoreLocalAccountModal(), getActiveSigner, dropActiveSigner,
    renderIfPending: () => { if (pendingConnect) renderConnectModal(); },
    clearPending: () => { pendingConnect = null; }
  };
}
