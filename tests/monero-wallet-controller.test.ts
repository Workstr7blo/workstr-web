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
      scope: 'monero.hot-wallet' as const,
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
    createWallet: vi.fn(async () => snapshot()),
    openWallet: vi.fn(async () => snapshot()),
    restoreWallet: vi.fn(async () => snapshot()),
    sync: vi.fn(async () => ({ height: 3763001, daemonHeight: 3763001, synchronized: true, updatedAt: '2026-09-15T00:01:00.000Z' })),
    balance: vi.fn(async () => ({ atomicBalance: '1000000000000', atomicUnlockedBalance: '1000000000000' })),
    backupInfo: vi.fn(async () => ({ seed: 'seed words never logged', restoreHeight: 3763000 })),
    close: vi.fn(async () => undefined)
  } as unknown as MoneroWalletCore;
  const ctrl = createMoneroWalletController({ root, state: s, render: vi.fn(), toast: vi.fn(), repaintMoneroAddress: () => {
    const body = root.querySelector('#monero-tips-body');
    if (body) body.innerHTML = moneroTipsCard(s).match(/<div class="settings-category-body monero-tips-body"[^>]*>([\s\S]*)<\/div>\s*<\/section>/)?.[1] || body.innerHTML;
  }, vault, core });
  ctrl.bind();
  return { root, state: s, core, ctrl };
}

describe('Monero wallet controller', () => {
  it('detects missing wallet storage without reading wallet secrets', async () => {
    const { state, core, ctrl } = app();
    await ctrl.refreshIfNeeded();
    expect(core.hasWallet).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('missing');
    expect(document.querySelector('#monero-wallet-create')).toBeTruthy();
  });

  it('creates a vault-backed wallet from the Settings card', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'missing' } });
    root.querySelector<HTMLButtonElement>('#monero-wallet-create')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(core.createWallet).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('ready');
    expect(root.querySelector('#monero-wallet-sync')).toBeTruthy();
  });

  it('passes restore seed to the core and clears the textarea after success', async () => {
    const { root, core } = app({ moneroWallet: { status: 'missing' } });
    const seed = root.querySelector<HTMLTextAreaElement>('#monero-wallet-seed')!;
    seed.value = 'seed words';
    root.querySelector<HTMLFormElement>('#monero-wallet-restore-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(core.restoreWallet).toHaveBeenCalledWith({ seed: 'seed words', restoreHeight: undefined });
    expect(root.querySelector<HTMLTextAreaElement>('#monero-wallet-seed')).toBeNull();
  });

  it('copies the creator subaddress into the public Monero tips draft without marking it published', async () => {
    const { root, state } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    root.querySelector<HTMLButtonElement>('#monero-wallet-use-address')?.click();
    await Promise.resolve();
    expect(state.monero.draft).toBe(snapshot().metadata.creatorSubaddress);
    expect(state.monero.address).toBe('');
    expect(state.monero.message).toContain('Save address');
  });

  it('shows restore height and reveals the recovery phrase only after an explicit click', async () => {
    const { root, state, core } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    expect(root.textContent).toContain('Restore height');
    expect(root.textContent).toContain('3763000');
    expect(root.textContent).not.toContain('seed words never logged');
    root.querySelector<HTMLButtonElement>('#monero-wallet-show-backup')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(core.backupInfo).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.backup?.seed).toBe('seed words never logged');
    expect(root.textContent).toContain('seed words never logged');
  });

  it('closes runtime state when the app locks the device vault', async () => {
    const { state, core, ctrl } = app({ moneroWallet: { status: 'ready', snapshot: snapshot() } });
    await ctrl.close();
    expect(core.close).toHaveBeenCalledTimes(1);
    expect(state.moneroWallet?.status).toBe('stored');
  });
});
