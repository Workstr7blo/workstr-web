import { renderSVG } from 'uqr';
import { copyNamespace, deleteNamespace, LOCAL_NAMESPACE, namespaceHasUserData } from '../db/adopt';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { clearCachedNip46Signer, createCachedNip46Signer, createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { forgetAutoApprove } from '../signer/auto-approve';
import type { Signer } from '../signer/types';
import type { AppState } from './state';

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
  clearCachedNip46Signer();
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
    if (mobile) launchSignerRequest(request.uri);
    const connected = await request.signer;
    activeSigner = connected.signer;
    closeModal();
    await completeSignIn(connected.pubkey, 'nip46');
  } catch (error) {
    closeModal();
    state.signInStatus = `signer error ${(error as Error).message}`;
    render();
  }
}

function showSignerConnectModal(uri: string, mobile: boolean): void {
  pendingConnect = { uri, mobile };
  renderConnectModal();
}

function renderConnectModal(): void {
  if (!pendingConnect) return;
  const { uri, mobile } = pendingConnect;
  openModal(`<div class="page-title">Connect signer</div>
    <p class="section-help">${mobile
      ? 'Approve the request in your signer app, then return to this tab. You can also scan the QR code from another device.'
      : 'Scan the QR code with your NIP-46 signer app (Clave, Amber, ...). Once you approve, this tab signs in automatically.'}</p>
    <div class="signer-qr">${renderSVG(uri, { border: 2 })}</div>
    <div class="web-empty-actions">
      <button id="connect-copy" class="button ghost" type="button">Copy connect link</button>
      <button id="connect-open" class="button ghost" type="button">Open signer app</button>
    </div>`);
  root.querySelector('#connect-copy')?.addEventListener('click', (event) => {
    void navigator.clipboard.writeText(uri);
    (event.currentTarget as HTMLButtonElement).textContent = 'Copied';
  });
  root.querySelector('#connect-open')?.addEventListener('click', () => launchSignerRequest(uri));
}

function launchSignerRequest(uri: string): void {
  launchSignerUri(uri, /android|iphone|ipad|ipod/i.test(navigator.userAgent));
}

async function openAndRender(pubkey: string, signerType: AppState['signerType'] = state.signerType): Promise<void> {
  await openIdentity(pubkey, true, signerType);
  render();
}
  return {
    signOut, signOutAndRemoveData, connectNip07, startRemoteSignerRequest, getActiveSigner, dropActiveSigner,
    renderIfPending: () => { if (pendingConnect) renderConnectModal(); },
    clearPending: () => { pendingConnect = null; }
  };
}
