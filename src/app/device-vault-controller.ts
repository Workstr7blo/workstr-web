// Everything the user does with the device vault: unlocking at launch, protecting an existing
// account the first time a vault-aware build opens, setting a code while an account is created,
// restored or received, changing the code, locking, and resetting after a forgotten code.
//
// The lock screen is its own layer above the frame and the modal, so nothing behind it can be
// reached while a vault exists and is locked. The code is read from the inputs at submit time,
// handed straight to the vault, and never kept: a failed attempt re-renders empty boxes.
import { deviceVault as defaultVault, type DeviceVault } from '../security/device-vault';
import { isDevicePin } from '../security/device-pin';
import { isDeviceVaultError, type DeviceVaultStatus } from '../security/device-vault-types';
import { hasLegacyLocalKey, legacyLocalKeyPubkey, migrateLegacyLocalKey, saveLocalAccount, type LocalAccountKey } from '../signer/local-key';
import { clearLocalSecret, migrateLegacyLocalSecret } from '../signer/local-key-storage';
import type { Signer } from '../signer/types';
import type { AppState } from './state';
import {
  changePinModalMarkup,
  forgotScreenMarkup,
  newPinModalMarkup,
  protectCreateMarkup,
  protectIntroMarkup,
  shortNpub,
  unlockModalMarkup,
  unlockScreenMarkup,
  unmovedLegacyKeyModalMarkup,
  vaultBusyModalMarkup,
  vaultMessageModalMarkup,
  vaultScopeName
} from './device-vault-view';
import { bindPinFields, INVALID_PIN, readNewPin, readPinField } from './device-pin-input';
import { createUnlockBackoff } from './device-vault-backoff';

export type UnlockReason = 'boot' | 'relock';

export interface DeviceVaultControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(markup: string): void;
  closeModal(): void;
  /** The vault is open: continue launching (`boot`) or resume after Lock Workstr (`relock`). */
  onUnlocked(reason: UnlockReason): Promise<void> | void;
  /** The vault was locked from Settings: drop the signer and stop anything that needs it. */
  onLocked(): void;
  /** The vault was reset: the identity has to be restored from a recovery key. */
  onReset(): Promise<void> | void;
  vault?: DeviceVault;
  now?(): number;
}

// An empty vault younger than this may be another tab's setup, seconds from writing its secret.
const EMPTY_VAULT_GRACE_MS = 30_000;

const messageOf = (error: unknown): string => (isDeviceVaultError(error) ? error.message : 'Something went wrong. Try again.');

