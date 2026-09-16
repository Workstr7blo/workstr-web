import { deviceVault as defaultVault, type DeviceVault } from '../security/device-vault';
import { moneroAddressVisible } from '../features/support/payment-mode-views';
import { MoneroWalletCore } from '../features/monero/wallet-core';
import { moneroWalletBody } from '../features/monero/wallet-view';
import type { MoneroWalletUiState } from '../features/monero/types';
import type { AppState } from './state';

export interface MoneroWalletControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  repaintMoneroAddress(): void;
  vault?: DeviceVault;
  core?: MoneroWalletCore;
}

function safeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const line = raw.split('\n')[0].trim();
  return line ? line.slice(0, 140) : 'try again';
}

function restoreHeight(root: ParentNode): number | undefined {
  const raw = root.querySelector<HTMLInputElement>('#monero-wallet-restore-height')?.value.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function createMoneroWalletController(ctx: MoneroWalletControllerContext) {
  const { root, state, toast } = ctx;
  const vault = ctx.vault ?? defaultVault;
  const core = ctx.core ?? new MoneroWalletCore({ vault });

  function set(next: MoneroWalletUiState): void {
    state.moneroWallet = next;
    paint();
  }

  function paint(): void {
    const body = root.querySelector<HTMLElement>('#monero-wallet-body');
    if (body) body.innerHTML = moneroWalletBody(state);
    const card = root.querySelector<HTMLElement>('.monero-wallet-card');
    const pill = card?.querySelector<HTMLElement>('summary .status-pill');
    if (pill) {
      const label = state.deviceVault !== 'unlocked' ? 'LOCKED' : state.moneroWallet?.status === 'ready' ? 'READY' : state.moneroWallet?.status === 'stored' ? 'STORED' : ['creating', 'restoring', 'opening', 'syncing', 'checking'].includes(state.moneroWallet?.status || '') ? 'WORKING' : 'NOT SET';
      pill.textContent = label;
      pill.classList.toggle('ok', label === 'READY' || label === 'STORED');
    }
    bind();
  }

  async function refreshIfNeeded(): Promise<void> {
    if (state.deviceVault !== 'unlocked') { state.moneroWallet = { status: 'locked' }; return; }
    if (state.moneroWallet?.status && state.moneroWallet.status !== 'unknown') return;
    set({ status: 'checking', message: 'Checking this device for a Monero wallet…' });
    try {
      const hasWallet = await core.hasWallet();
      set(hasWallet ? { status: 'stored', message: 'Wallet is stored on this device. Open it to sync or publish its creator subaddress.', messageKind: 'ok' } : { status: 'missing', message: 'No Monero wallet is stored on this device yet.' });
    } catch (error) {
      set({ status: 'error', message: `Could not check wallet storage (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function createWallet(): Promise<void> {
    if (!vault.isUnlocked()) return set({ status: 'locked', message: 'Unlock Workstr before creating a Monero wallet.', messageKind: 'bad' });
    set({ status: 'creating', message: 'Creating wallet and dedicated creator subaddress…' });
    try {
      const snapshot = await core.createWallet();
      set({ status: 'ready', snapshot, message: 'Wallet created and saved in the device vault.', messageKind: 'ok' });
      toast('Monero wallet created');
    } catch (error) {
      set({ status: 'error', message: `Could not create wallet (${safeReason(error)}).`, messageKind: 'bad' });
      toast('Could not create Monero wallet', 'bad');
    }
  }

  async function openWallet(): Promise<void> {
    if (!vault.isUnlocked()) return set({ status: 'locked', message: 'Unlock Workstr before opening the Monero wallet.', messageKind: 'bad' });
    set({ status: 'opening', message: 'Opening wallet from the device vault…' });
    try {
      const snapshot = await core.openWallet();
      set({ status: 'ready', snapshot, message: 'Wallet opened. Sync before checking the balance.', messageKind: 'ok' });
    } catch (error) {
      set({ status: 'error', message: `Could not open wallet (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function restoreWallet(): Promise<void> {
    if (!vault.isUnlocked()) return set({ status: 'locked', message: 'Unlock Workstr before restoring a Monero wallet.', messageKind: 'bad' });
    const seed = root.querySelector<HTMLTextAreaElement>('#monero-wallet-seed')?.value.trim() || '';
    if (!seed) return set({ status: state.moneroWallet?.status ?? 'missing', message: 'Paste a Monero recovery seed to restore.', messageKind: 'bad' });
    set({ status: 'restoring', message: 'Restoring wallet into the device vault…' });
    try {
      const snapshot = await core.restoreWallet({ seed, restoreHeight: restoreHeight(root) });
      const field = root.querySelector<HTMLTextAreaElement>('#monero-wallet-seed');
      if (field) field.value = '';
      set({ status: 'ready', snapshot, message: 'Wallet restored and saved in the device vault.', messageKind: 'ok' });
      toast('Monero wallet restored');
    } catch (error) {
      set({ status: 'error', message: `Could not restore wallet (${safeReason(error)}).`, messageKind: 'bad' });
      toast('Could not restore Monero wallet', 'bad');
    }
  }

  async function syncWallet(): Promise<void> {
    if (!state.moneroWallet?.snapshot) return openWallet();
    set({ ...state.moneroWallet, status: 'syncing', message: 'Syncing wallet…' });
    try {
      const sync = await core.sync();
      const balance = await core.balance();
      set({ status: 'ready', snapshot: { ...state.moneroWallet.snapshot, sync, balance }, message: sync.synchronized ? 'Wallet synced.' : 'Wallet sync updated.', messageKind: 'ok' });
    } catch (error) {
      set({ ...state.moneroWallet, status: 'error', message: `Could not sync wallet (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function refreshBalance(): Promise<void> {
    if (!state.moneroWallet?.snapshot) return openWallet();
    try {
      const balance = await core.balance();
      set({ status: 'ready', snapshot: { ...state.moneroWallet.snapshot, balance }, message: 'Balance refreshed.', messageKind: 'ok' });
    } catch (error) {
      set({ ...state.moneroWallet, status: 'error', message: `Could not refresh balance (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function toggleBackupInfo(): Promise<void> {
    const current = state.moneroWallet;
    if (!current?.snapshot) return;
    if (current.backup) return set({ ...current, backup: null });
    if (!vault.isUnlocked()) return set({ ...current, status: 'locked', message: 'Unlock Workstr before showing the Monero recovery phrase.', messageKind: 'bad' });
    try {
      const backup = await core.backupInfo();
      set({ ...current, backup, message: 'Recovery phrase shown. Write it down offline and hide it when done.', messageKind: 'ok' });
    } catch (error) {
      set({ ...current, status: 'error', message: `Could not show recovery phrase (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function useForTips(): Promise<void> {
    const address = state.moneroWallet?.snapshot?.metadata.creatorSubaddress;
    if (!address) return;
    state.monero = { ...state.monero, draft: address, message: 'Wallet creator subaddress copied here. Save address to publish it.', messageKind: 'ok' };
    ctx.repaintMoneroAddress();
    if (!moneroAddressVisible(state)) ctx.render();
    toast('Creator subaddress ready to publish');
  }

  function bind(): void {
    root.querySelector('#monero-wallet-create')?.addEventListener('click', () => { void createWallet(); });
    root.querySelector('#monero-wallet-open')?.addEventListener('click', () => { void openWallet(); });
    root.querySelector('#monero-wallet-restore-form')?.addEventListener('submit', (event) => { event.preventDefault(); void restoreWallet(); });
    root.querySelector('#monero-wallet-sync')?.addEventListener('click', () => { void syncWallet(); });
    root.querySelector('#monero-wallet-balance')?.addEventListener('click', () => { void refreshBalance(); });
    root.querySelector('#monero-wallet-show-backup')?.addEventListener('click', () => { void toggleBackupInfo(); });
    root.querySelector('#monero-wallet-use-address')?.addEventListener('click', () => { void useForTips(); });
  }

  return {
    bind,
    refreshIfNeeded,
    async close(): Promise<void> {
      await core.close();
      if (state.moneroWallet?.status === 'ready') state.moneroWallet = { status: 'stored', message: 'Wallet closed with the device vault.', messageKind: 'ok' };
    }
  };
}
