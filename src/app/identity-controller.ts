import { copyNamespace, deleteNamespace, LOCAL_NAMESPACE, namespaceHasUserData } from '../db/adopt';
import { clearLocalKey, createCachedLocalKeySigner, exportLocalNsec, generateLocalAccount, parseRecoveryKey, type LocalAccountKey } from '../signer/local-key';
import { accountBackButton, accountChoiceMarkup, accountFlowHead, accountNote } from './account-choice-view';
import { createDevicePairingController } from './device-pairing-controller';
import { WORKSTR_RELAY_URL } from '../sync/engine';
import { forgetAutoApprove } from '../signer/auto-approve';
import type { Signer } from '../signer/types';
import type { AppState } from './state';
import { html } from './format';
import { icon } from './icons';
import { confirmAction } from './confirm-dialog';

const SESSION_KEY = 'workstr.currentPubkey';
const OBSOLETE_SIGNER_KEYS = ['workstr.signerType', 'workstr.nip46.clientSecret', 'workstr.nip46.connection', 'workstr.nip46.grantedPerms'];

function clearObsoleteSignerState(): void {
  for (const key of OBSOLETE_SIGNER_KEYS) localStorage.removeItem(key);
}

export interface IdentityControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  openModal(content: string): void;
  closeModal(): void;
  openLocal(): Promise<void>;
  openIdentity(pubkey: string, persist?: boolean): Promise<void>;
  // The only way a local key reaches storage, and the vault status Settings draws from.
  vault: { protectLocalAccount(account: LocalAccountKey): Promise<Signer | null>; refreshStatus(): Promise<void> };
}