export function createDeviceVaultController(ctx: DeviceVaultControllerContext) {
  const { root, state, openModal, closeModal } = ctx;
  const vault = ctx.vault || defaultVault;
  const now = ctx.now || Date.now;
  const backoff = createUnlockBackoff(now);
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingCancel: (() => void) | null = null;
  // Bumped whenever the modal closes, so work that finishes after its window closed can tell.
  let modalGeneration = 0;

  const setStatus = (status: DeviceVaultStatus): void => { state.deviceVault = status; };
  const modalHost = (): ParentNode => root.querySelector('#modal-content') || root;
  const lockHost = (): HTMLElement | null => root.querySelector<HTMLElement>('#vault-lock');

  // Opaque is not enough: Tab and screen readers still reach whatever is underneath, and after
  // Lock Workstr that is the whole app. Everything beside the lock layer is inert while it is up.
  function setBackgroundInert(host: HTMLElement, inert: boolean): void {
    for (let node: Element = host; node !== root && node.parentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node) sibling.toggleAttribute('inert', inert);
      }
    }
  }

  function showLock(markup: string): HTMLElement | null {
    const host = lockHost();
    if (!host) return null;
    host.innerHTML = markup;
    host.hidden = false;
    setBackgroundInert(host, true);
    bindPinFields(host);
    host.querySelector<HTMLInputElement>('.device-pin-group:not([disabled])')?.focus();
    return host;
  }

  function hideLock(): void {
    const host = lockHost();
    if (!host) return;
    setBackgroundInert(host, false);
    host.hidden = true;
    host.innerHTML = '';
  }

  function clearFailures(): void {
    backoff.clear();
    clearTimeout(retryTimer);
  }

  const unlockError = (error: unknown): string => backoff.waitMessage() || messageOf(error);

  async function prepareBoot(): Promise<'open' | 'blocked'> {
    // Every boot, signed in or not: a plaintext key from before encrypted storage leaves
    // localStorage whether or not anyone ever asks for a signer.
    await migrateLegacyLocalSecret().catch(() => undefined);
    try {
      if (await vault.exists()) {
        if ((await vault.listScopes()).length) {
          setStatus('locked');
          showUnlock('boot');
          return 'blocked';
        }
        // A vault holding nothing is a setup that never finished, and removing it lets the
        // interrupted step start again - unless it is young enough to be another tab's setup,
        // whose secret would then be written under a root key nothing can unwrap.
        const age = Math.abs(now() - ((await vault.createdAt()) ?? 0));
        if (age >= EMPTY_VAULT_GRACE_MS) await vault.destroy();
      }
      if (state.pubkey && await hasLegacyLocalKey()) {
        setStatus('setup-required');
        showProtect();
        return 'blocked';
      }
      setStatus('absent');
    } catch {
      // No readable secure storage: a local key cannot sign here anyway, and training does
      // not need one, so the app opens rather than locking a workout behind a broken store.
      setStatus('error');
    }
    return 'open';
  }

  function showUnlock(reason: UnlockReason, error: string | null = null): void {
    const host = showLock(unlockScreenMarkup({ error: error || backoff.waitMessage() }));
    host?.querySelector('#vault-unlock-form')?.addEventListener('submit', (event) => { event.preventDefault(); void submitUnlock(reason, host); });
    host?.querySelector('#vault-forgot')?.addEventListener('click', () => { void showForgot(reason); });
    // Redraws when a wait ends, so the screen does not keep saying "wait" after it no longer
    // applies - a wait carried over from before a reload included.
    clearTimeout(retryTimer);
    const wait = backoff.remainingMs();
    if (wait > 0) retryTimer = setTimeout(() => { if (state.deviceVault === 'locked') showUnlock(reason); }, wait);
  }

  async function submitUnlock(reason: UnlockReason, host: HTMLElement): Promise<void> {
    if (backoff.waitMessage()) return showUnlock(reason);
    const pin = readPinField(host, 'unlock');
    if (!isDevicePin(pin)) return showUnlock(reason, INVALID_PIN);
    setStatus('unlocking');
    showLock(unlockScreenMarkup({ busy: 'Unlocking…' }));
    try {
      await vault.unlock(pin);
    } catch (error) {
      setStatus('locked');
      backoff.recordFailure(error);
      return showUnlock(reason, unlockError(error));
    }
    clearFailures();
    setStatus('unlocked');
    // A migration interrupted after its vault write, or a pre-vault key on a device whose
    // vault already existed: the code just entered is all it needs to finish. When it cannot,
    // that key is still readable without any code, so the user is told rather than left with it.
    let unmoved = false;
    if (state.pubkey && await hasLegacyLocalKey().catch(() => false)) {
      unmoved = await migrateLegacyLocalKey(state.pubkey, vault).then(() => false, () => true);
    }
    hideLock();
    await ctx.onUnlocked(reason);
    if (unmoved) await showUnmovedLegacyKey();
  }

  // Most often the old key belongs to a different account. Left alone, the move is tried again
  // at the next launch; removal is confirmed, since without its recovery key that account is gone.
  async function showUnmovedLegacyKey(): Promise<void> {
    const pubkey = await legacyLocalKeyPubkey();
    openModal(unmovedLegacyKeyModalMarkup(pubkey ? shortNpub(pubkey) : null));
    const host = modalHost();
    host.querySelector('#vault-legacy-later')?.addEventListener('click', closeModal);
    host.querySelector('#vault-legacy-remove')?.addEventListener('click', () => {
      if (!window.confirm('Remove the old identity key from this device? Without its recovery key that account cannot be recovered.')) return;
      clearLocalSecret().then(() => { closeModal(); ctx.toast('Old identity key removed.'); }, () => ctx.toast('The old identity key could not be removed.', 'bad'));
    });
  }

  async function showForgot(reason: UnlockReason): Promise<void> {
    const scopes = await vault.listScopes().catch(() => []);
    const names = [...new Set(scopes.map(vaultScopeName))];
    const host = showLock(forgotScreenMarkup(names));
    host?.querySelector('#vault-reset-cancel')?.addEventListener('click', () => showUnlock(reason));
    host?.querySelector('#vault-reset')?.addEventListener('click', () => {
      const listed = names.length ? ` This deletes ${names.join(', ')} from this device.` : '';
      if (!window.confirm(`Reset the device vault?${listed} This cannot be undone.`)) return;
      void resetVault();
    });
  }

  async function resetVault(): Promise<void> {
    try {
      await vault.destroy();
      await clearLocalSecret();
    } catch (error) {
      showLock(protectIntroMarkup(messageOf(error)));
      return;
    }
    clearFailures();
    setStatus('absent');
    hideLock();
    await ctx.onReset();
  }

  function showProtect(error: string | null = null): void {
    const host = showLock(protectIntroMarkup(error));
    host?.querySelector('#vault-protect-start')?.addEventListener('click', () => showProtectCreate());
    host?.querySelector('#vault-protect-restore')?.addEventListener('click', () => {
      if (!window.confirm('Remove the stored identity from this device and restore it with your recovery key instead? Without that key the account cannot be recovered.')) return;
      void resetVault();
    });
  }

  function showProtectCreate(error: string | null = null): void {
    const host = showLock(protectCreateMarkup({ error }));
    host?.querySelector('#vault-protect-back')?.addEventListener('click', () => showProtect());
    host?.querySelector('#vault-protect-form')?.addEventListener('submit', (event) => { event.preventDefault(); void submitProtect(host); });
  }

  // The old record is left untouched until `migrateLegacyLocalKey` has verified the new one.
  // On any failure the vault this attempt created is removed again, so the next attempt -
  // now, or on the next launch - starts from exactly the state this one did.
  async function submitProtect(host: HTMLElement): Promise<void> {
    const next = readNewPin(host);
    if ('error' in next) return showProtectCreate(next.error);
    showLock(protectCreateMarkup({ busy: 'Protecting your identity…' }));
    let created = false;
    try {
      await vault.create(next.pin);
      created = true;
      await migrateLegacyLocalKey(state.pubkey, vault);
    } catch {
      if (created) await vault.destroy().catch(() => undefined);
      setStatus('setup-required');
      return showProtect('Protection could not be enabled. Your identity is still on this device - try again.');
    }
    setStatus('unlocked');
    hideLock();
    await ctx.onUnlocked('boot');
  }

  // Resolves null when the modal is closed by any route, so the flow that asked can drop the
  // key it was holding instead of waiting forever.
  function modalPrompt<T>(show: (resolve: (value: T | null) => void) => void): Promise<T | null> {
    return new Promise((resolve) => {
      const cancel = (): void => resolve(null);
      pendingCancel = cancel;
      // Disarms only its own cancel, so a late answer never strands a newer prompt.
      show((value) => { if (pendingCancel === cancel) pendingCancel = null; resolve(value); });
    });
  }

  function promptNewPin(identity: string): Promise<string | null> {
    return modalPrompt<string>((done) => {
      const show = (error: string | null): void => {
        openModal(newPinModalMarkup(identity, { error }));
        const host = modalHost();
        bindPinFields(host);
        host.querySelector('#vault-new-pin-form')?.addEventListener('submit', (event) => {
          event.preventDefault();
          const next = readNewPin(host);
          if ('error' in next) show(next.error);
          else done(next.pin);
        });
      };
      show(null);
    });
  }

  function promptModalUnlock(identity: string): Promise<true | null> {
    return modalPrompt<true>((done) => {
      const show = (error: string | null, busy: string | null = null): void => {
        openModal(unlockModalMarkup(identity, { error: error || backoff.waitMessage(), busy }));
        const host = modalHost();
        bindPinFields(host);
        host.querySelector('#vault-modal-unlock-form')?.addEventListener('submit', (event) => {
          event.preventDefault();
          if (backoff.waitMessage()) return show(null);
          const pin = readPinField(host, 'unlock');
          if (!isDevicePin(pin)) return show(INVALID_PIN);
          show(null, 'Unlocking…');
          // Closed while unlocking: the prompt has already answered null and must not reappear.
          const generation = modalGeneration;
          vault.unlock(pin).then(() => {
            clearFailures();
            if (generation === modalGeneration) done(true);
            else void refreshStatus();
          }, (error) => {
            backoff.recordFailure(error);
            if (generation === modalGeneration) show(unlockError(error));
          });
        });
      };
      show(null);
    });
  }

  function showMessage(title: string, message: string): void {
    openModal(vaultMessageModalMarkup(title, message));
    modalHost().querySelector('#vault-message-close')?.addEventListener('click', closeModal);
  }

  // The one way a local Nostr key reaches storage. Into an unlocked vault as it is; into a
  // locked one after its code; otherwise a code is created first. Null means nothing was
  // stored - cancelled or failed - and the caller must not sign in.
  async function protectLocalAccount(account: LocalAccountKey): Promise<Signer | null> {
    const identity = shortNpub(account.pubkey);
    let created = false;
    try {
      const exists = await vault.exists();
      if (exists && !vault.isUnlocked() && !(await promptModalUnlock(identity))) return null;
      if (!exists) {
        const pin = await promptNewPin(identity);
        if (!pin) return null;
        openModal(vaultBusyModalMarkup('Protecting your identity…'));
        await vault.create(pin);
        created = true;
      }
      const signer = await saveLocalAccount(account, vault);
      setStatus('unlocked');
      return signer;
    } catch (error) {
      if (created) await vault.destroy().catch(() => undefined);
      await refreshStatus();
      showMessage('Identity not saved', messageOf(error));
      return null;
    }
  }

  function openChangePin(error: string | null = null, busy: string | null = null): void {
    openModal(changePinModalMarkup({ error: error || backoff.waitMessage(), busy }));
    const host = modalHost();
    bindPinFields(host);
    host.querySelector('#vault-change-pin-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (backoff.waitMessage()) return openChangePin();
      const current = readPinField(host, 'current');
      if (!isDevicePin(current)) return openChangePin(INVALID_PIN);
      const next = readNewPin(host);
      if ('error' in next) return openChangePin(next.error);
      openChangePin(null, 'Changing device code…');
      // Closed while it ran: report the outcome without reopening a window the user dismissed.
      const generation = modalGeneration;
      vault.changePin(current, next.pin).then(() => {
        clearFailures();
        if (generation === modalGeneration) closeModal();
        ctx.toast('Device code changed.');
      }, (failure) => {
        backoff.recordFailure(failure);
        if (generation !== modalGeneration) return ctx.toast('The device code was not changed.', 'bad');
        openChangePin(isDeviceVaultError(failure, 'incorrect-pin') ? unlockError(failure) : `The device code was not changed. ${messageOf(failure)}`);
      });
    });
  }

  function lock(): void {
    vault.lock();
    setStatus('locked');
    closeModal();
    ctx.onLocked();
    showUnlock('relock');
  }

  async function refreshStatus(): Promise<void> {
    try {
      const exists = await vault.exists();
      setStatus(!exists ? 'absent' : vault.isUnlocked() ? 'unlocked' : 'locked');
    } catch {
      setStatus('error');
    }
  }

  return {
    prepareBoot,
    protectLocalAccount,
    refreshStatus,
    lock,
    bindSettings(): void {
      root.querySelector('#change-device-code')?.addEventListener('click', () => openChangePin());
      root.querySelector('#lock-workstr')?.addEventListener('click', lock);
    },
    /** Called when the modal closes by any route. */
    cancelPending(): void {
      modalGeneration += 1;
      const cancel = pendingCancel;
      pendingCancel = null;
      cancel?.();
    }
  };
}
