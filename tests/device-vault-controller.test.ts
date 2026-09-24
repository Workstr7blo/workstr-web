// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createDeviceVaultController } from '../src/app/device-vault-controller';
import { UNLOCK_BACKOFF_KEY, unlockDelayMs } from '../src/app/device-vault-backoff';
import { bindPinFields, readPinField } from '../src/app/device-pin-input';
import { deviceSecurityCard, pinField, vaultScopeName } from '../src/app/device-vault-view';
import { createDeviceVault, type DeviceVault } from '../src/security/device-vault';
import { generateLocalAccount, NOSTR_LOCAL_KEY_SCOPE, saveLocalAccount } from '../src/signer/local-key';
import { clearLocalSecret, loadLocalSecret, saveLocalSecret } from '../src/signer/local-key-storage';
import type { AppState } from '../src/app/state';

const PIN = '314159265';
const OTHER_PIN = '271828182';
let counter = 0;

function freshVault(): { databaseName: string; vault: DeviceVault } {
  counter += 1;
  const databaseName = `vault-controller-${counter}`;
  return { databaseName, vault: createDeviceVault({ databaseName }) };
}

function harness(vault: DeviceVault, stateOverrides: Partial<AppState> = {}, clockStart = 1_000_000) {
  document.body.innerHTML = '<div id="app"><div id="modal"><div id="modal-content"></div></div><div id="vault-lock" hidden></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const state = { pubkey: null, deviceVault: 'absent', ...stateOverrides } as AppState;
  let clock = clockStart;
  const onUnlocked = vi.fn();
  const onLocked = vi.fn();
  const onReset = vi.fn();
  const toast = vi.fn();
  const modal = root.querySelector('#modal') as HTMLElement;
  const controller = createDeviceVaultController({
    root, state, vault, toast, onUnlocked, onLocked, onReset,
    render: vi.fn(),
    now: () => clock,
    openModal: (markup) => { (root.querySelector('#modal-content') as HTMLElement).innerHTML = markup; modal.classList.add('open'); },
    closeModal: () => close()
  });
  // What the shell does: any close cancels a pending prompt.
  function close(): void { modal.classList.remove('open'); (root.querySelector('#modal-content') as HTMLElement).innerHTML = ''; controller.cancelPending(); }
  return {
    root, state, controller, onUnlocked, onLocked, onReset, toast, close,
    lock: () => root.querySelector('#vault-lock') as HTMLElement,
    modalContent: () => root.querySelector('#modal-content') as HTMLElement,
    advance: (ms: number) => { clock += ms; }
  };
}

// Types a code into a named field the way a person does - three boxes - and submits the form.
function enter(container: ParentNode, field: string, pin: string): void {
  const boxes = container.querySelectorAll<HTMLInputElement>(`[data-pin-field="${field}"] .device-pin-group`);
  boxes.forEach((box, index) => { box.value = pin.slice(index * 3, index * 3 + 3); });
}

function submit(container: ParentNode, formId: string): void {
  (container.querySelector(`#${formId}`) as HTMLFormElement).requestSubmit();
}

async function vaultWithNostrKey(): Promise<{ databaseName: string; vault: DeviceVault; pubkey: string }> {
  const { databaseName, vault } = freshVault();
  const account = generateLocalAccount();
  await vault.create(PIN);
  await saveLocalAccount(account, vault);
  return { databaseName, vault: createDeviceVault({ databaseName }), pubkey: account.pubkey };
}

beforeEach(async () => {
  localStorage.clear();
  await clearLocalSecret();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unlock delays', () => {
  it('lets two mistakes pass and then doubles the wait, up to a minute', () => {
    expect([0, 1, 2].map(unlockDelayMs)).toEqual([0, 0, 0]);
    expect([3, 4, 5].map(unlockDelayMs)).toEqual([1000, 2000, 4000]);
    expect(unlockDelayMs(40)).toBe(60_000);
  });
});

