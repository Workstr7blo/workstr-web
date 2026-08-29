import { LOCAL_NAMESPACE } from '../db/adopt';
import { executeSupportZap } from '../nostr/support-zap';
import { executeWorkoutProgramZapWithStatus } from '../nostr/program-zap-status';
import { validateNwcConnection } from '../nostr/nwc-client';
import { NwcError, maskNwcConnectionString, parseNwcConnectionString, redactNwcSecrets, type NwcConnection } from '../nostr/nwc';
import {
  clearNwcConnection,
  loadNwcConnection,
  saveNwcConnection,
  NwcSecureStorageError,
  type StoredNwcConnection
} from '../nostr/nwc-storage';
import type { WorkoutProgramZapSource } from '../nostr/zaps';
import type { Signer } from '../signer/types';
import { sheetToProgram } from '../features/sheets/views';
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
const DEFAULT_PROGRAM_ZAP_AMOUNT = 21;

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

function programZapRecipientLabel(program: WorkoutProgramZapSource): string {
  if (program.zapRecipient?.lud16) return program.zapRecipient.lud16;
  if (program.lud16) return program.lud16;
  if (program.zapRecipient?.lud06) return 'creator LNURL';
  if (program.lud06) return 'creator LNURL';
  return 'the creator wallet';
}

