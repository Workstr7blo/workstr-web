import { deviceVault as defaultVault, type DeviceVault } from '../security/device-vault';
import { MoneroWalletCore, WALLET_ALREADY_STORED } from '../features/monero/wallet-core';
import { updateTipJarBackupSection } from '../features/monero/wallet-backup-view';
import { moneroWalletBody, moneroWalletBusy } from '../features/monero/wallet-view';
import type { MoneroWalletRestoreRequest, MoneroWalletUiState, TipJarWalletTx } from '../features/monero/types';
import type { TipJarBackupPayload } from '../features/monero/wallet-backup';
import type { AppState } from './state';
import { tipJarOn } from '../features/monero/tip-jar-state';

// Periodic re-sync while the Tip Jar is on, the vault is unlocked and the page is visible.
export const TIP_JAR_RESYNC_MS = 120_000;
// A background sync this far behind is shown as syncing rather than silently catching up.
const VISIBLE_SYNC_BLOCKS = 10;

export interface MoneroWalletControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  repaintMoneroAddress(): void;
  // Every wallet state change, so the Tip Jar nav badge and page follow it.
  onChange?(): void;
  // The open wallet's id and, after a sync, its transaction list (null when only opened, or
  // when the runtime could not list them). Tip Jar activity is joined onto it.
  onActivity?(walletId: string, txs: TipJarWalletTx[] | null): void;
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

