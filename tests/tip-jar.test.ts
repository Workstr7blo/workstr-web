// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockSyncFraction, syncFraction, tipJarNavLabel, tipJarStatus } from '../src/features/monero/tip-jar-state';
import { tipJarNavIcon, tipJarPhase, tipJarView, updateTipJarNav, updateTipJarPage } from '../src/features/monero/tip-jar-view';
import { shellFrame } from '../src/app/layout';
import { shortMoneroAddress } from '../src/app/format';
import { MONERO_MARK, moneroQr } from '../src/app/monero-mark';
import { createMoneroWalletController, TIP_JAR_RESYNC_MS } from '../src/app/monero-wallet-controller';
import type { AppState } from '../src/app/state';
import type { MoneroWalletCore } from '../src/features/monero/wallet-core';
import type { MoneroSyncProgress, MoneroWalletUiState } from '../src/features/monero/types';
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

// One scanning report. The default is a wallet catching up from the height its last sync
// reached (3,700,000) to the daemon's tip (3,763,000), halfway through those 63,000 blocks -
// a wallet that is 99.2% of the way along the chain and 50% of the way through its own sync.
function progress(overrides: Partial<MoneroSyncProgress> = {}): MoneroSyncProgress {
  return { currentHeight: 3_731_500, startHeight: 3_700_000, targetHeight: 3_763_000, fraction: 0.9915, remainingBlocks: 31_500, ...overrides };
}

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
    expect(tipJarStatus(state({}, { status: 'ready', snapshot: snapshot(synced) }))).toEqual({ visual: 'ready', word: 'Ready', spoken: 'ready', progress: 1, live: false });
  });

  // A wallet a thousand blocks behind is at 99.97% of the chain and at 0% of its own catch-up,
  // which is why the ring measures the session and not the chain (#266).
  it('measures a catch-up session from where it started, not from the genesis block', () => {
    expect(blockSyncFraction(3_763_250, 3_763_000, 3_764_000)).toBeCloseTo(0.25);
    expect(blockSyncFraction(3_763_500, 3_763_000, 3_764_000)).toBeCloseTo(0.5);
    expect(blockSyncFraction(3_763_750, 3_763_000, 3_764_000)).toBeCloseTo(0.75);
    expect(blockSyncFraction(3_764_000, 3_763_000, 3_764_000)).toBe(1);
    // Clamped both ways: a reorg below the start, or a daemon reading the wallet has passed.
    expect(blockSyncFraction(3_762_000, 3_763_000, 3_764_000)).toBe(0);
    expect(blockSyncFraction(3_765_000, 3_763_000, 3_764_000)).toBe(1);
    // No session to measure: the caller falls back rather than showing a false nought.
    expect(blockSyncFraction(3_763_000, 3_763_000, 3_763_000)).toBeNull();
    expect(blockSyncFraction(3_763_000, 3_764_000, 3_763_000)).toBeNull();
    expect(blockSyncFraction(Number.NaN, 3_763_000, 3_764_000)).toBeNull();
    expect(blockSyncFraction(3_763_250, Number.NaN, 3_764_000)).toBeNull();
    expect(blockSyncFraction(3_763_250, 3_763_000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('prefers live sync progress and speaks it as a percentage', () => {
    const status = tipJarStatus(state({}, { status: 'syncing', syncProgress: 0.724, syncLive: true, snapshot: snapshot(synced) }));
    expect(status).toMatchObject({ visual: 'syncing', progress: 0.724, spoken: 'syncing, 72 percent', live: true });
    expect(tipJarStatus(state({}, { status: 'syncing', snapshot: snapshot({ height: 25, daemonHeight: 100, synchronized: false }) })).progress).toBe(0.25);
    expect(tipJarStatus(state({}, { status: 'syncing', syncProgress: Number.NaN })).progress).toBe(0);
    // Syncing but not scanning yet: the saved position is only a hint, so it is neither called
    // live nor read out as a percentage of a sync that has not started.
    expect(tipJarStatus(state({}, { status: 'syncing', snapshot: snapshot(synced) }))).toMatchObject({ live: false, progress: 1, spoken: 'syncing' });
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
    // Connecting, and a sync that is still opening the wallet, both stop at the faint track.
    expect(css).toContain('.tip-jar-icon[data-live="off"] .tip-jar-ring { opacity: 0; }');
    expect(tipJarNavIcon(tipJarStatus(state({}, { status: 'syncing', snapshot: snapshot(synced) })))).toContain('data-live="off"');
    expect(tipJarNavIcon(tipJarStatus(state({}, { status: 'syncing', syncProgress: 0.4, syncLive: true })))).toContain('data-live="on"');

    document.body.innerHTML = shellFrame(state({}, { status: 'ready', snapshot: snapshot(synced) }));
    const ready = document.querySelector<HTMLElement>('.sidebar [data-view="tipjar"]')!;
    expect(ready.classList.contains('active')).toBe(true);
    expect(ready.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.tipJar).toBe('ready');
    expect(ready.querySelector('.tip-jar-label')?.textContent).toBe('Tip Jar');
  });

  // The ring starts at twelve o'clock and fills clockwise, and its offset is the only thing a
  // sync tick writes into the SVG.
  it('patches state, ring offset, label and spoken text as a sync advances', () => {
    const s = state({}, { status: 'syncing', syncProgress: 0.1, syncLive: true });
    document.body.innerHTML = `<nav class="sidebar"><div class="nav-item" data-view="tipjar">${tipJarNavIcon(tipJarStatus(s))}</div></nav>`;
    const piggy = document.querySelector('.tip-jar-piggy');
    const ring = document.querySelector('.tip-jar-ring')!;
    expect(ring.getAttribute('transform')).toBe('rotate(-90 14 14)');
    expect(ring.getAttribute('stroke-dashoffset')).toBe('90');
    expect(document.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.live).toBe('on');
    expect(document.querySelector('.tip-jar-label')?.textContent).toBe('Syncing');
    s.moneroWallet = { status: 'syncing', syncProgress: 0.6, syncLive: true };
    updateTipJarNav(document, s);
    expect(document.querySelector('.tip-jar-ring')?.getAttribute('stroke-dashoffset')).toBe('40');
    expect(document.querySelector('.tip-jar-spoken')?.textContent).toBe(', syncing, 60 percent');
    s.moneroWallet = { status: 'error', message: 'offline' };
    updateTipJarNav(document, s);
    expect(document.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.tipJar).toBe('error');
    expect(document.querySelector<HTMLElement>('.tip-jar-icon')?.dataset.live).toBe('off');
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
    // Synchronized with spendable XMR: Send is live.
    expect(root.querySelector<HTMLButtonElement>('#tip-jar-send')?.disabled).toBe(false);
    expect(root.textContent).not.toContain('3763000');
    expect(root.textContent).not.toMatch(/restore height|daemon/i);
  });

  it('keeps receiving available while the wallet is still syncing', () => {
    const root = page(state({}, { status: 'syncing', stored: true, addresses: [ADDRESS, '4Primary'], syncProgress: 0.3, syncLive: true }));
    expect(root.querySelector('#tip-jar-status')?.textContent).toBe('Syncing');
    expect(root.querySelector<HTMLButtonElement>('#tip-jar-receive')?.disabled).toBe(false);
    expect(root.querySelector('#tip-jar-receive-panel code')?.textContent).toBe(shortMoneroAddress(ADDRESS));
  });

  // #268: the code is the subject of Receive. The address under it is a landmark, so it is one
  // shortened line - but nothing that hands the address over may hand over less than all of it.
  it('shows the address as one quiet line and still copies every character of it', () => {
    const s = state({}, { status: 'ready', stored: true, snapshot: snapshot(synced) });
    const root = page(s);
    const panel = root.querySelector<HTMLElement>('#tip-jar-receive-panel')!;

    const shown = panel.querySelector('.tip-jar-address')!;
    expect(shown.textContent).toBe(shortMoneroAddress(ADDRESS));
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelector('.sr-only')?.textContent).toBe(`Your Tip Jar address: ${ADDRESS}`);

    // Both the row's glyph and the button carry the whole address, and both are the same action.
    const copies = [...panel.querySelectorAll<HTMLElement>('[data-tip-jar-copy]')];
    expect(copies).toHaveLength(2);
    for (const button of copies) expect(button.dataset.address).toBe(ADDRESS);
    expect(panel.querySelector('#tip-jar-copy')?.textContent).toBe('Copy address');
    expect(panel.querySelector('.tip-jar-address-copy')?.getAttribute('aria-label')).toBe('Copy your full Tip Jar address');

    // The code still encodes the whole URI, with the official symbol on its plate.
    const code = panel.querySelector('.support-monero-qr')!;
    expect(code.getAttribute('aria-label')).toBe('QR code for your Tip Jar address');
    expect(tipJarView(s)).toContain(moneroQr(`monero:${ADDRESS}`));
    expect(code.querySelector('image')).toBeTruthy();
    expect(code.innerHTML).not.toContain(MONERO_MARK);

    // One line of help, not two sentences of it.
    expect(panel.querySelector('.section-help')?.textContent).toBe('Scan with any Monero wallet.');
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
      sync: vi.fn(async (onProgress?: (report: MoneroSyncProgress) => void) => {
        onProgress?.(progress());
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
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress({ currentHeight: 3_762_997, startHeight: 3_762_997, fraction: 0.2, remainingBlocks: 3 }));
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
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress({ currentHeight: 3_758_000, startHeight: 3_758_000, fraction: 0.1, remainingBlocks: 5_000 }));
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
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress());
      throw new Error('Failed to fetch');
    });
    await ctrl.autoSync();
    expect(tipJarStatus(s).visual).toBe('error');
    // A ring frozen where the sync died would say the wallet is still catching up.
    expect(s.moneroWallet?.syncProgress).toBeUndefined();
    expect(s.moneroWallet?.syncLive).toBeUndefined();
    vi.mocked(core.sync).mockResolvedValue({ ...synced, updatedAt: 'later' });
    await vi.advanceTimersByTimeAsync(TIP_JAR_RESYNC_MS);
    expect(tipJarStatus(s).visual).toBe('ready');
    ctrl.reset();
  });

  // #266: the ring is this catch-up session, not the wallet's place on a three-million block
  // chain. Taking the runtime's own percentage left it empty until the sync was nearly over.
  it('fills the ring from the blocks of this catch-up session', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl, onChange } = controller();
    const seen: { progress: number; live: boolean }[] = [];
    onChange.mockImplementation(() => {
      const status = tipJarStatus(s);
      if (status.visual === 'syncing') seen.push({ progress: status.progress, live: status.live });
    });
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress({ currentHeight: 3_715_750, remainingBlocks: 47_250 }));
      vi.advanceTimersByTime(600);
      onProgress?.(progress());
      vi.advanceTimersByTime(600);
      onProgress?.(progress({ currentHeight: 3_763_000, fraction: 1, remainingBlocks: 0 }));
      return { ...synced, updatedAt: 'ring' };
    });
    await ctrl.autoSync();
    // Opening is not scanning: the saved position is shown as a hint, not as live progress, and
    // never as a forced nought per cent.
    expect(seen[0].live).toBe(false);
    expect(seen[0].progress).toBeCloseTo(3_700_000 / 3_763_000, 5);
    expect(seen.slice(1)).toEqual([{ progress: 0.25, live: true }, { progress: 0.5, live: true }, { progress: 1, live: true }]);
    ctrl.reset();
  });

  it('falls back to the runtime percentage when the heights describe no session', async () => {
    const { s, core, ctrl } = controller();
    let during: ReturnType<typeof tipJarStatus> | null = null;
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress({ currentHeight: 3_763_000, startHeight: 3_763_000, targetHeight: 3_763_000, fraction: 0.42, remainingBlocks: 0 }));
      during = tipJarStatus(s);
      return { ...synced, updatedAt: 'fallback' };
    });
    await ctrl.autoSync();
    expect(during).toMatchObject({ visual: 'syncing', progress: 0.42, live: true });
    ctrl.reset();
  });

  it('paints a few times a second at most, and always lands on a full ring', async () => {
    vi.useFakeTimers();
    const { s, core, ctrl, onChange } = controller();
    const painted: number[] = [];
    onChange.mockImplementation(() => { if (s.moneroWallet?.syncLive) painted.push(tipJarStatus(s).progress); });
    vi.mocked(core.sync).mockImplementation(async (onProgress?: (report: MoneroSyncProgress) => void) => {
      onProgress?.(progress({ currentHeight: 3_715_750, remainingBlocks: 47_250 }));
      // Same instant: a report every batch of blocks must not become a repaint every batch.
      onProgress?.(progress());
      // Completion is never throttled away, so the ring is full before the Tip Jar goes ready.
      onProgress?.(progress({ currentHeight: 3_763_000, fraction: 1, remainingBlocks: 0 }));
      return { ...synced, updatedAt: 'throttled' };
    });
    await ctrl.autoSync();
    expect(painted).toEqual([0.25, 1]);
    expect(tipJarStatus(s).visual).toBe('ready');
    // Nothing of this session is left to leak into the next one.
    expect(s.moneroWallet?.syncProgress).toBeUndefined();
    expect(s.moneroWallet?.syncLive).toBeUndefined();
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