export function createIdentityController(ctx: IdentityControllerContext) {
  const { root, state, render, openModal, closeModal, openLocal, openIdentity, vault } = ctx;
  let activeSigner: Signer | null = null;

async function signOut(): Promise<void> {
  activeSigner = null;
  clearObsoleteSignerState();
  await clearLocalKey(); await vault.refreshStatus();
  forgetAutoApprove();
  localStorage.removeItem(SESSION_KEY);
  state.editingId = null;
  state.librarySelect = { active: false, slugs: new Set() };
  state.discoverSelect = { active: false, addresses: new Set() };
  await openLocal();
  render();
}

async function signOutAndRemoveData(): Promise<void> {
  const pubkey = state.pubkey;
  if (!pubkey) return;
  if (!(await confirmAction({ title: 'Remove data and sign out?', message: "This identity's training data is removed from this device and you are signed out. This cannot be undone.", confirmLabel: 'Remove and sign out', icon: 'log-out' }))) return;
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
async function completeSignIn(pubkey: string): Promise<void> {
  if (state.pubkey || !(await namespaceHasUserData(LOCAL_NAMESPACE))) {
    await openAndRender(pubkey);
    return;
  }
  if (await namespaceHasUserData(pubkey)) {
    askAdoptChoice(pubkey);
    return;
  }
  await adoptLocalAndOpen(pubkey);
}

async function adoptLocalAndOpen(pubkey: string): Promise<void> {
  state.store?.close();
  state.store = null;
  await copyNamespace(LOCAL_NAMESPACE, pubkey);
  await deleteNamespace(LOCAL_NAMESPACE);
  await openAndRender(pubkey);
}

function askAdoptChoice(pubkey: string): void {
  openModal(`${accountFlowHead('database', 'Existing account data')}
    <p class="section-help">This identity already has Workstr data on this device. Pick the dataset to continue with.</p>
    ${accountNote('info', "The two are never merged. Keeping this device's data replaces the identity's copy on this device.", 'warn')}
    <div class="web-empty-actions">
      <button id="adopt-keep-device" class="button primary" type="button">${icon('smartphone')}<span>Keep this device's data</span></button>
      <button id="adopt-use-account" class="button" type="button">${icon('user-round')}<span>Use the account's data</span></button>
    </div>`);
  root.querySelector('#adopt-keep-device')?.addEventListener('click', () => { closeModal(); void adoptLocalAndOpen(pubkey); });
  root.querySelector('#adopt-use-account')?.addEventListener('click', () => { closeModal(); void openAndRender(pubkey); });
}

async function getActiveSigner(): Promise<Signer | null> {
  if (!state.pubkey) return null;
  if (activeSigner) return activeSigner;
  activeSigner = await createCachedLocalKeySigner();
  return activeSigner;
}

function dropActiveSigner(): void {
  activeSigner = null;
}

const pairing = createDevicePairingController({
  root,
  relayUrl: WORKSTR_RELAY_URL,
  openModal,
  closeModal,
  getSigner: getActiveSigner,
  getLocalNsec: () => exportLocalNsec(),
  // Held in memory until this device has its own code. Nothing is stored if that is cancelled.
  adoptTransferredKey: async (nsec: string) => {
    const account = parseRecoveryKey(nsec);
    const signer = await vault.protectLocalAccount(account);
    if (!signer) return false;
    activeSigner = signer;
    await completeSignIn(account.pubkey);
    return true;
  }
});

// The settings account row's own buttons. They live here rather than in the shell because
// this controller is what they call, and a binding site away from its handler is how one
// gets missed when the markup changes.
function bindSettingsAuth(): void {
  root.querySelector('#sign-in-settings')?.addEventListener('click', () => startAccountChoice());
  root.querySelector('#sign-out-settings')?.addEventListener('click', () => { void signOut(); });
  root.querySelector('#remove-account-data')?.addEventListener('click', () => { void signOutAndRemoveData(); });
  root.querySelector('#add-device-settings')?.addEventListener('click', () => pairing.startScan());
}

function startAccountChoice(): void {
  openModal(accountChoiceMarkup());
  root.querySelector('#create-local-account')?.addEventListener('click', () => void createLocalAccountFlow());
  root.querySelector('#pair-new-device')?.addEventListener('click', () => pairing.startNewDevice());
  root.querySelector('#restore-local-account')?.addEventListener('click', () => showRestoreLocalAccountModal());
  root.querySelector('#continue-local')?.addEventListener('click', closeModal);
}

// The key exists only in memory until its recovery key has been saved and a device code set,
// so closing this flow at any step leaves no key behind.
function createLocalAccountFlow(): void {
  showRecoveryKeyModal(generateLocalAccount());
}

async function protectAndSignIn(account: LocalAccountKey): Promise<void> {
  const signer = await vault.protectLocalAccount(account);
  if (!signer) return;
  activeSigner = signer;
  closeModal();
  await completeSignIn(account.pubkey);
}

function showRecoveryKeyModal(account: LocalAccountKey): void {
  const { nsec } = account;
  openModal(`${accountFlowHead('key', 'Save your recovery key', 'New account')}
    <p class="section-help">This key restores your encrypted training data on another device. Store it in a password manager.</p>
    ${accountNote('triangle-alert', 'Workstr cannot recover it for you, and anyone holding it has your account. Never share it.', 'warn')}
    <div class="terminal-mini recovery-key-box">${html(nsec)}</div>
    <div class="web-empty-actions">
      <button id="copy-recovery-key" class="button" type="button">${icon('copy')}<span>Copy recovery key</span></button>
      <button id="continue-local-account" class="button primary" type="button">${icon('arrow-right')}<span>I saved it</span></button>
    </div>
    ${accountNote('shield-check', 'Next you choose a device code. Workstr keeps this key only on this device, encrypted under that code.', 'ok')}`);
  root.querySelector('#copy-recovery-key')?.addEventListener('click', (event) => {
    void navigator.clipboard.writeText(nsec);
    (event.currentTarget as HTMLButtonElement).innerHTML = `${icon('check')}<span>Copied</span>`;
  });
  root.querySelector('#continue-local-account')?.addEventListener('click', () => { void protectAndSignIn(account); });
}

function showRestoreLocalAccountModal(input = '', error: string | null = null): void {
  // Reached from the account choice screen, so it offers the way back to it. Closing the
  // modal and reopening it to change your mind is not a way back.
  openModal(`${accountBackButton()}
    ${accountFlowHead('file-text', 'Restore with recovery key')}
    <p class="section-help">Paste an nsec recovery key. It is kept on this device, encrypted under your device code, so sync can run without signer prompts.</p>
    <textarea id="local-key-input" class="auth-key-input" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="nsec1..." aria-label="Recovery key">${html(input)}</textarea>
    ${error ? `<p class="auth-error account-note danger" role="alert">${icon('circle-alert')}<span>Recovery key error: ${html(error)}</span></p>` : ''}
    ${accountNote('shield-check', 'Only use this on a device you trust.')}
    <div class="web-empty-actions">
      <button id="restore-local-key" class="button primary" type="button">${icon('key')}<span>Use this key</span></button>
    </div>`);
  const keyInput = root.querySelector<HTMLTextAreaElement>('#local-key-input');
  if (input && keyInput) {
    keyInput.focus();
    keyInput.setSelectionRange(keyInput.value.length, keyInput.value.length);
  }
  root.querySelector('#restore-local-key')?.addEventListener('click', () => void (async () => {
    const value = keyInput?.value || '';
    try {
      void protectAndSignIn(parseRecoveryKey(value));
    } catch (err) {
      // Re-open with the paste preserved: retyping a 63-character nsec from scratch
      // after a typo punishes the exact person this flow exists for.
      showRestoreLocalAccountModal(value, (err as Error).message);
    }
  })());
  root.querySelector('#account-back')?.addEventListener('click', () => startAccountChoice());
}

async function openAndRender(pubkey: string): Promise<void> {
  await openIdentity(pubkey, true);
  render();
}
  return {
    signOut, signOutAndRemoveData, startAccountChoice, startLocalAccount: createLocalAccountFlow, startRestoreLocalAccount: () => showRestoreLocalAccountModal(), getActiveSigner, dropActiveSigner,
    startAddDevice: () => pairing.startScan(), releasePairing: pairing.release, bindSettingsAuth,
    clearPending: () => undefined
  };
}
