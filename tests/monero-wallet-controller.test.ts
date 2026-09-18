// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMoneroWalletController } from '../src/app/monero-wallet-controller';
import { moneroTipsCard } from '../src/features/support/payment-mode-views';
import { moneroWalletCard } from '../src/features/monero/wallet-view';
import type { AppState } from '../src/app/state';
import type { MoneroWalletCore } from '../src/features/monero/wallet-core';
import type { DeviceVault } from '../src/security/device-vault';

function snapshot() {
  return {
    metadata: {
      version: 1 as const,
      id: 'wallet-1',
      scope: `monero.hot-wallet.${'ab'.repeat(32)}`,
      network: 'mainnet' as const,
      node: { mode: 'workstr' as const, host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' as const },
      restoreHeight: 3763000,
      primaryAddress: '4PrimaryAddress',
      creatorSubaddress: `8${'A'.repeat(94)}`,
      creatorSubaddressIndex: 1,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      source: 'created' as const
    },
    balance: null,
    sync: null
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: 'ab'.repeat(32), npub: null, profileName: null, profilePicture: null, profileNames: {},
    signerType: 'local', store: null,
    settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] },
    monero: { status: 'idle', address: '' },
    moneroWallet: { status: 'unknown' },
    deviceVault: 'unlocked',
    library: [], discoverExercises: [], finishedSessions: [], sheets: [],
    backup: { state: 'off', pending: 0 },
    signInStatus: null,
    ...overrides
  } as unknown as AppState;
}

function app(overrides: Partial<AppState> = {}) {
  const s = state(overrides);
  document.body.innerHTML = `<div id="app">${moneroTipsCard(s)}${moneroWalletCard(s)}</div>`;
  const root = document.getElementById('app') as HTMLElement;
  const vault = { isUnlocked: () => s.deviceVault === 'unlocked' } as DeviceVault;
  const core = {
    hasWallet: vi.fn(async () => false),
    hasLegacyWallet: vi.fn(async () => false),
    storedAddresses: vi.fn(async () => []),
    claimLegacyWallet: vi.fn(async () => snapshot()),
    createWallet: vi.fn(async () => snapshot()),
    openWallet: vi.fn(async () => snapshot()),
    isOpen: vi.fn(() => true),
    restoreWallet: vi.fn(async () => snapshot()),
    sync: vi.fn(async () => ({ height: 3763001, daemonHeight: 3763001, synchronized: true, updatedAt: '2026-09-15T00:01:00.000Z' })),
    balance: vi.fn(async () => ({ atomicBalance: '1000000000000', atomicUnlockedBalance: '1000000000000' })),
    transactions: vi.fn(async () => []),
    backupInfo: vi.fn(async () => ({ seed: 'seed words never logged', restoreHeight: 3763000 })),
    backupPayload: vi.fn(async () => ({ network: 'mainnet' as const, seed: 'seed words never logged', restoreHeight: 3763000, creatorSubaddressIndex: 1, creatorSubaddress: `8${'A'.repeat(94)}`, primaryAddress: '4PrimaryAddress', createdAt: '2026-09-15T00:00:00.000Z' })),
    close: vi.fn(async () => undefined)
  } as unknown as MoneroWalletCore;
  const toast = vi.fn();
  const ctrl = createMoneroWalletController({ root, state: s, toast, repaintMoneroAddress: () => {
    const body = root.querySelector('#monero-tips-body');
    if (body) body.innerHTML = moneroTipsCard(s).match(/<div class="settings-category-body monero-tips-body"[^>]*>([\s\S]*)<\/div>\s*<\/section>/)?.[1] || body.innerHTML;
  }, vault, core });
  ctrl.bind();
  return { root, state: s, core, ctrl, toast };
}