describe('device code boxes', () => {
  it('accept digits only and fill all three from a pasted nine-digit code', () => {
    document.body.innerHTML = pinField('code', 'Device code');
    // The markup carries every hint a phone needs, and nothing a password manager would save.
    const box = document.querySelector('.device-pin-group') as HTMLInputElement;
    expect(box.getAttribute('inputmode')).toBe('numeric');
    expect(box.getAttribute('autocomplete')).toBe('off');
    expect(box.type).toBe('text');
    bindPinFields(document.body);
    const [first] = Array.from(document.querySelectorAll<HTMLInputElement>('.device-pin-group'));

    first.value = 'a1 2-';
    first.dispatchEvent(new Event('input'));
    expect(first.value).toBe('12');

    const paste = (text: string) => {
      const event = new Event('paste', { cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      first.dispatchEvent(event);
    };
    paste('123 456 789');
    expect(readPinField(document.body, 'code')).toBe('12');
    paste('000123456');
    expect(readPinField(document.body, 'code')).toBe('000123456');
  });
});

describe('launch', () => {
  it('opens normally with no vault and no local key', async () => {
    const { vault } = freshVault();
    const h = harness(vault);
    expect(await h.controller.prepareBoot()).toBe('open');
    expect(h.state.deviceVault).toBe('absent');
    expect(h.lock().hidden).toBe(true);
  });

  it('does not prompt an external-signer account that has no vault', async () => {
    const { vault } = freshVault();
    const h = harness(vault, { pubkey: 'a'.repeat(64) });
    expect(await h.controller.prepareBoot()).toBe('open');
    expect(h.lock().hidden).toBe(true);
  });

  it('removes a vault that holds nothing rather than asking for its code', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    const h = harness(vault, {}, Date.now() + 31_000);
    expect(await h.controller.prepareBoot()).toBe('open');
    expect(await vault.exists()).toBe(false);
  });

  it('leaves an empty vault alone while it may still be another tab mid-setup', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    const h = harness(vault, {}, Date.now());
    expect(await h.controller.prepareBoot()).toBe('open');
    expect(await vault.exists()).toBe(true);
  });

  it('blocks the app until the right code is entered, saying only that a wrong one is wrong', async () => {
    const { vault, pubkey } = await vaultWithNostrKey();
    const h = harness(vault, { pubkey });
    expect(await h.controller.prepareBoot()).toBe('blocked');
    expect(h.lock().hidden).toBe(false);
    expect(h.lock().textContent).toContain('Enter your nine-digit device code.');

    enter(h.lock(), 'unlock', OTHER_PIN);
    submit(h.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(h.lock().querySelector('.auth-error')?.textContent).toBe('That device code is incorrect.'));
    expect(h.onUnlocked).not.toHaveBeenCalled();
    // The code typed is not written back into the screen.
    expect(readPinField(h.lock(), 'unlock')).toBe('');
    expect(h.lock().innerHTML).not.toContain(OTHER_PIN);

    enter(h.lock(), 'unlock', PIN);
    submit(h.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(h.onUnlocked).toHaveBeenCalledWith('boot'));
    expect(h.lock().hidden).toBe(true);
    expect(h.state.deviceVault).toBe('unlocked');
    expect(vault.isUnlocked()).toBe(true);
  });

  it('refuses a malformed code without counting it as a guess', async () => {
    const { vault } = await vaultWithNostrKey();
    const unlock = vi.spyOn(vault, 'unlock');
    const h = harness(vault);
    await h.controller.prepareBoot();
    enter(h.lock(), 'unlock', '12345');
    submit(h.lock(), 'vault-unlock-form');
    expect(h.lock().querySelector('.auth-error')?.textContent).toBe('Enter exactly nine digits.');
    expect(unlock).not.toHaveBeenCalled();
  });

  it('makes repeated wrong codes wait before the next attempt', async () => {
    const { vault } = await vaultWithNostrKey();
    const h = harness(vault);
    await h.controller.prepareBoot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      enter(h.lock(), 'unlock', OTHER_PIN);
      submit(h.lock(), 'vault-unlock-form');
      await vi.waitFor(() => expect(h.lock().querySelector('#vault-unlock')?.hasAttribute('disabled')).toBe(false));
    }
    expect(h.lock().querySelector('.auth-error')?.textContent).toContain('Too many incorrect attempts');

    const unlock = vi.spyOn(vault, 'unlock');
    enter(h.lock(), 'unlock', PIN);
    submit(h.lock(), 'vault-unlock-form');
    expect(unlock).not.toHaveBeenCalled();

    h.advance(1000);
    enter(h.lock(), 'unlock', PIN);
    submit(h.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(h.onUnlocked).toHaveBeenCalled());
    // Let the redraw scheduled for the end of the wait fire inside this test.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  it('keeps the wait across a reload and clears it once the right code is entered', async () => {
    const { databaseName, vault } = await vaultWithNostrKey();
    const h = harness(vault);
    await h.controller.prepareBoot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      enter(h.lock(), 'unlock', OTHER_PIN);
      submit(h.lock(), 'vault-unlock-form');
      await vi.waitFor(() => expect(h.lock().querySelector('#vault-unlock')?.hasAttribute('disabled')).toBe(false));
    }
    expect(localStorage.getItem(UNLOCK_BACKOFF_KEY)).not.toContain(OTHER_PIN);

    // A reload: a new vault object and a new controller, with only storage carried over.
    const reopened = createDeviceVault({ databaseName });
    const unlock = vi.spyOn(reopened, 'unlock');
    const r = harness(reopened);
    expect(await r.controller.prepareBoot()).toBe('blocked');
    expect(r.lock().querySelector('.auth-error')?.textContent).toContain('Too many incorrect attempts');
    enter(r.lock(), 'unlock', PIN);
    submit(r.lock(), 'vault-unlock-form');
    expect(unlock).not.toHaveBeenCalled();

    r.advance(1000);
    enter(r.lock(), 'unlock', PIN);
    submit(r.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(r.onUnlocked).toHaveBeenCalledWith('boot'));
    expect(localStorage.getItem(UNLOCK_BACKOFF_KEY)).toBeNull();
  });

  it('says so when a pre-vault key cannot be moved after unlock, and removes it only on request', async () => {
    const { vault, pubkey } = await vaultWithNostrKey();
    const other = generateSecretKey();
    await saveLocalSecret(bytesToHex(other));
    const h = harness(vault, { pubkey });
    await h.controller.prepareBoot();
    enter(h.lock(), 'unlock', PIN);
    submit(h.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(h.modalContent().textContent).toContain('Old identity key not protected'));
    expect(h.onUnlocked).toHaveBeenCalledWith('boot');
    expect(h.modalContent().textContent).toContain(nip19.npubEncode(getPublicKey(other)).slice(0, 12));

    vi.stubGlobal('confirm', vi.fn(() => false));
    h.modalContent().querySelector<HTMLElement>('#vault-legacy-remove')!.click();
    expect(await loadLocalSecret()).toBe(bytesToHex(other));

    vi.stubGlobal('confirm', vi.fn(() => true));
    h.modalContent().querySelector<HTMLElement>('#vault-legacy-remove')!.click();
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('Old identity key removed.'));
    expect(await loadLocalSecret()).toBeNull();
    // The account the vault protects is untouched.
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(true);
  });
});

