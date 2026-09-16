import { html } from '../../app/format';
import type { AppState } from '../../app/state';
import type { MoneroWalletSnapshot, MoneroWalletUiState } from './types';

const XMR_ATOMIC_UNITS = 1_000_000_000_000n;
const DEFAULT_STATE: MoneroWalletUiState = { status: 'unknown' };
const BUSY: ReadonlyArray<MoneroWalletUiState['status']> = ['creating', 'restoring', 'opening', 'syncing', 'checking', 'claiming'];

export function moneroWalletBusy(status: MoneroWalletUiState['status'] | ''): boolean {
  return (BUSY as ReadonlyArray<string>).includes(status);
}

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
  if (moneroWalletBusy(state.status)) return { label: 'WORKING', ok: false };
  if (state.status === 'missing' || state.status === 'unknown') return { label: 'NOT SET', ok: false };
  if (state.status === 'error') return { label: 'CHECK', ok: false };
  return { label: 'LOCKED', ok: false };
}

function statusMessage(state: MoneroWalletUiState): string {
  return state.message ? `<p class="monero-wallet-status ${state.messageKind === 'bad' ? 'bad' : state.messageKind === 'ok' ? 'ok' : ''}">${html(state.message)}</p>` : '';
}

function walletSummary(state: MoneroWalletUiState, snapshot: MoneroWalletSnapshot): string {
  const balance = xmrAmount(snapshot.balance?.atomicBalance);
  const sync = snapshot.sync ? `${snapshot.sync.synchronized ? 'Synced' : 'Syncing'} · ${snapshot.sync.height ?? '—'}/${snapshot.sync.daemonHeight ?? '—'}` : 'Not synced yet';
  const busy = moneroWalletBusy(state.status) ? ' disabled' : '';
  const backup = state.backup ? `<div class="monero-wallet-backup">
    <p class="section-help bad"><strong>Recovery phrase:</strong> anyone with these words can spend this wallet. Write them down offline and do not paste them into support chats.</p>
    <code>${html(state.backup.seed)}</code>
    <p class="section-help">These are standard Monero words: with the restore height above, any Monero wallet app can restore this wallet.</p>
  </div>` : '';
  return `<div class="monero-wallet-summary">
    <div><strong>Receive</strong><code>${html(shortAddress(snapshot.metadata.creatorSubaddress))}</code></div>
    <div><strong>Balance</strong><span>${html(balance)}</span></div>
    <div><strong>Sync</strong><span>${html(sync)}</span></div>
    <div><strong>Restore height</strong><span>${html(String(snapshot.metadata.restoreHeight))}</span></div>
  </div>
  <div class="settings-row-actions">
    <button id="monero-wallet-sync" class="button payment"${busy}>Sync wallet</button>
    <button id="monero-wallet-balance" class="button"${busy}>Refresh balance</button>
    <button id="monero-wallet-show-backup" class="button"${busy}>${state.backup ? 'Hide recovery phrase' : 'Show recovery phrase'}</button>
    <button id="monero-wallet-use-address" class="button">Use for tips</button>
  </div>
  ${backup}
  <p class="section-help">Use for tips copies the wallet's creator subaddress into the public Monero tips address field. Press Save address there to publish it to Nostr relays.</p>`;
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

// A stored wallet offers only Open. Create and Restore would replace its seed, so they appear
// only once the vault confirms this account has no wallet.
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
      <button id="monero-wallet-create" class="button payment" ${busy ? 'disabled' : ''}>Create wallet</button>
    </div>
    <p class="section-help">You can also publish an address from any other Monero wallet in the tips card above; a Workstr wallet is optional.</p>
    <form id="monero-wallet-restore-form" class="monero-wallet-restore">
      <label><strong>Restore from seed</strong><textarea id="monero-wallet-seed" rows="3" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Monero recovery seed" ${busy ? 'disabled' : ''}></textarea></label>
      <label><span>Restore height</span><input id="monero-wallet-restore-height" type="number" min="0" step="1" inputmode="numeric" placeholder="blank scans from the start" ${busy ? 'disabled' : ''} /></label>
      <p class="section-help">Leave the height blank if you do not know it: the whole chain is scanned so no earlier payment is missed, which can take a long time.</p>
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
  const body = wallet.snapshot ? walletSummary(wallet, wallet.snapshot) : setupActions(wallet);
  return `<details class="settings-category monero-wallet-card" data-settings-section="monero-wallet">${summary}<div class="settings-category-body" id="monero-wallet-body">${statusMessage(wallet)}${body}</div></details>`;
}

export function moneroWalletBody(state: AppState): string {
  const wallet = state.moneroWallet ?? DEFAULT_STATE;
  if (state.deviceVault !== 'unlocked') return '<p class="section-help">Unlock Workstr to manage the encrypted Monero hot wallet.</p>';
  return `${statusMessage(wallet)}${wallet.snapshot ? walletSummary(wallet, wallet.snapshot) : setupActions(wallet)}`;
}
