import { deviceVault as defaultVault, type DeviceVault } from '../security/device-vault';
import { moneroAddressVisible } from '../features/support/payment-mode-views';
import { MoneroWalletCore, WALLET_ALREADY_STORED } from '../features/monero/wallet-core';
import { moneroWalletBody, moneroWalletBusy } from '../features/monero/wallet-view';
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

// Another tab or an earlier tap stored a wallet first. Nothing was overwritten; show the stored one.
function alreadyStored(error: unknown): MoneroWalletUiState | null {
  return error instanceof Error && error.message === WALLET_ALREADY_STORED
    ? { status: 'stored', stored: true, legacyAvailable: false, message: WALLET_ALREADY_STORED, messageKind: 'bad' }
    : null;
}

function safeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const line = raw.split('\n')[0].trim();
  return line ? line.slice(0, 140) : 'try again';
}

// Blank means "scan from the start"; anything else must be a whole non-negative number, so a
// typo is reported instead of silently becoming a different height.
function restoreHeight(root: ParentNode): number | undefined | null {
  const raw = root.querySelector<HTMLInputElement>('#monero-wallet-restore-height')?.value.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function createMoneroWalletController(ctx: MoneroWalletControllerContext) {
  const { root, state, toast } = ctx;
  const vault = ctx.vault ?? defaultVault;
  const core = ctx.core ?? new MoneroWalletCore({ vault, account: () => state.pubkey });
  // Bumped whenever the wallet is closed or the account changes. An async action that started
  // under an older generation drops its result rather than painting it over the new state.
  let generation = 0;

  function current(): MoneroWalletUiState {
    return state.moneroWallet ?? { status: 'unknown' };
  }

  // What the vault holds does not change with each status, so it is carried unless replaced.
  function set(next: MoneroWalletUiState): void {
    const { stored, legacyAvailable, addresses } = current();
    state.moneroWallet = { stored, legacyAvailable, addresses, ...next };
    paint();
    // The address section repaints only when its wallet label can change, so a draft being
    // typed there keeps its focus.
    if (String(addresses) !== String(state.moneroWallet.addresses)) ctx.repaintMoneroAddress();
  }

  function paint(): void {
    const body = root.querySelector<HTMLElement>('#monero-wallet-body');
    if (body) body.innerHTML = moneroWalletBody(state);
    const card = root.querySelector<HTMLElement>('.monero-wallet-card');
    const pill = card?.querySelector<HTMLElement>('summary .status-pill');
    if (pill) {
      const status = state.moneroWallet?.status || '';
      const label = state.deviceVault !== 'unlocked' ? 'LOCKED' : status === 'ready' ? 'READY' : status === 'stored' ? 'STORED' : moneroWalletBusy(status) ? 'WORKING' : 'NOT SET';
      pill.textContent = label;
      pill.classList.toggle('ok', label === 'READY' || label === 'STORED');
    }
    bind();
  }

  // Runs `work` unless another action is already running, and applies its outcome only if
  // nothing closed the wallet or switched the account meanwhile.
  async function guarded(busy: MoneroWalletUiState, work: () => Promise<MoneroWalletUiState>, onError: (error: unknown) => MoneroWalletUiState): Promise<void> {
    if (moneroWalletBusy(current().status)) return;
    const started = generation;
    set(busy);
    let next: MoneroWalletUiState;
    try {
      next = await work();
    } catch (error) {
      next = onError(error);
    }
    if (started === generation) set(next);
  }

  async function refreshIfNeeded(): Promise<void> {
    if (state.deviceVault !== 'unlocked') { state.moneroWallet = { status: 'locked' }; return; }
    if (state.moneroWallet?.status && state.moneroWallet.status !== 'unknown') return;
    const started = generation;
    set({ status: 'checking', message: 'Checking this device for a Monero wallet…' });
    let next: MoneroWalletUiState;
    try {
      const stored = await core.hasWallet();
      const legacyAvailable = !stored && await core.hasLegacyWallet();
      const addresses = stored ? await core.storedAddresses() : [];
      next = stored
        ? { status: 'stored', stored, legacyAvailable, addresses, message: 'Wallet is stored for this account. Open it to sync or use its creator subaddress.', messageKind: 'ok' }
        : { status: 'missing', stored, legacyAvailable, addresses, message: legacyAvailable ? 'A Monero wallet saved by an earlier version of Workstr is on this device.' : 'No Monero wallet is stored for this account yet.' };
    } catch (error) {
      next = { status: 'error', message: `Could not check wallet storage (${safeReason(error)}).`, messageKind: 'bad' };
    }
    if (started === generation) set(next);
  }

  function unlockedOr(message: string): boolean {
    if (vault.isUnlocked()) return true;
    set({ status: 'locked', message, messageKind: 'bad' });
    return false;
  }

  async function createWallet(): Promise<void> {
    if (!unlockedOr('Unlock Workstr before creating a Monero wallet.')) return;
    await guarded({ status: 'creating', message: 'Creating wallet and dedicated creator subaddress…' }, async () => {
      const snapshot = await core.createWallet();
      toast('Monero wallet created');
      return { status: 'ready', stored: true, legacyAvailable: false, addresses: [snapshot.metadata.creatorSubaddress, snapshot.metadata.primaryAddress], snapshot, message: 'Wallet created and saved in the device vault.', messageKind: 'ok' };
    }, (error) => {
      toast('Could not create Monero wallet', 'bad');
      return alreadyStored(error) ?? { status: 'error', message: `Could not create wallet (${safeReason(error)}).`, messageKind: 'bad' };
    });
  }

  async function openWallet(): Promise<void> {
    if (!unlockedOr('Unlock Workstr before opening the Monero wallet.')) return;
    await guarded({ status: 'opening', message: 'Opening wallet from the device vault…' }, async () => {
      const snapshot = await core.openWallet();
      return { status: 'ready', stored: true, snapshot, message: 'Wallet opened. Sync before checking the balance.', messageKind: 'ok' };
    }, (error) => ({ status: 'error', message: `Could not open wallet (${safeReason(error)}).`, messageKind: 'bad' }));
  }

  async function restoreWallet(): Promise<void> {
    if (!unlockedOr('Unlock Workstr before restoring a Monero wallet.')) return;
    const seed = root.querySelector<HTMLTextAreaElement>('#monero-wallet-seed')?.value.trim() || '';
    if (!seed) return set({ status: current().status, message: 'Paste a Monero recovery seed to restore.', messageKind: 'bad' });
    const height = restoreHeight(root);
    // A toast rather than a repaint, which would wipe the seed the user just pasted.
    if (height === null) return toast('Restore height must be a whole block number, or blank', 'bad');
    await guarded({ status: 'restoring', message: 'Restoring wallet into the device vault…' }, async () => {
      const snapshot = await core.restoreWallet({ seed, restoreHeight: height });
      toast('Monero wallet restored');
      return { status: 'ready', stored: true, legacyAvailable: false, addresses: [snapshot.metadata.creatorSubaddress, snapshot.metadata.primaryAddress], snapshot, message: 'Wallet restored and saved in the device vault.', messageKind: 'ok' };
    }, (error) => {
      toast('Could not restore Monero wallet', 'bad');
      return alreadyStored(error) ?? { status: 'error', message: `Could not restore wallet (${safeReason(error)}).`, messageKind: 'bad' };
    });
  }

  async function claimLegacyWallet(): Promise<void> {
    if (!unlockedOr('Unlock Workstr before moving the Monero wallet.')) return;
    await guarded({ status: 'claiming', message: 'Moving the wallet to this account…' }, async () => {
      const snapshot = await core.claimLegacyWallet();
      toast('Monero wallet moved to this account');
      return { status: 'stored', stored: true, legacyAvailable: false, addresses: [snapshot.metadata.creatorSubaddress, snapshot.metadata.primaryAddress], message: 'Wallet now belongs to this account. Open it to sync.', messageKind: 'ok' };
    }, (error) => alreadyStored(error) ?? { status: 'error', message: `Could not move wallet (${safeReason(error)}).`, messageKind: 'bad' });
  }

  function dismissLegacyWallet(): void {
    set({ status: current().status, legacyAvailable: false, message: 'The earlier wallet stays on this device, untouched.' });
  }

  async function syncWallet(): Promise<void> {
    const snapshot = current().snapshot;
    if (!snapshot) return openWallet();
    await guarded({ ...current(), status: 'syncing', message: 'Syncing wallet…' }, async () => {
      const sync = await core.sync();
      const balance = await core.balance();
      return { status: 'ready', snapshot: { ...snapshot, sync, balance }, message: sync.synchronized ? 'Wallet synced.' : 'Wallet sync updated.', messageKind: 'ok' };
    }, (error) => ({ status: 'error', snapshot, message: `Could not sync wallet (${safeReason(error)}).`, messageKind: 'bad' }));
  }

  async function refreshBalance(): Promise<void> {
    const snapshot = current().snapshot;
    if (!snapshot) return openWallet();
    await guarded({ ...current(), status: 'syncing', message: 'Refreshing balance…' }, async () => {
      const balance = await core.balance();
      return { status: 'ready', snapshot: { ...snapshot, balance }, message: 'Balance refreshed.', messageKind: 'ok' };
    }, (error) => ({ status: 'error', snapshot, message: `Could not refresh balance (${safeReason(error)}).`, messageKind: 'bad' }));
  }

  async function toggleBackupInfo(): Promise<void> {
    const shown = current();
    if (!shown.snapshot || moneroWalletBusy(shown.status)) return;
    if (shown.backup) return set({ ...shown, backup: null });
    if (!unlockedOr('Unlock Workstr before showing the Monero recovery phrase.')) return;
    const started = generation;
    try {
      const backup = await core.backupInfo();
      if (started === generation) set({ ...current(), backup, message: 'Recovery phrase shown. Write it down offline and hide it when done.', messageKind: 'ok' });
    } catch (error) {
      if (started === generation) set({ ...current(), status: 'error', message: `Could not show recovery phrase (${safeReason(error)}).`, messageKind: 'bad' });
    }
  }

  async function useForTips(): Promise<void> {
    const address = current().snapshot?.metadata.creatorSubaddress;
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
    root.querySelector('#monero-wallet-claim')?.addEventListener('click', () => { void claimLegacyWallet(); });
    root.querySelector('#monero-wallet-claim-dismiss')?.addEventListener('click', dismissLegacyWallet);
    root.querySelector('#monero-wallet-recheck')?.addEventListener('click', () => { state.moneroWallet = { status: 'unknown' }; void refreshIfNeeded(); });
  }

  return {
    bind,
    refreshIfNeeded,
    // Leaving Settings hides the recovery phrase; it is shown again only by another tap.
    hideBackup(): void {
      if (state.moneroWallet?.backup) state.moneroWallet = { ...state.moneroWallet, backup: null };
    },
    // Vault lock: the wallet stays this account's, so what is stored is still known.
    async close(): Promise<void> {
      generation += 1;
      const was = current();
      if (was.snapshot) state.moneroWallet = { status: 'stored', stored: true, addresses: was.addresses, message: 'Wallet closed with the device vault.', messageKind: 'ok' };
      else if (moneroWalletBusy(was.status)) state.moneroWallet = { status: 'unknown' };
      await core.close();
    },
    // Account switch or reset: nothing about the previous account's wallet carries over.
    reset(): void {
      generation += 1;
      state.moneroWallet = { status: 'unknown' };
      void core.close();
    }
  };
}
