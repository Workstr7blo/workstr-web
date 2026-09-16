import { html } from '../../app/format';
import type { AppState } from '../../app/state';
import type { MoneroWalletSnapshot, MoneroWalletUiState } from './types';

const XMR_ATOMIC_UNITS = 1_000_000_000_000n;
const DEFAULT_STATE: MoneroWalletUiState = { status: 'unknown' };

function shortAddress(address: string): string {
  return address.length <= 18 ? address : `${address.slice(0, 8)}…${address.slice(-8)}`;
}

function xmrAmount(atomic: string | undefined): string {
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
  if (['creating', 'restoring', 'opening', 'syncing', 'checking'].includes(state.status)) return { label: 'WORKING', ok: false };
  if (state.status === 'missing' || state.status === 'unknown') return { label: 'NOT SET', ok: false };
  if (state.status === 'error') return { label: 'CHECK', ok: false };
  return { label: 'LOCKED', ok: false };
}

function statusMessage(state: MoneroWalletUiState): string {
  return state.message ? `<p class="monero-wallet-status ${state.messageKind === 'bad' ? 'bad' : state.messageKind === 'ok' ? 'ok' : ''}">${html(state.message)}</p>` : '';
}

function walletSummary(snapshot: MoneroWalletSnapshot): string {
  const balance = xmrAmount(snapshot.balance?.atomicBalance);
  const sync = snapshot.sync ? `${snapshot.sync.synchronized ? 'Synced' : 'Syncing'} · ${snapshot.sync.height ?? '—'}/${snapshot.sync.daemonHeight ?? '—'}` : 'Not synced yet';
  return `<div class="monero-wallet-summary">
    <div><strong>Receive</strong><code>${html(shortAddress(snapshot.metadata.creatorSubaddress))}</code></div>
    <div><strong>Balance</strong><span>${html(balance)}</span></div>
    <div><strong>Sync</strong><span>${html(sync)}</span></div>
  </div>
  <div class="settings-row-actions">
    <button id="monero-wallet-sync" class="button payment">Sync wallet</button>
    <button id="monero-wallet-balance" class="button">Refresh balance</button>
    <button id="monero-wallet-use-address" class="button">Use for tips</button>
  </div>
  <p class="section-help">Use for tips copies the wallet's creator subaddress into the public Monero tips address field. Press Save address there to publish it to Nostr relays.</p>`;
}

function setupActions(state: MoneroWalletUiState): string {
  const busy = ['creating', 'restoring', 'opening', 'syncing', 'checking'].includes(state.status);
  return `<div class="monero-wallet-setup">
    <div class="settings-row-actions">
      <button id="monero-wallet-create" class="button payment" ${busy ? 'disabled' : ''}>Create wallet</button>
      <button id="monero-wallet-open" class="button" ${busy ? 'disabled' : ''}>Open existing</button>
    </div>
    <form id="monero-wallet-restore-form" class="monero-wallet-restore">
      <label><strong>Restore from seed</strong><textarea id="monero-wallet-seed" rows="3" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Monero recovery seed" ${busy ? 'disabled' : ''}></textarea></label>
      <label><span>Restore height</span><input id="monero-wallet-restore-height" type="number" min="0" inputmode="numeric" placeholder="optional" ${busy ? 'disabled' : ''} /></label>
      <button class="button" type="submit" ${busy ? 'disabled' : ''}>Restore wallet</button>
    </form>
  </div>`;
}

export function moneroWalletCard(state: AppState): string {
  const wallet = state.moneroWallet ?? DEFAULT_STATE;
  const badge = pill(wallet, state.deviceVault);
  const summary = `<summary><span class="settings-category-copy"><strong>Monero wallet</strong><small>Self-custodial wallet on this device</small></span><span class="status-pill ${badge.ok ? 'ok' : ''}">${badge.label}</span></summary>`;
  if (state.deviceVault !== 'unlocked') {
    return `<details class="settings-category monero-wallet-card" data-settings-section="monero-wallet">${summary}<div class="settings-category-body"><p class="section-help">Unlock Workstr to manage the encrypted Monero hot wallet. Wallet secrets stay in the device vault and never sync.</p></div></details>`;
  }
  const body = wallet.snapshot ? walletSummary(wallet.snapshot) : setupActions(wallet);
  return `<details class="settings-category monero-wallet-card" data-settings-section="monero-wallet">${summary}<div class="settings-category-body" id="monero-wallet-body">${statusMessage(wallet)}${body}</div></details>`;
}

export function moneroWalletBody(state: AppState): string {
  const wallet = state.moneroWallet ?? DEFAULT_STATE;
  if (state.deviceVault !== 'unlocked') return '<p class="section-help">Unlock Workstr to manage the encrypted Monero hot wallet.</p>';
  return `${statusMessage(wallet)}${wallet.snapshot ? walletSummary(wallet.snapshot) : setupActions(wallet)}`;
}