describe('Monero wallet controller', () => {
  it('detects missing wallet storage without reading wallet secrets', async () => {
    const { state, core, ctrl } = app();
    await ctrl.refreshIfNeeded();
    expect(core.hasWallet).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('missing');
    expect(document.querySelector('#monero-wallet-create')).toBeTruthy();
  });

  it('reports a stored wallet with its public addresses and offers only Open', async () => {
    const { root, state, core, ctrl } = app();
    vi.mocked(core.hasWallet).mockResolvedValue(true);
    vi.mocked(core.storedAddresses).mockResolvedValue(['8Creator', '4Primary']);
    await ctrl.refreshIfNeeded();
    expect(state.moneroWallet).toMatchObject({ status: 'stored', stored: true, addresses: ['8Creator', '4Primary'] });
    expect(root.querySelector('#monero-wallet-open')).toBeTruthy();
    expect(root.querySelector('#monero-wallet-create')).toBeNull();
  });

  it('keeps Open, never Create, after a stored wallet fails to open', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'stored', stored: true } });
    vi.mocked(core.openWallet).mockRejectedValue(new Error('Monero node is not ready: offline'));
    root.querySelector<HTMLButtonElement>('#monero-wallet-open')?.click();
    await vi.waitFor(() => expect(state.moneroWallet?.status).toBe('error'));
    expect(root.querySelector('#monero-wallet-open')).toBeTruthy();
    expect(root.querySelector('#monero-wallet-create')).toBeNull();
    expect(root.querySelector('#monero-wallet-restore-form')).toBeNull();
  });

  it('runs one create for a double tap', async () => {
    const { root, core } = app({ moneroWallet: { status: 'missing', stored: false } });
    const button = root.querySelector<HTMLButtonElement>('#monero-wallet-create')!;
    button.click();
    button.click();
    await vi.waitFor(() => expect(core.createWallet).toHaveBeenCalled());
    expect(core.createWallet).toHaveBeenCalledTimes(1);
  });

  it('shows the stored wallet when another tap or tab stored one first', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'missing', stored: false } });
    vi.mocked(core.createWallet).mockRejectedValue(new Error('A Monero wallet is already stored for this account. Open it instead.'));
    root.querySelector<HTMLButtonElement>('#monero-wallet-create')?.click();
    await vi.waitFor(() => expect(state.moneroWallet?.status).toBe('stored'));
    expect(root.querySelector('#monero-wallet-open')).toBeTruthy();
  });

  it('drops a result that lands after the account switched', async () => {
    const { root, state, core, ctrl } = app({ moneroWallet: { status: 'stored', stored: true } });
    let finish: (value: ReturnType<typeof snapshot>) => void = () => undefined;
    vi.mocked(core.openWallet).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    root.querySelector<HTMLButtonElement>('#monero-wallet-open')?.click();
    await vi.waitFor(() => expect(core.openWallet).toHaveBeenCalled());
    ctrl.reset();
    finish(snapshot());
    await Promise.resolve();
    await Promise.resolve();
    expect(state.moneroWallet).toEqual({ status: 'unknown' });
    expect(core.close).toHaveBeenCalled();
  });

  // Syncing is automatic now (#261): there is no Sync wallet button to press, so the lock lands
  // in the middle of the Tip Jar's own periodic sync.
  it('survives the vault locking in the middle of a sync', async () => {
    const { state, core, ctrl } = app({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] }, moneroWallet: { status: 'ready', stored: true, snapshot: snapshot() } } as Partial<AppState>);
    let fail: (error: Error) => void = () => undefined;
    vi.mocked(core.sync).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    void ctrl.autoSync();
    await vi.waitFor(() => expect(core.sync).toHaveBeenCalled());
    expect(state.moneroWallet?.status).toBe('syncing');
    await ctrl.close();
    fail(new Error('Wallet is closed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.moneroWallet?.status).toBe('stored');
    expect(state.moneroWallet?.snapshot).toBeUndefined();
  });

  it('moves a legacy wallet to the account only when asked', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'missing', stored: false, legacyAvailable: true } });
    expect(core.claimLegacyWallet).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('#monero-wallet-claim')?.click();
    await vi.waitFor(() => expect(state.moneroWallet?.status).toBe('stored'));
    expect(core.claimLegacyWallet).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet).toMatchObject({ stored: true, legacyAvailable: false });
  });

  it('leaves a legacy wallet untouched on Not now', () => {
    const { root, state, core } = app({ moneroWallet: { status: 'missing', stored: false, legacyAvailable: true } });
    root.querySelector<HTMLButtonElement>('#monero-wallet-claim-dismiss')?.click();
    expect(core.claimLegacyWallet).not.toHaveBeenCalled();
    expect(state.moneroWallet?.legacyAvailable).toBe(false);
    expect(root.querySelector('#monero-wallet-create')).toBeTruthy();
  });

  it('creates a vault-backed wallet from the Settings card', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'missing' } });
    root.querySelector<HTMLButtonElement>('#monero-wallet-create')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(core.createWallet).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('ready');
    // What an opened wallet shows in Settings is diagnostics, not operations (#261).
    expect(root.querySelector('.monero-wallet-diagnostics')).toBeTruthy();
    expect(root.querySelector('#monero-wallet-sync, #monero-wallet-balance, #monero-wallet-use-address')).toBeNull();
  });

  // The seed and the height now arrive from Data & Sync - a decrypted backup file, or a phrase
  // typed into Advanced recovery - so the controller takes them as an argument rather than
  // reading a textarea that no longer exists in Settings.
  it('passes a restore request straight to the core', async () => {
    const { core, ctrl } = app({ moneroWallet: { status: 'missing', stored: false } });
    await expect(ctrl.restore({ seed: 'seed words', restoreHeight: 3763000 })).resolves.toBe(true);
    expect(core.restoreWallet).toHaveBeenCalledWith({ seed: 'seed words', restoreHeight: 3763000 });
  });

  it('reports a failed restore without claiming a wallet is stored', async () => {
    const { state, core, ctrl } = app({ moneroWallet: { status: 'missing', stored: false } });
    vi.mocked(core.restoreWallet).mockRejectedValue(new Error('Monero recovery seed is required.'));
    await expect(ctrl.restore({ seed: 'nonsense' })).resolves.toBe(false);
    expect(state.moneroWallet?.status).toBe('error');
    expect(state.moneroWallet?.stored).not.toBe(true);
  });

  it('keeps raw block heights and the recovery phrase out of the Settings wallet card', async () => {
    const { root, state, core, ctrl } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    expect(root.textContent).not.toContain('Restore height');
    expect(root.textContent).not.toContain('seed words never logged');
    // Revealing is one deliberate action, and it is driven from Advanced recovery in Data & Sync.
    await ctrl.toggleRecoveryPhrase();
    expect(core.backupInfo).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.backup?.seed).toBe('seed words never logged');
    expect(root.textContent).not.toContain('seed words never logged');
    ctrl.hideBackup();
    expect(state.moneroWallet?.backup).toBeNull();
  });

  it('hands the sealed-backup payload out without touching the seed itself', async () => {
    const { core, ctrl } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    await expect(ctrl.backupPayload()).resolves.toMatchObject({ restoreHeight: 3763000, network: 'mainnet' });
    expect(core.backupPayload).toHaveBeenCalledTimes(1);
  });

  it('closes runtime state when the app locks the device vault', async () => {
    const { state, core, ctrl } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    await ctrl.close();
    expect(core.close).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('stored');
  });
});
