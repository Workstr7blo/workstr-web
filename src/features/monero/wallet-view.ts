import { html } from '../../app/format';
import type { AppState } from '../../app/state';
import type { MoneroWalletSnapshot, MoneroWalletUiState } from './types';

const XMR_ATOMIC_UNITS = 1_000_000_000_000n;
const DEFAULT_STATE: MoneroWalletUiState = { status: 'unknown' };
const BUSY: ReadonlyArray<MoneroWalletUiState['status']> = ['creating', 'restoring', 'opening', 'syncing', 'checking', 'claiming'];

export function moneroWalletBusy(status: MoneroWalletUiState['status'] | ''): boolean {
  return (BUSY as ReadonlyArray<string>).includes(status);
}

export function xmrAmount(atomic: string | undefined): string {
  if (!atomic) return '—';
  const value = BigInt(atomic);
  const whole = value / XMR_ATOMIC_UNITS;
  const frac = (value % XMR_ATOMIC_UNITS).toString().padStart(12, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac.slice(0, 6)}` : ''} XMR`;
}

function pill(state: MoneroWalletUiState, deviceVault: AppState['deviceVault']): { label: string; ok: boolean } {
  if (deviceVault !== 'unlocked') return { label: 'LOCKED', ok: false };
  if (state.status === 'ready') return { label: 'READY', ok: true };
  if (state.status === 'stored') return { label: 'STORED', ok: true };
  if (moneroWalletBusy(state.status)) return { label: 'WORKING', ok: false };
  if (state.status === 'missing' || state.status === 'unknown') return { label: 'NOT SET', ok: false };
  if (state.status === 'error') return { label: 'CHECK', ok: false };
  return { label: 'LOCKED', ok: false };
}

function statusMessage(state: MoneroWalletUiState): string {
  return state.message ? `<p class="monero-wallet-status ${state.messageKind === 'bad' ? 'bad' : state.messageKind === 'ok' ? 'ok' : ''}">${html(state.message)}</p>` : '';
}

// Raw block heights, behind a disclosure of their own and closed by default. They answer one
// question - "is it actually talking to the node" - and that question belongs to whoever is
// troubleshooting, not to someone who just wants to receive a tip (#261). Balance, receive and
// the sync state in words live on the Tip Jar page; the ring in the navigation shows progress.
function diagnostics(snapshot: MoneroWalletSnapshot): string {
  const { sync } = snapshot;
  const status = sync ? (sync.synchronized ? 'Synced' : 'Syncing') : 'Not synced yet';
  return `<details class="settings-inline-advanced monero-wallet-diagnostics">
    <summary>Diagnostics</summary>
    <div class="monero-wallet-diagnostics-body">
      <div class="settings-subtle-row"><span>Wallet height</span><strong>${html(String(sync?.height ?? '—'))}</strong></div>
      <div class="settings-subtle-row"><span>Node height</span><strong>${html(String(sync?.daemonHeight ?? '—'))}</strong></div>
      <div class="settings-subtle-row"><span>Wallet status</span><strong>${html(status)}</strong></div>
      <div class="settings-subtle-row"><span>Network</span><strong>${html(snapshot.metadata.network)}</strong></div>
    </div>
  </details>`;
}

// An earlier Workstr kept one wallet for the whole device. It is never adopted silently:
// giving it to this account links it to this identity, so the user decides.
function legacyPrompt(busy: boolean): string {
  return `<div class="monero-wallet-legacy">
    <p class="section-help">A Monero wallet saved by an earlier version of Workstr is on this device. Use it for this account? It then belongs only to this account.</p>
    <div class="settings-row-actions">
      <button id="monero-wallet-claim" class="button payment" ${busy ? 'disabled' : ''}>Use for this account</button>
      <button id="monero-wallet-claim-dismiss" class="button" ${busy ? 'disabled' : ''}>Not now</button>
    </div>
  </div>`;
}

// A stored wallet offers only Open. Creating would leave the stored seed unreachable, so it
// appears only once the vault confirms this account has no wallet - and restoring lives in Data
// & Sync beside the training backup, where someone looking to get their things back will go.
function setupActions(state: MoneroWalletUiState): string {
  const busy = moneroWalletBusy(state.status);
  if (state.stored || state.status === 'stored') {
    return `<div class="monero-wallet-setup">
    <div class="settings-row-actions">
      <button id="monero-wallet-open" class="button payment" ${busy ? 'disabled' : ''}>Open wallet</button>
    </div>
  </div>`;
  }
  // Storage has not answered (or could not be read): offer nothing that writes to it.
  if (state.stored === undefined && state.status !== 'missing') {
    return state.status === 'error' ? `<div class="settings-row-actions"><button id="monero-wallet-recheck" class="button" ${busy ? 'disabled' : ''}>Check again</button></div>` : '';
  }
  return `<div class="monero-wallet-setup">
    ${state.legacyAvailable ? legacyPrompt(busy) : ''}
    <div class="settings-row-actions">
      <button id="monero-wallet-create" class="button payment" ${busy ? 'disabled' : ''}>Create Tip Jar</button>
    </div>
    <p class="section-help">Already have one? Restore it from a backup file or a recovery phrase under Data &amp; Sync. You can also publish an address from any other Monero wallet in the Tip Jar card above.</p>
  </div>`;
}

export function moneroWalletCard(state: AppState): string {
  const wallet = state.moneroWallet ?? DEFAULT_STATE;
  const badge = pill(wallet, state.deviceVault);
  const summary = `<summary><span class="settings-category-copy"><strong>Tip Jar wallet</strong><small>Advanced: setup and diagnostics</small></span><span class="status-pill ${badge.ok ? 'ok' : ''}">${badge.label}</span></summary>`;
  if (state.deviceVault !== 'unlocked') {
    return `<details class="settings-category monero-wallet-card" data-settings-section="monero-wallet">${summary}<div class="settings-category-body"><p class="section-help">Unlock Workstr to manage the encrypted Monero hot wallet. Wallet secrets stay in the device vault and never sync.</p></div></details>`;
  }
  return `<details class="settings-category monero-wallet-card" data-settings-section="monero-wallet">${summary}<div class="settings-category-body" id="monero-wallet-body">${moneroWalletBody(state)}</div></details>`;
}

export function moneroWalletBody(state: AppState): string {
  const wallet = state.moneroWallet ?? DEFAULT_STATE;
  if (state.deviceVault !== 'unlocked') return '<p class="section-help">Unlock Workstr to manage the encrypted Monero hot wallet.</p>';
  return `${statusMessage(wallet)}${wallet.snapshot ? diagnostics(wallet.snapshot) : setupActions(wallet)}`;
}
