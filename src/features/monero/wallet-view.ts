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

function nodeLabel(snapshot: MoneroWalletSnapshot | undefined): string {
  if (!snapshot) return '—';
  const { node } = snapshot.metadata;
  return `${node.host}:${node.port}`;
}

function statusLabel(wallet: MoneroWalletUiState, snapshot: MoneroWalletSnapshot | undefined): string {
  if (snapshot?.sync) return snapshot.sync.synchronized ? 'Synced' : 'Syncing';
  if (wallet.status === 'ready') return 'Opened, not synced yet';
  if (wallet.status === 'stored') return 'Stored';
  if (wallet.status === 'missing') return 'Not set up';
  if (wallet.status === 'error') return 'Error';
  if (moneroWalletBusy(wallet.status)) return 'Working';
  return 'Not checked yet';
}

// Raw wallet and node telemetry belongs to the support/debugging drawer, not normal Tip Jar
// configuration. Balance, receive/send and readiness live on the Tip Jar page; the nav ring
// owns live sync progress. This view only answers "what should support inspect?" (#275).
function diagnostics(wallet: MoneroWalletUiState): string {
  const snapshot = wallet.snapshot ?? undefined;
  const sync = snapshot?.sync;
  return `<details class="settings-inline-advanced monero-wallet-diagnostics">
    <summary>Tip Jar</summary>
    <div class="monero-wallet-diagnostics-body">
      <div class="settings-subtle-row"><span>Wallet height</span><strong>${html(String(sync?.height ?? '—'))}</strong></div>
      <div class="settings-subtle-row"><span>Node height</span><strong>${html(String(sync?.daemonHeight ?? '—'))}</strong></div>
      <div class="settings-subtle-row"><span>Wallet status</span><strong>${html(statusLabel(wallet, snapshot))}</strong></div>
      <div class="settings-subtle-row"><span>Network</span><strong>${html(snapshot?.metadata.network ?? '—')}</strong></div>
      <div class="settings-subtle-row"><span>Node</span><strong>${html(nodeLabel(snapshot))}</strong></div>
    </div>
  </details>`;
}

export function moneroWalletDiagnostics(state: AppState): string {
  return diagnostics(state.moneroWallet ?? DEFAULT_STATE);
}
