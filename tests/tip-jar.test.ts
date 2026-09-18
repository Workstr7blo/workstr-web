// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncFraction, tipJarNavLabel, tipJarStatus } from '../src/features/monero/tip-jar-state';
import { tipJarNavIcon, tipJarPhase, tipJarView, updateTipJarNav, updateTipJarPage } from '../src/features/monero/tip-jar-view';
import { shellFrame } from '../src/app/layout';
import { createMoneroWalletController, TIP_JAR_RESYNC_MS } from '../src/app/monero-wallet-controller';
import type { AppState } from '../src/app/state';
import type { MoneroWalletCore } from '../src/features/monero/wallet-core';
import type { MoneroWalletUiState } from '../src/features/monero/types';
import type { DeviceVault } from '../src/security/device-vault';

const PUBKEY = 'ab'.repeat(32);
const ADDRESS = `8${'T'.repeat(94)}`;

function snapshot(sync: { height: number | null; daemonHeight: number | null; synchronized: boolean } | null = null, atomicBalance = '24000000000') {
  return {
    metadata: {
      version: 1 as const, id: 'wallet-1', scope: `monero.hot-wallet.${PUBKEY}`, network: 'mainnet' as const,
      node: { mode: 'workstr' as const, host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' as const },
      restoreHeight: 3_700_000, primaryAddress: '4Primary', creatorSubaddress: ADDRESS, creatorSubaddressIndex: 1,
      createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z', source: 'created' as const
    },
    balance: { atomicBalance, atomicUnlockedBalance: atomicBalance },
    sync: sync ? { ...sync, updatedAt: '2026-09-16T00:00:00.000Z' } : null
  };
}

function state(overrides: Partial<AppState> = {}, wallet: MoneroWalletUiState = { status: 'unknown' }): AppState {
  return {
    pubkey: PUBKEY, npub: null, profileName: null, profilePicture: null, profileNames: {},
    signerType: 'local', store: null, view: 'tipjar',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] },
    monero: { status: 'ready', address: '' },
    moneroWallet: wallet,
    deviceVault: 'unlocked',
    exercises: [], library: [], discoverExercises: [], finishedSessions: [], sheets: [], programs: [], bodyEntries: [],
    backup: { state: 'off', pending: 0 }, signInStatus: null, activeSession: null,
    ...overrides
  } as unknown as AppState;
}

const synced = { height: 3_763_000, daemonHeight: 3_763_000, synchronized: true };

describe('Tip Jar status', () => {
  it('derives progress safely from missing, zero, stale and overshooting heights', () => {
    expect(syncFraction(null)).toBe(0);
    expect(syncFraction({ height: null, daemonHeight: 100 })).toBe(0);
    expect(syncFraction({ height: 50, daemonHeight: 0 })).toBe(0);
    expect(syncFraction({ height: 50, daemonHeight: 100 })).toBe(0.5);
    expect(syncFraction({ height: 120, daemonHeight: 100 })).toBe(1);
    expect(syncFraction({ height: -5, daemonHeight: 100 })).toBe(0);
  });

  it('maps every wallet state to one visual state', () => {
    expect(tipJarStatus(state({ settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } } as Partial<AppState>, { status: 'ready', snapshot: snapshot(synced) })).visual).toBe('off');
    expect(tipJarStatus(state({}, { status: 'unknown' })).visual).toBe('connecting');
    expect(tipJarStatus(state({}, { status: 'opening' })).visual).toBe('connecting');
    expect(tipJarStatus(state({}, { status: 'missing', stored: false })).spoken).toBe('not set up');
    expect(tipJarStatus(state({ deviceVault: 'locked' }, { status: 'stored' })).word).toBe('Locked');
    expect(tipJarStatus(state({ pubkey: null }, { status: 'unknown' })).visual).toBe('error');
    expect(tipJarStatus(state({}, { status: 'error', snapshot: snapshot(synced) })).visual).toBe('error');
    // Ready means opened and synchronized, not merely opened.
    expect(tipJarStatus(state({}, { status: 'ready', snapshot: snapshot(null) })).visual).toBe('connecting');
    expect(tipJarStatus(state({}, { status: 'ready', snapshot: snapshot({ height: 90, daemonHeight: 100, synchronized: false }) })).visual).toBe('connecting');
    expect(tipJarStatus(state({}, { status: 'ready', snapshot: snapshot(synced) }))).toEqual({ visual: 'ready', word: 'Ready', spoken: 'ready', progress: 1 });
  });

  it('prefers live sync progress and speaks it as a percentage', () => {
    const status = tipJarStatus(state({}, { status: 'syncing', syncProgress: 0.724, snapshot: snapshot(synced) }));
    expect(status).toMatchObject({ visual: 'syncing', progress: 0.724, spoken: 'syncing, 72 percent' });
    expect(tipJarStatus(state({}, { status: 'syncing', snapshot: snapshot({ height: 25, daemonHeight: 100, synchronized: false }) })).progress).toBe(0.25);
    expect(tipJarStatus(state({}, { status: 'syncing', syncProgress: Number.NaN })).progress).toBe(0);
  });
});