function programZapModal(program: WorkoutProgramZapSource, nwc: NwcViewState, message = '', busy = false): string {
  const walletReady = nwc.active;
  const recipient = programZapRecipientLabel(program);
  return `<div class="page-title">Zap program creator</div>
    <p class="section-help">Send a Nostr zap to the creator of <strong>${html(program.name || 'this workout program')}</strong>. Workstr signs a NIP-57 zap request, asks ${html(recipient)} for an invoice, then sends it to your NWC wallet.</p>
    <p class="section-help compact-note">Recipient: ${html(recipient)}</p>
    ${walletReady ? `<p class="section-help compact-note">Wallet: ${html(nwc.walletLabel || 'NWC wallet')}${nwc.relayLabel ? ` · ${html(nwc.relayLabel)}` : ''}</p>` : '<div class="auth-error">Connect a zap wallet before sending creator zaps.</div>'}
    <form id="nwc-program-zap-form" class="nwc-form">
      <label><span>Amount (sats)</span><input id="nwc-program-zap-amount" name="amountSats" inputmode="numeric" autocomplete="off" value="${DEFAULT_PROGRAM_ZAP_AMOUNT}" /></label>
      <label><span>Note (optional)</span><textarea id="nwc-program-zap-comment" name="comment" maxlength="280" placeholder="Great program — thanks!"></textarea></label>
      ${message ? `<div class="auth-error">${html(redactNwcSecrets(message))}</div>` : ''}
      <div class="web-empty-actions">
        <button class="button primary" type="submit" ${walletReady && !busy ? '' : 'disabled'}>${busy ? 'Sending zap…' : 'Confirm zap'}</button>
        ${walletReady ? '' : '<button class="button primary" type="button" id="nwc-program-connect">Connect wallet</button>'}
        <button class="button ghost" type="button" id="nwc-program-zap-cancel">Cancel</button>
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

  function programFromAddress(address: string): WorkoutProgramZapSource | null {
    const local = state.sheets.map(sheetToProgram).find((item) => item.address === address);
    if (local) {
      const sheet = state.sheets.find((item) => item.id === Number(address.slice('local:'.length)));
      const profile = sheet?.nostr_pubkey ? state.authorProfiles?.[sheet.nostr_pubkey] : undefined;
      return {
        ...local,
        pubkey: sheet?.nostr_pubkey || local.pubkey,
        address: sheet?.nostr_address || local.address,
        eventId: sheet?.nostr_event_id || local.eventId,
        lud16: profile?.lud16,
        lud06: profile?.lud06
      };
    }
    const remote = state.programs.find((item) => item.address === address);
    if (!remote) return null;
    const profile = state.authorProfiles?.[remote.pubkey];
    return { ...remote, lud16: profile?.lud16, lud06: profile?.lud06 };
  }

  function bindProgramZapModal(address: string): void {
    root.querySelector('#nwc-program-zap-cancel')?.addEventListener('click', closeModal);
    root.querySelector('#nwc-program-connect')?.addEventListener('click', () => showConnect('Connect a NWC wallet, then return to this program and tap Zap creator.'));
    root.querySelector('#nwc-program-zap-form')?.addEventListener('submit', (event) => { void zapProgram(event, address); });
  }

  function showProgramZap(address: string, message = '', busy = false): void {
    const program = programFromAddress(address);
    if (!program) { toast('Program not found', 'bad'); return; }
    openModal(programZapModal(program, state.nwc, message, busy));
    bindProgramZapModal(address);
  }

  function updateProgramAttempt(attempt: AppState['programZapAttempts'][number]): void {
    state.programZapAttempts = [attempt, ...(state.programZapAttempts || []).filter((existing) => existing.id !== attempt.id)].slice(0, 50);
  }

  async function zapProgram(event: Event, address: string): Promise<void> {
    event.preventDefault();
    const program = programFromAddress(address);
    if (!program) { toast('Program not found', 'bad'); return; }
    if (!state.store) { toast('Open a local account before zapping programs.', 'bad'); return; }
    const form = event.target as HTMLFormElement;
    const amountSats = Number((form.elements.namedItem('amountSats') as HTMLInputElement).value);
    const comment = (form.elements.namedItem('comment') as HTMLTextAreaElement).value;
    state.nwc = { ...state.nwc, status: 'paying', message: `Zapping ${program.name}…` };
    render();
    showProgramZap(address, 'Requesting invoice and sending to wallet…', true);
    try {
      const stored = await loadNwcConnection(activeNamespace(state));
      if (!stored) {
        state.nwc = inactiveState('Connect a NWC wallet before zapping program creators.', 'error');
        render();
        showProgramZap(address, state.nwc.message);
        return;
      }
      const signer = await getSigner();
      if (!signer) {
        state.nwc = { ...activeState(stored), status: 'error', message: 'Sign in before sending program zaps so Workstr can create a Nostr receipt request.' };
        render();
        showProgramZap(address, state.nwc.message);
        return;
      }
      const { attempt, result } = await executeWorkoutProgramZapWithStatus(state.store, {
        program,
        amountSats,
        comment,
        signer,
        nwcConnection: stored.connection
      }, {
        onStatus: ({ attempt: update }) => {
          updateProgramAttempt(update);
          if (update.status === 'pending') {
            state.nwc = { ...activeState(stored), status: 'paying', message: `Sending ${update.amountSats.toLocaleString('en-US')} sats to ${update.programName}…` };
            render();
            showProgramZap(address, state.nwc.message, true);
          }
        }
      });
      updateProgramAttempt(attempt);
      if (!result.ok) {
        const message = redactNwcSecrets(result.error.message);
        state.nwc = { ...activeState(stored), status: 'error', message };
        render();
        showProgramZap(address, message);
        return;
      }
      state.nwc = { ...activeState(stored), status: 'success', message: `Zapped ${result.value.amountSats.toLocaleString('en-US')} sats to ${program.name}.` };
      closeModal();
      render();
      toast(`Zapped ${result.value.amountSats.toLocaleString('en-US')} sats to ${program.name}`);
    } catch (error) {
      const message = safeErrorMessage(error);
      state.nwc = { ...state.nwc, status: 'error', message };
      render();
      showProgramZap(address, message);
    }
  }

  function bind(): void {
    root.querySelector('#nwc-connect')?.addEventListener('click', () => showConnect());
    root.querySelector('#nwc-disconnect')?.addEventListener('click', () => { void disconnect(); });
    root.querySelector('#open-nwc-zap')?.addEventListener('click', () => showZap());
    root.querySelectorAll<HTMLElement>('[data-zap-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      showProgramZap(button.dataset.zapProgram || '');
    }));
  }

  return { bind, loadConnection, showConnect, showZap, showProgramZap };
}