describe('forgotten code', () => {
  it('names what a reset deletes and resets only after confirmation', async () => {
    const { vault } = await vaultWithNostrKey();
    const h = harness(vault);
    await h.controller.prepareBoot();
    h.lock().querySelector<HTMLElement>('#vault-forgot')!.click();
    await vi.waitFor(() => expect(h.lock().textContent).toContain('Your code cannot be recovered.'));
    expect(h.lock().textContent).toContain(vaultScopeName(NOSTR_LOCAL_KEY_SCOPE));
    expect(vaultScopeName('monero.hot-wallet')).toBe('Monero hot wallet secret');
    expect(vaultScopeName(`monero.hot-wallet.${'ab'.repeat(32)}`)).toBe('Monero hot wallet secret');
    expect(vaultScopeName(`monero.hot-wallet-data.${'ab'.repeat(32)}`)).toBe('Monero wallet sync data');

    vi.stubGlobal('confirm', vi.fn(() => false));
    h.lock().querySelector<HTMLElement>('#vault-reset')!.click();
    expect(await vault.exists()).toBe(true);

    vi.stubGlobal('confirm', vi.fn(() => true));
    h.lock().querySelector<HTMLElement>('#vault-reset')!.click();
    await vi.waitFor(() => expect(h.onReset).toHaveBeenCalled());
    expect(await vault.exists()).toBe(false);
    expect(h.state.deviceVault).toBe('absent');
    expect(h.lock().hidden).toBe(true);
  });
});