describe('Tip Jar navigation', () => {
  it('is the last bottom-nav item, a piggy bank, and stays reachable while off', () => {
    document.body.innerHTML = shellFrame(state({ view: 'exercises', settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } } as Partial<AppState>));
    const items = [...document.querySelectorAll<HTMLElement>('.sidebar .nav-item')];
    expect(items.map((item) => item.dataset.view)).toEqual(['exercises', 'workouts', 'statistics', 'tipjar']);
    const tipJar = items[3];
    expect(tipJar.querySelector('.tip-jar-piggy')).toBeTruthy();
    expect(tipJar.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.tipJar).toBe('off');
    expect(tipJar.textContent?.replace(/\s+/g, ' ').trim()).toBe('Tip Jar, off');
    expect(tipJar.classList.contains('active')).toBe(false);
  });

  // #260: the piggy bank is the whole icon. A second permanent Monero mark in the navigation
  // said "this app is Monero" every time anyone looked at the bottom of the screen.
  it('carries no Monero badge in any state', () => {
    for (const wallet of [
      { status: 'unknown' as const },
      { status: 'syncing' as const, syncProgress: 0.4 },
      { status: 'ready' as const, snapshot: snapshot(synced) },
      { status: 'error' as const, message: 'offline' }
    ]) {
      document.body.innerHTML = shellFrame(state({}, wallet));
      const tipJar = document.querySelector<HTMLElement>('.sidebar [data-view="tipjar"]')!;
      expect(tipJar.querySelector('.tip-jar-badge, .tip-jar-badge-disc, .tip-jar-badge-mark')).toBeNull();
      expect(tipJar.innerHTML).not.toContain('monero');
      expect(tipJar.querySelector('.tip-jar-piggy')).toBeTruthy();
    }
  });

  it('names the nav item after the state it is in', () => {
    expect(tipJarNavLabel('off')).toBe('Tip Jar');
    expect(tipJarNavLabel('connecting')).toBe('Syncing');
    expect(tipJarNavLabel('syncing')).toBe('Syncing');
    expect(tipJarNavLabel('ready')).toBe('Tip Jar');
    expect(tipJarNavLabel('error')).toBe('Offline');
  });

  // The ring exists to show a sync running. Ready and error both stop the sync, so both stop
  // the ring: a full orange circle would be decoration, and a frozen arc would be a lie.
  it('rings the piggy bank only while a sync is running', () => {
    const ringHidden = (visual: string) => `.tip-jar-icon[data-tip-jar="${visual}"] .tip-jar-progress`;
    const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');
    for (const visual of ['off', 'ready', 'error']) expect(css).toContain(ringHidden(visual));
    expect(css).toContain('.tip-jar-icon[data-tip-jar="connecting"] .tip-jar-ring { opacity: 0; }');

    document.body.innerHTML = shellFrame(state({}, { status: 'ready', snapshot: snapshot(synced) }));
    const ready = document.querySelector<HTMLElement>('.sidebar [data-view="tipjar"]')!;
    expect(ready.classList.contains('active')).toBe(true);
    expect(ready.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.tipJar).toBe('ready');
    expect(ready.querySelector('.tip-jar-label')?.textContent).toBe('Tip Jar');
  });

  // The ring starts at twelve o'clock and fills clockwise, and its offset is the only thing a
  // sync tick writes into the SVG.
  it('patches state, ring offset, label and spoken text as a sync advances', () => {
    const s = state({}, { status: 'syncing', syncProgress: 0.1 });
    document.body.innerHTML = `<nav class="sidebar"><div class="nav-item" data-view="tipjar">${tipJarNavIcon(tipJarStatus(s))}</div></nav>`;
    const piggy = document.querySelector('.tip-jar-piggy');
    const ring = document.querySelector('.tip-jar-ring')!;
    expect(ring.getAttribute('transform')).toBe('rotate(-90 14 14)');
    expect(ring.getAttribute('stroke-dashoffset')).toBe('90');
    expect(document.querySelector('.tip-jar-label')?.textContent).toBe('Syncing');
    s.moneroWallet = { status: 'syncing', syncProgress: 0.6 };
    updateTipJarNav(document, s);
    expect(document.querySelector('.tip-jar-ring')?.getAttribute('stroke-dashoffset')).toBe('40');
    expect(document.querySelector('.tip-jar-spoken')?.textContent).toBe(', syncing, 60 percent');
    s.moneroWallet = { status: 'error', message: 'offline' };
    updateTipJarNav(document, s);
    expect(document.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.tipJar).toBe('error');
    expect(document.querySelector('.tip-jar-label')?.textContent).toBe('Offline');
    expect(document.querySelector('.tip-jar-spoken')?.textContent).toBe(', unavailable');
    expect(document.querySelector('.tip-jar-piggy')).toBe(piggy);
  });
});