export function createMoneroWalletController(ctx: MoneroWalletControllerContext) {
  const { root, state, toast } = ctx;
  const vault = ctx.vault ?? defaultVault;
  const core = ctx.core ?? new MoneroWalletCore({ vault, account: () => state.pubkey });
  // Bumped whenever the wallet is closed or the account changes. An async action that started
  // under an older generation drops its result rather than painting it over the new state.
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  // The first sync after an open always shows progress: the saved state may be days behind.
  let syncedThisSession = false;

  function current(): MoneroWalletUiState {
    return state.moneroWallet ?? { status: 'unknown' };
  }

  // What the vault holds does not change with each status, so it is carried unless replaced.
  function set(next: MoneroWalletUiState): void {
    const { stored, legacyAvailable, addresses } = current();
    state.moneroWallet = { stored, legacyAvailable, addresses, ...next };
    paint();
    ctx.onChange?.();
    // The address section repaints only when its wallet label can change, so a draft being
    // typed there keeps its focus.
    if (String(addresses) !== String(state.moneroWallet.addresses)) ctx.repaintMoneroAddress();
  }

  function paint(): void {
    const body = root.querySelector<HTMLElement>('#monero-wallet-body');
    if (body) body.innerHTML = moneroWalletBody(state);
    // The Tip Jar backup controls in Data & Sync read the same wallet state: whether there is
    // anything to export, and the recovery phrase once it has been revealed.
    updateTipJarBackupSection(root, state);
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
      ctx.onActivity?.(snapshot.metadata.id, null);
      return { status: 'ready', stored: true, snapshot, message: 'Wallet opened. Sync before checking the balance.', messageKind: 'ok' };
    }, (error) => ({ status: 'error', message: `Could not open wallet (${safeReason(error)}).`, messageKind: 'bad' }));
  }

  // The seed and height are the caller's to supply, whether they came from an encrypted backup
  // file or from a recovery phrase typed into Advanced recovery. `replace` is only ever true
  // after the user has confirmed replacing the wallet already on this device.
  async function restoreWallet(request: MoneroWalletRestoreRequest): Promise<boolean> {
    if (!unlockedOr('Unlock Workstr before restoring a Monero wallet.')) return false;
    let restored = false;
    await guarded({ status: 'restoring', message: 'Restoring wallet into the device vault…' }, async () => {
      const snapshot = await core.restoreWallet(request);
      restored = true;
      toast('Tip Jar restored');
      return { status: 'ready', stored: true, legacyAvailable: false, addresses: [snapshot.metadata.creatorSubaddress, snapshot.metadata.primaryAddress], snapshot, backup: null, message: 'Tip Jar restored and saved in the device vault.', messageKind: 'ok' };
    }, (error) => {
      toast('Could not restore the Tip Jar', 'bad');
      return alreadyStored(error) ?? { status: 'error', message: `Could not restore wallet (${safeReason(error)}).`, messageKind: 'bad' };
    });
    return restored;
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

  // A foreground sync shows progress. A background one (the periodic re-sync of a wallet that
  // was already synchronized) keeps the Tip Jar ready, unless it turns out to be far behind.
  async function syncWallet(background = false): Promise<void> {
    const snapshot = current().snapshot;
    if (!snapshot) return openWallet();
    if (syncing || moneroWalletBusy(current().status)) return;
    syncing = true;
    const started = generation;
    if (!background) set({ ...current(), status: 'syncing', syncProgress: 0, message: 'Syncing wallet…' });
    let painted = 0;
    const onProgress = (fraction: number, remaining: number): void => {
      if (started !== generation) return;
      const shown = current();
      if (shown.status === 'ready' && remaining > VISIBLE_SYNC_BLOCKS) state.moneroWallet = { ...shown, status: 'syncing', message: 'Syncing wallet…' };
      else if (shown.status !== 'syncing') return;
      // Progress reports arrive per batch of blocks; the badge needs a few updates a second at most.
      const now = Date.now();
      if (now - painted < 500 && fraction < 1) return;
      painted = now;
      state.moneroWallet = { ...current(), syncProgress: Math.min(1, Math.max(0, fraction || 0)) };
      ctx.onChange?.();
    };
    try {
      const sync = await core.sync(onProgress);
      const balance = await core.balance();
      // Activity is a view on top of the sync; a runtime that cannot list transactions must not
      // turn a good sync into an error.
      const txs = await core.transactions().catch(() => null);
      if (started === generation) {
        set({ status: 'ready', snapshot: { ...snapshot, sync, balance }, backup: current().backup, message: sync.synchronized ? 'Wallet synced.' : 'Wallet sync updated.', messageKind: 'ok' });
        ctx.onActivity?.(snapshot.metadata.id, txs);
      }
    } catch (error) {
      if (started === generation) set({ status: 'error', snapshot, message: `Could not sync wallet (${safeReason(error)}).`, messageKind: 'bad' });
    } finally {
      syncing = false;
    }
  }

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function canAutoSync(): boolean {
    return tipJarOn(state) && Boolean(state.pubkey) && state.deviceVault === 'unlocked' && vault.isUnlocked();
  }

  // The Tip Jar keeps itself current: find the account's wallet, open it, sync it, and come back
  // later. Nothing here creates, restores or overwrites a wallet.
  async function autoSync(): Promise<void> {
    clearTimer();
    if (!canAutoSync()) return;
    const started = generation;
    await refreshIfNeeded();
    if (started !== generation || !canAutoSync()) return;
    if (current().stored && !moneroWalletBusy(current().status)) {
      if (!core.isOpen()) await openWallet();
      if (started !== generation || !canAutoSync()) return;
      if (core.isOpen() && current().snapshot) await syncWallet(current().status === 'ready' && Boolean(current().snapshot?.sync?.synchronized) && syncedThisSession);
      syncedThisSession = syncedThisSession || current().snapshot?.sync?.synchronized === true;
    }
    if (started === generation && canAutoSync() && !(typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
      timer = setTimeout(() => { void autoSync(); }, TIP_JAR_RESYNC_MS);
    }
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

  function bind(): void {
    root.querySelector('#monero-wallet-create')?.addEventListener('click', () => { void createWallet().then(autoSync); });
    root.querySelector('#monero-wallet-open')?.addEventListener('click', () => { void openWallet().then(autoSync); });
    root.querySelector('#monero-wallet-claim')?.addEventListener('click', () => { void claimLegacyWallet().then(autoSync); });
    root.querySelector('#monero-wallet-claim-dismiss')?.addEventListener('click', dismissLegacyWallet);
    root.querySelector('#monero-wallet-recheck')?.addEventListener('click', () => { state.moneroWallet = { status: 'unknown' }; void refreshIfNeeded(); });
  }

  // A PWA can be suspended for hours. Coming back to the foreground resumes the sync at once;
  // going to the background stops scheduling one.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearTimer();
      else if (canAutoSync()) void autoSync();
    });
  }

  function stopAutoSync(): void {
    clearTimer();
    syncedThisSession = false;
  }

  return {
    bind,
    refreshIfNeeded,
    autoSync,
    // Tip Jar create from its own page; Settings offers the same action.
    createWallet: () => createWallet().then(autoSync),
    // Restoring and revealing the recovery phrase are driven from Data & Sync, but the wallet
    // lifecycle stays here so there is one place that decides what `state.moneroWallet` says.
    restore: (request: MoneroWalletRestoreRequest) => restoreWallet(request).then(async (ok) => { if (ok) await autoSync(); return ok; }),
    toggleRecoveryPhrase: toggleBackupInfo,
    backupPayload: (): Promise<TipJarBackupPayload> => core.backupPayload(),
    // Tip Jar switched off: nothing keeps talking to the Monero node.
    async stop(): Promise<void> {
      stopAutoSync();
      generation += 1;
      const was = current();
      if (was.snapshot || core.isOpen()) state.moneroWallet = { status: 'stored', stored: true, addresses: was.addresses, message: 'Wallet closed while Tip Jar is off.', messageKind: 'ok' };
      else if (moneroWalletBusy(was.status)) state.moneroWallet = { status: 'unknown' };
      ctx.onChange?.();
      await core.close();
    },
    // Leaving Settings hides the recovery phrase; it is shown again only by another tap.
    hideBackup(): void {
      if (state.moneroWallet?.backup) state.moneroWallet = { ...state.moneroWallet, backup: null };
    },
    // Vault lock: the wallet stays this account's, so what is stored is still known.
    async close(): Promise<void> {
      stopAutoSync();
      generation += 1;
      const was = current();
      if (was.snapshot) state.moneroWallet = { status: 'stored', stored: true, addresses: was.addresses, message: 'Wallet closed with the device vault.', messageKind: 'ok' };
      else if (moneroWalletBusy(was.status)) state.moneroWallet = { status: 'unknown' };
      ctx.onChange?.();
      await core.close();
    },
    // Account switch or reset: nothing about the previous account's wallet carries over.
    reset(): void {
      stopAutoSync();
      generation += 1;
      state.moneroWallet = { status: 'unknown' };
      ctx.onChange?.();
      void core.close();
    }
  };
}