describe('protecting an existing local account', () => {
  function legacyAccount() {
    const secret = generateSecretKey();
    return { hex: bytesToHex(secret), pubkey: getPublicKey(secret) };
  }

  it('asks for a code, moves the key into the vault, then deletes the old record', async () => {
    const account = legacyAccount();
    await saveLocalSecret(account.hex);
    const { vault } = freshVault();
    const h = harness(vault, { pubkey: account.pubkey });

    expect(await h.controller.prepareBoot()).toBe('blocked');
    expect(h.lock().textContent).toContain('Protect this device');
    h.lock().querySelector<HTMLElement>('#vault-protect-start')!.click();

    enter(h.lock(), 'new', PIN);
    enter(h.lock(), 'confirm', OTHER_PIN);
    submit(h.lock(), 'vault-protect-form');
    expect(h.lock().querySelector('.auth-error')?.textContent).toBe('The two codes do not match.');
    expect(await vault.exists()).toBe(false);

    enter(h.lock(), 'new', PIN);
    enter(h.lock(), 'confirm', PIN);
    submit(h.lock(), 'vault-protect-form');
    await vi.waitFor(() => expect(h.onUnlocked).toHaveBeenCalledWith('boot'));
    expect(await vault.getSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(account.hex);
    expect(await loadLocalSecret()).toBeNull();
    expect(h.state.deviceVault).toBe('unlocked');
  });

  it('keeps the old key and removes the new vault when protection fails', async () => {
    const account = legacyAccount();
    await saveLocalSecret(account.hex);
    const { vault } = freshVault();
    // The stored key is not the signed-in account, so verification must fail.
    const h = harness(vault, { pubkey: legacyAccount().pubkey });
    await h.controller.prepareBoot();
    h.lock().querySelector<HTMLElement>('#vault-protect-start')!.click();
    enter(h.lock(), 'new', PIN);
    enter(h.lock(), 'confirm', PIN);
    submit(h.lock(), 'vault-protect-form');

    await vi.waitFor(() => expect(h.lock().textContent).toContain('Protection could not be enabled'));
    expect(await loadLocalSecret()).toBe(account.hex);
    expect(await vault.exists()).toBe(false);
    expect(h.onUnlocked).not.toHaveBeenCalled();
  });
});

describe('storing a new local key', () => {
  it('asks for a new code and stores nothing when that is cancelled', async () => {
    const { vault } = freshVault();
    const h = harness(vault);
    const pending = h.controller.protectLocalAccount(generateLocalAccount());
    await vi.waitFor(() => expect(h.modalContent().textContent).toContain('Create a device code'));
    (h.root.querySelector('#modal') as HTMLElement).classList.remove('open');
    h.controller.cancelPending();
    expect(await pending).toBeNull();
    expect(await vault.exists()).toBe(false);
  });

  it('creates the vault from a confirmed code and returns a signer for the account', async () => {
    const { databaseName, vault } = freshVault();
    const h = harness(vault);
    const account = generateLocalAccount();
    const pending = h.controller.protectLocalAccount(account);
    await vi.waitFor(() => expect(h.modalContent().querySelector('#vault-new-pin-form')).toBeTruthy());
    enter(h.modalContent(), 'new', PIN);
    enter(h.modalContent(), 'confirm', PIN);
    submit(h.modalContent(), 'vault-new-pin-form');

    const signer = await pending;
    expect(await signer?.getPublicKey()).toBe(account.pubkey);
    expect(h.state.deviceVault).toBe('unlocked');
    const reloaded = createDeviceVault({ databaseName });
    await reloaded.unlock(PIN);
    expect(await reloaded.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(true);
  });

  it('uses an already unlocked vault without asking for another code', async () => {
    const { vault } = freshVault();
    await vault.create(PIN);
    const h = harness(vault);
    const signer = await h.controller.protectLocalAccount(generateLocalAccount());
    expect(signer).toBeTruthy();
    expect(h.modalContent().innerHTML).toBe('');
  });

  it('asks for the existing code of a locked vault instead of creating a second one', async () => {
    const { databaseName, vault: creator } = freshVault();
    await creator.create(PIN);
    await creator.putSecret('monero.hot-wallet', 'seed');
    const vault = createDeviceVault({ databaseName });
    const h = harness(vault);
    const account = generateLocalAccount();
    const pending = h.controller.protectLocalAccount(account);
    await vi.waitFor(() => expect(h.modalContent().querySelector('#vault-modal-unlock-form')).toBeTruthy());
    enter(h.modalContent(), 'unlock', PIN);
    submit(h.modalContent(), 'vault-modal-unlock-form');

    expect(await (await pending)?.getPublicKey()).toBe(account.pubkey);
    const reloaded = createDeviceVault({ databaseName });
    await reloaded.unlock(PIN);
    expect((await reloaded.listScopes()).sort()).toEqual(['monero.hot-wallet', NOSTR_LOCAL_KEY_SCOPE]);
  });

  it('does not bring back an unlock prompt that was closed while it was checking the code', async () => {
    const { databaseName, vault: creator } = freshVault();
    await creator.create(PIN);
    await creator.putSecret('monero.hot-wallet', 'seed');
    const vault = createDeviceVault({ databaseName });
    const h = harness(vault);
    const pending = h.controller.protectLocalAccount(generateLocalAccount());
    await vi.waitFor(() => expect(h.modalContent().querySelector('#vault-modal-unlock-form')).toBeTruthy());
    enter(h.modalContent(), 'unlock', OTHER_PIN);
    submit(h.modalContent(), 'vault-modal-unlock-form');
    h.close();

    expect(await pending).toBeNull();
    await vi.waitFor(() => expect(localStorage.getItem(UNLOCK_BACKOFF_KEY)).toContain('"failures":1'));
    expect(h.root.querySelector('#modal')?.classList.contains('open')).toBe(false);
    expect(h.modalContent().innerHTML).toBe('');
  });
});

describe('Settings', () => {
  it('shows the Security & devices card only while there is a device or account to manage', () => {
    expect(deviceSecurityCard({ deviceVault: 'unlocked' } as AppState)).toContain('Change');
    expect(deviceSecurityCard({ deviceVault: 'unlocked', pubkey: 'ab'.repeat(32) } as AppState)).toContain('Lock now');
    expect(deviceSecurityCard({ deviceVault: 'locked' } as AppState)).toBe('');
    expect(deviceSecurityCard({ deviceVault: 'absent' } as AppState)).toBe('');
  });

  it('changes the code only with the current one', async () => {
    const { databaseName, vault: seeded } = await vaultWithNostrKey();
    await seeded.unlock(PIN);
    const h = harness(seeded, { deviceVault: 'unlocked' });
    h.root.insertAdjacentHTML('beforeend', deviceSecurityCard({ ...h.state, pubkey: 'ab'.repeat(32) } as AppState));
    h.controller.bindSettings();

    h.root.querySelector<HTMLElement>('#change-device-code')!.click();
    enter(h.modalContent(), 'current', OTHER_PIN);
    enter(h.modalContent(), 'new', '111222333');
    enter(h.modalContent(), 'confirm', '111222333');
    submit(h.modalContent(), 'vault-change-pin-form');
    await vi.waitFor(() => expect(h.modalContent().querySelector('.auth-error')?.textContent).toBe('That device code is incorrect.'));

    enter(h.modalContent(), 'current', PIN);
    enter(h.modalContent(), 'new', '111222333');
    enter(h.modalContent(), 'confirm', '111222333');
    submit(h.modalContent(), 'vault-change-pin-form');
    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('Device code changed.'));

    const reloaded = createDeviceVault({ databaseName });
    await expect(reloaded.unlock(PIN)).rejects.toMatchObject({ code: 'incorrect-pin' });
    await reloaded.unlock('111222333');
    expect(await reloaded.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(true);
  });

  it('reports a failed change without reopening a window closed while it ran', async () => {
    const { vault } = await vaultWithNostrKey();
    await vault.unlock(PIN);
    const h = harness(vault, { deviceVault: 'unlocked' });
    h.root.insertAdjacentHTML('beforeend', deviceSecurityCard({ ...h.state, pubkey: 'ab'.repeat(32) } as AppState));
    h.controller.bindSettings();
    h.root.querySelector<HTMLElement>('#change-device-code')!.click();
    enter(h.modalContent(), 'current', OTHER_PIN);
    enter(h.modalContent(), 'new', '111222333');
    enter(h.modalContent(), 'confirm', '111222333');
    submit(h.modalContent(), 'vault-change-pin-form');
    h.close();

    await vi.waitFor(() => expect(h.toast).toHaveBeenCalledWith('The device code was not changed.', 'bad'));
    expect(h.root.querySelector('#modal')?.classList.contains('open')).toBe(false);
    expect(h.modalContent().innerHTML).toBe('');
  });

  it('locks: drops the session, keeps the records, and resumes on the next unlock', async () => {
    const { vault } = await vaultWithNostrKey();
    await vault.unlock(PIN);
    const h = harness(vault, { deviceVault: 'unlocked' });
    h.root.insertAdjacentHTML('beforeend', deviceSecurityCard({ ...h.state, pubkey: 'ab'.repeat(32) } as AppState));
    h.controller.bindSettings();

    h.root.querySelector<HTMLElement>('#lock-workstr')!.click();
    expect(vault.isUnlocked()).toBe(false);
    expect(h.onLocked).toHaveBeenCalled();
    expect(h.state.deviceVault).toBe('locked');
    expect(h.lock().hidden).toBe(false);
    expect(await vault.hasSecret(NOSTR_LOCAL_KEY_SCOPE)).toBe(true);
    // The app is still rendered underneath; keyboard and screen readers must not reach it.
    const card = h.root.querySelector('.device-security-card') as HTMLElement;
    expect(card.hasAttribute('inert')).toBe(true);
    expect(h.root.querySelector('#modal')?.hasAttribute('inert')).toBe(true);
    expect(h.lock().hasAttribute('inert')).toBe(false);

    enter(h.lock(), 'unlock', PIN);
    submit(h.lock(), 'vault-unlock-form');
    await vi.waitFor(() => expect(h.onUnlocked).toHaveBeenCalledWith('relock'));
    expect(card.hasAttribute('inert')).toBe(false);
    expect(h.root.querySelector('#modal')?.hasAttribute('inert')).toBe(false);
  });
});