describe('Tip Jar page', () => {
  function page(s: AppState): HTMLElement {
    document.body.innerHTML = tipJarView(s);
    return document.body;
  }

  it('offers only an Enable action while off', () => {
    const root = page(state({ settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } } as Partial<AppState>));
    expect(root.textContent).toContain('Tip Jar is off.');
    expect(root.querySelector('#tip-jar-enable')?.textContent).toBe('Enable Tip Jar');
    expect(root.textContent).not.toMatch(/restore height|daemon|NIP-A3|kind:10133/i);
  });

  it('shows balance, readiness and actions without raw block heights', () => {
    const root = page(state({}, { status: 'ready', stored: true, snapshot: snapshot(synced) }));
    expect(root.querySelector('#tip-jar-balance')?.textContent).toBe('0.024 XMR');
    expect(root.querySelector('#tip-jar-status')?.textContent).toBe('Ready');
    expect(root.querySelector('#tip-jar-receive')).toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>('#tip-jar-send')?.disabled).toBe(true);
    expect(root.textContent).not.toContain('3763000');
    expect(root.textContent).not.toMatch(/restore height|daemon/i);
  });

  it('keeps receiving available while the wallet is still syncing', () => {
    const root = page(state({}, { status: 'syncing', stored: true, addresses: [ADDRESS, '4Primary'], syncProgress: 0.3 }));
    expect(root.querySelector('#tip-jar-status')?.textContent).toBe('Syncing');
    expect(root.querySelector<HTMLButtonElement>('#tip-jar-receive')?.disabled).toBe(false);
    expect(root.querySelector('#tip-jar-receive-panel code')?.textContent).toBe(ADDRESS);
  });

  it('keeps the page to balance, actions and recent activity', () => {
    const root = page(state({ monero: { status: 'ready', address: '' } } as Partial<AppState>, { status: 'ready', stored: true, snapshot: snapshot(synced) }));
    expect(root.querySelector('#tip-jar-activity .tip-jar-activity-title')?.textContent).toBe('Recent activity');
    expect(root.querySelector('#tip-jar-publish')).toBeNull();
    expect(root.querySelector('[data-view="settings"]')).toBeNull();
    expect(root.textContent).not.toMatch(/Receiving tips|Recovery phrase|not available yet/);
    expect(root.querySelector('#tip-jar-send')?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('asks to set up a wallet only when the account has none', () => {
    expect(page(state({}, { status: 'missing', stored: false })).querySelector('#tip-jar-create')).toBeTruthy();
    expect(page(state({}, { status: 'stored', stored: true, addresses: [ADDRESS] })).querySelector('#tip-jar-create')).toBeNull();
    expect(page(state({}, { status: 'checking' })).querySelector('#tip-jar-create')).toBeNull();
    expect(page(state({ deviceVault: 'locked' }, { status: 'stored' })).textContent).toContain('Unlock Workstr');
  });

  it('patches balance and status in place, keeping an open Receive panel open', () => {
    const s = state({}, { status: 'syncing', stored: true, snapshot: snapshot(synced, '0') });
    const root = page(s);
    const panel = root.querySelector<HTMLElement>('#tip-jar-receive-panel')!;
    panel.hidden = false;
    s.moneroWallet = { status: 'ready', stored: true, snapshot: snapshot(synced, '1000000000000') };
    updateTipJarPage(root, s);
    expect(root.querySelector('#tip-jar-receive-panel')).toBe(panel);
    expect(panel.hidden).toBe(false);
    expect(root.querySelector('#tip-jar-balance')?.textContent).toBe('1 XMR');
    expect(root.querySelector('#tip-jar-status')?.textContent).toBe('Ready');
    s.settings = { ...s.settings, paymentMode: 'off' };
    updateTipJarPage(root, s);
    expect(root.querySelector('#tip-jar-enable')).toBeTruthy();
    expect(tipJarPhase(s)).toBe('off');
  });
});

describe('Tip Jar automatic sync', () => {
  afterEach(() => { vi.useRealTimers(); });

  function controller(overrides: Partial<AppState> = {}, wallet: MoneroWalletUiState = { status: 'unknown' }) {
    const s = state({ view: 'exercises', ...overrides }, wallet);
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    let open = false;
    const core = {
      hasWallet: vi.fn(async () => true),
      hasLegacyWallet: vi.fn(async () => false),
      storedAddresses: vi.fn(async () => [ADDRESS, '4Primary']),
      isOpen: vi.fn(() => open),
      openWallet: vi.fn(async () => { open = true; return snapshot({ height: 3_700_000, daemonHeight: 3_763_000, synchronized: true }); }),
      sync: vi.fn(async (onProgress?: (fraction: number, remaining: number) => void) => {
        onProgress?.(0.5, 30_000);
        return { ...synced, updatedAt: 'x' };
      }),
      balance: vi.fn(async () => ({ atomicBalance: '5', atomicUnlockedBalance: '5' })),
      transactions: vi.fn(async () => []),
      close: vi.fn(async () => { open = false; })
    } as unknown as MoneroWalletCore;
    const onChange = vi.fn();
    const onActivity = vi.fn();
    const vault = { isUnlocked: () => s.deviceVault === 'unlocked' } as DeviceVault;
    const ctrl = createMoneroWalletController({ root, state: s, toast: vi.fn(), repaintMoneroAddress: vi.fn(), onChange, onActivity, vault, core });
    return { s, core, ctrl, onChange, onActivity };
  }

  it('does nothing while the Tip Jar is off, signed out or locked', async () => {
    for (const overrides of [
      { settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } },
      { pubkey: null },
      { deviceVault: 'locked' }
    ] as Partial<AppState>[]) {
      const { core, ctrl } = controller(overrides);
      await ctrl.autoSync();
      expect(core.hasWallet).not.toHaveBeenCalled();
      expect(core.openWallet).not.toHaveBeenCalled();
    }
  });

  it('opens and syncs a stored wallet without a Sync tap, showing progress on the first sync', async () => {
    const { s, core, ctrl, onChange } = controller();
    const seen: string[] = [];
    onChange.mockImplementation(() => { seen.push(tipJarStatus(s).visual); });
    await ctrl.autoSync();
    expect(core.openWallet).toHaveBeenCalledTimes(1);
    expect(core.sync).toHaveBeenCalledTimes(1);
    expect(seen).toContain('syncing');
    expect(tipJarStatus(s).visual).toBe('ready');
    expect(s.moneroWallet?.snapshot?.balance?.atomicBalance).toBe('5');
    ctrl.reset();
  });

  it('hands each sync\'s transactions to Tip Jar activity, and a failed listing does not fail the sync', async () => {
    const { s, core, ctrl, onActivity } = controller();
    const txs = [{ txid: 'in-1', direction: 'in' as const, amountAtomic: '5', state: 'confirmed' as const }];
    vi.mocked(core.transactions).mockResolvedValueOnce(txs);
    await ctrl.autoSync();
    expect(onActivity).toHaveBeenCalledWith('wallet-1', null);
    expect(onActivity).toHaveBeenLastCalledWith('wallet-1', txs);
    ctrl.reset();

    const second = controller();
    vi.mocked(second.core.transactions).mockRejectedValueOnce(new Error('no listing'));
    await second.ctrl.autoSync();
    expect(tipJarStatus(second.s).visual).toBe('ready');
    expect(second.onActivity).toHaveBeenLastCalledWith('wallet-1', null);
    second.ctrl.reset();
    expect(s.moneroWallet?.status).toBe('unknown');
  });

  it('never creates a wallet on its own', async () => {
    const { s, core, ctrl } = controller();
    vi.mocked(core.hasWallet).mockResolvedValue(false);
    await ctrl.autoSync();
    expect(s.moneroWallet?.status).toBe('missing');
    expect(core.openWallet).not.toHaveBeenCalled();
    expect((core as unknown as { createWallet?: unknown }).createWallet).toBeUndefined();
    ctrl.reset();
  });

  it('re-syncs on a timer in the background, staying ready when only a few blocks behind', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl, onChange } = controller();
    await ctrl.autoSync();
    expect(tipJarStatus(s).visual).toBe('ready');
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (fraction: number, remaining: number) => void) => {
      onProgress?.(0.2, 3);
      return { ...synced, updatedAt: 'y' };
    });
    const seen: string[] = [];
    onChange.mockImplementation(() => { seen.push(tipJarStatus(s).visual); });
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS);
    expect(core.sync).toHaveBeenCalledTimes(2);
    expect(core.openWallet).toHaveBeenCalledTimes(1);
    expect(seen).not.toContain('syncing');
    expect(tipJarStatus(s).visual).toBe('ready');
    ctrl.reset();
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS * 2);
    expect(core.sync).toHaveBeenCalledTimes(2);
  });

  it('shows a background sync that is far behind as syncing', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl, onChange } = controller();
    await ctrl.autoSync();
    let during = '';
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (fraction: number, remaining: number) => void) => {
      onProgress?.(0.1, 5_000);
      during = tipJarStatus(s).visual;
      return { ...synced, updatedAt: 'z' };
    });
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS);
    expect(during).toBe('syncing');
    expect(tipJarStatus(s).visual).toBe('ready');
    ctrl.reset();
  });

  it('shows an offline Tip Jar when sync fails, and retries later', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl } = controller();
    vi.mocked(core.sync).mockRejectedValue(new Error('Failed to fetch'));
    await ctrl.autoSync();
    expect(tipJarStatus(s).visual).toBe('error');
    vi.mocked(core.sync).mockResolvedValue({ ...synced, updatedAt: 'later' });
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS);
    expect(tipJarStatus(s).visual).toBe('ready');
    ctrl.reset();
  });

  it('closes the wallet and stops syncing when the Tip Jar is switched off', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl } = controller();
    await ctrl.autoSync();
    s.settings = { ...s.settings, paymentMode: 'off' };
    await ctrl.stop();
    expect(core.close).toHaveBeenCalled();
    expect(s.moneroWallet?.status).toBe('stored');
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS * 2);
    expect(core.sync).toHaveBeenCalledTimes(1);
  });
});
