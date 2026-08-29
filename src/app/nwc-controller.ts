import { LOCAL_NAMESPACE } from '../db/adopt';
import { executeSupportZap } from '../nostr/support-zap';
import { validateNwcConnection } from '../nostr/nwc-client';
import { NwcError, maskNwcConnectionString, parseNwcConnectionString, redactNwcSecrets, type NwcConnection } from '../nostr/nwc';
import {
  clearNwcConnection,
  loadNwcConnection,
  saveNwcConnection,
  NwcSecureStorageError,
  type StoredNwcConnection
} from '../nostr/nwc-storage';
import type { Signer } from '../signer/types';
import { html } from './format';
import type { AppState, NwcViewState } from './state';

export interface NwcControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  closeModal(): void;
  getSigner(): Promise<Signer | null>;
  refreshFunding(): Promise<void>;
}

const DEFAULT_ZAP_AMOUNT = 1000;

function activeNamespace(state: AppState): string {
  return state.pubkey ?? LOCAL_NAMESPACE;
}

function relayLabel(relays: string[]): string {
  const first = relays[0];
  if (!first) return 'wallet relay';
  try {
    return new URL(first.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')).host;
  } catch {
    return 'wallet relay';
  }
}

function activeState(stored: StoredNwcConnection, message?: string): NwcViewState {
  const display = maskNwcConnectionString(stored.connection);
  return {
    active: true,
    walletLabel: stored.connection.lud16 || display,
    relayLabel: relayLabel(stored.metadata.relays),
    savedAt: stored.metadata.savedAt,
    status: message ? 'success' : 'idle',
    message
  };
}

function inactiveState(message?: string, status: NwcViewState['status'] = 'idle'): NwcViewState {
  return { active: false, status, message };
}

function connectionMessage(error: NwcError): string {
  switch (error.kind) {
    case 'invalid_format':
      return error.message || 'That is not a valid NWC connection string.';
    case 'expired_connection':
      return 'This wallet connection expired. Create a new NWC string in your wallet.';
    case 'rejected_unauthorized':
      return 'Wallet rejected this connection. Check its permissions include pay_invoice.';
    case 'unreachable_service':
      return 'Could not reach the wallet service. Check the NWC relay and try again.';
    case 'payment_failure':
    case 'unknown_failure':
      return error.message || 'Wallet connection could not be validated.';
  }
}

function storageMessage(error: NwcSecureStorageError): string {
  switch (error.code) {
    case 'unavailable':
      return 'Secure wallet storage is unavailable in this browser. Try a current secure browser context.';
    case 'read_failed':
    case 'corrupt_record':
      return 'Saved wallet connection could not be restored. Disconnect and connect it again.';
    case 'write_failed':
      return 'Wallet connection validated, but secure storage failed. It was not saved.';
    case 'clear_failed':
      return 'Wallet connection could not be removed from secure storage. Try again.';
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof NwcSecureStorageError) return storageMessage(error);
  if (error instanceof NwcError) return connectionMessage(error);
  const raw = error instanceof Error ? error.message : String(error || 'Unknown wallet error.');
  return new NwcError('unknown_failure', raw).message;
}

function connectModal(message = ''): string {
  return `<div class="page-title">Connect zap wallet</div>
    <p class="section-help">Paste the Nostr Wallet Connect string from your wallet. Workstr validates pay_invoice access before saving and never displays the secret.</p>
    <form id="nwc-connect-form" class="nwc-form">
      <label><span>NWC connection string</span><textarea id="nwc-connection-string" name="nwcConnection" class="auth-key-input" autocomplete="off" spellcheck="false" placeholder="nostr+walletconnect://..."></textarea></label>
      ${message ? `<div class="auth-error">${html(message)}</div>` : ''}
      <div class="web-empty-actions">
        <button class="button primary" type="submit">Validate and save</button>
        <button class="button ghost" type="button" id="nwc-connect-cancel">Cancel</button>
      </div>
      <p class="section-help compact-note">Use a wallet budget limit. Workstr only requests payments you confirm.</p>
    </form>`;
}

function zapModal(nwc: NwcViewState, message = ''): string {
  return `<div class="page-title">Zap Workstr</div>
    <p class="section-help">Send an in-app Nostr zap through ${html(nwc.walletLabel || 'your NWC wallet')}. Your signer creates the receipt request; your wallet approves the payment.</p>
    <form id="nwc-zap-form" class="nwc-form">
      <label><span>Amount (sats)</span><input id="nwc-zap-amount" name="amountSats" inputmode="numeric" autocomplete="off" value="${DEFAULT_ZAP_AMOUNT}" /></label>
      <label><span>Note (optional)</span><textarea id="nwc-zap-comment" name="comment" maxlength="280" placeholder="Thanks for Workstr"></textarea></label>
      ${message ? `<div class="auth-error">${html(message)}</div>` : ''}
      <div class="web-empty-actions">
        <button class="button primary" type="submit">Confirm zap</button>
        <button class="button ghost" type="button" id="nwc-zap-cancel">Cancel</button>
      </div>
    </form>`;
}

export function createNwcController(ctx: NwcControllerContext) {
  const { root, state, render, toast, openModal, closeModal, getSigner, refreshFunding } = ctx;

  async function loadConnection(): Promise<void> {
    try {
      const stored = await loadNwcConnection(activeNamespace(state));
      state.nwc = stored ? activeState(stored) : inactiveState();
    } catch (error) {
      state.nwc = inactiveState(safeErrorMessage(error), 'error');
    }
  }

  function showConnect(message = ''): void {
    openModal(connectModal(message));
    root.querySelector('#nwc-connect-cancel')?.addEventListener('click', closeModal);
    root.querySelector('#nwc-connect-form')?.addEventListener('submit', (event) => { void connect(event); });
  }

  async function connect(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const raw = (form.elements.namedItem('nwcConnection') as HTMLTextAreaElement).value;
    state.nwc = inactiveState('Validating wallet connection…', 'connecting');
    render();
    try {
      const parsed = parseNwcConnectionString(raw);
      const validation = await validateNwcConnection(parsed);
      if (!validation.ok) {
        state.nwc = inactiveState(connectionMessage(validation.error), 'error');
        render();
        showConnect(connectionMessage(validation.error));
        return;
      }
      const stored = await saveNwcConnection(activeNamespace(state), raw);
      state.nwc = activeState(stored, `Wallet connected${validation.value.alias ? `: ${validation.value.alias}` : ''}.`);
      closeModal();
      render();
      toast('Zap wallet connected');
    } catch (error) {
      const message = safeErrorMessage(error);
      state.nwc = inactiveState(message, 'error');
      render();
      showConnect(message);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm('Disconnect this NWC wallet from Workstr on this device?')) return;
    try {
      await clearNwcConnection(activeNamespace(state));
      state.nwc = inactiveState('Zap wallet disconnected.');
      render();
      toast('Zap wallet disconnected');
    } catch (error) {
      state.nwc = { ...state.nwc, status: 'error', message: safeErrorMessage(error) };
      render();
      toast('Could not disconnect wallet', 'bad');
    }
  }

  function showZap(message = ''): void {
    if (!state.nwc.active) {
      state.view = 'settings';
      render();
      showConnect('Connect a NWC wallet before sending in-app zaps.');
      return;
    }
    openModal(zapModal(state.nwc, message));
    root.querySelector('#nwc-zap-cancel')?.addEventListener('click', closeModal);
    root.querySelector('#nwc-zap-form')?.addEventListener('submit', (event) => { void zap(event); });
  }

  async function zap(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const amountSats = Number((form.elements.namedItem('amountSats') as HTMLInputElement).value);
    const comment = (form.elements.namedItem('comment') as HTMLTextAreaElement).value;
    state.nwc = { ...state.nwc, status: 'paying', message: 'Requesting invoice and sending to wallet…' };
    render();
    try {
      const stored = await loadNwcConnection(activeNamespace(state));
      if (!stored) {
        state.nwc = inactiveState('Connect a NWC wallet before sending in-app zaps.', 'error');
        render();
        showConnect(state.nwc.message);
        return;
      }
      const signer = await getSigner();
      const result = await executeSupportZap({ amountSats, comment, signer, nwcConnection: stored.connection });
      if (!result.ok) {
        const message = redactNwcSecrets(result.error.message);
        state.nwc = { ...activeState(stored), status: 'error', message };
        render();
        showZap(message);
        return;
      }
      state.nwc = { ...activeState(stored), status: 'success', message: `Zapped ${result.value.amountSats.toLocaleString('en-US')} sats. Receipt may take a moment to appear.` };
      closeModal();
      render();
      toast(`Zapped ${result.value.amountSats.toLocaleString('en-US')} sats`);
      state.support = { ...state.support, status: 'idle' };
      void refreshFunding();
    } catch (error) {
      const message = safeErrorMessage(error);
      state.nwc = { ...state.nwc, status: 'error', message };
      render();
      showZap(message);
    }
  }

  function bind(): void {
    root.querySelector('#nwc-connect')?.addEventListener('click', () => showConnect());
    root.querySelector('#nwc-disconnect')?.addEventListener('click', () => { void disconnect(); });
    root.querySelector('#open-nwc-zap')?.addEventListener('click', () => showZap());
  }

  return { bind, loadConnection, showConnect, showZap };
}
