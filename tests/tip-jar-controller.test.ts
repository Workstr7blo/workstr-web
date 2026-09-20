// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPaymentMode, createTipJarController } from '../src/app/tip-jar-controller';
import { tipJarView } from '../src/features/monero/tip-jar-view';
import { moneroTipsCard } from '../src/features/support/payment-mode-views';
import type { AppState } from '../src/app/state';

const ADDRESS = `8${'J'.repeat(94)}`;

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: 'ab'.repeat(32), npub: null, profileName: null, profilePicture: null,
    settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] },
    monero: { status: 'ready', address: '' },
    moneroWallet: { status: 'ready', stored: true, addresses: [ADDRESS], snapshot: { metadata: { creatorSubaddress: ADDRESS }, balance: null, sync: { height: 1, daemonHeight: 1, synchronized: true, updatedAt: 'x' } } },
    deviceVault: 'unlocked',
    ...overrides
  } as unknown as AppState;
}

function setup(overrides: Partial<AppState> = {}) {
  const s = state(overrides);
  document.body.innerHTML = `<div id="app"><div id="page-host">${moneroTipsCard(s)}${tipJarView(s)}</div></div>`;
  const root = document.getElementById('app') as HTMLElement;
  const savePaymentMode = vi.fn(async (mode: 'monero' | 'off') => { s.settings = { ...s.settings, paymentMode: mode }; });
  const moneroAddress = { repaint: vi.fn(), refreshIfNeeded: vi.fn() };
  const moneroWallet = { autoSync: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), createWallet: vi.fn(async () => undefined) };
  const ctrl = createTipJarController({ root, state: s, toast: vi.fn(), savePaymentMode, refreshAuthorPaymentTargets: vi.fn(async () => undefined), moneroAddress, moneroWallet });
  return { s, root, ctrl, savePaymentMode, moneroAddress, moneroWallet };
}

describe('Tip Jar controller', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-payment-mode'); });

  it('enables from the page through the same setting as the Settings switch, and starts syncing', async () => {
    const { s, root, savePaymentMode, moneroWallet } = setup();
    root.querySelector<HTMLButtonElement>('#tip-jar-enable')?.click();
    await vi.waitFor(() => expect(moneroWallet.autoSync).toHaveBeenCalled());
    expect(savePaymentMode).toHaveBeenCalledWith('monero');
    expect(s.settings.paymentMode).toBe('monero');
    expect(root.querySelector<HTMLInputElement>('#monero-tips-toggle')?.checked).toBe(true);
    expect(document.documentElement.getAttribute('data-payment-mode')).toBe('monero');
    expect(root.querySelector('#tip-jar-enable')).toBeNull();
  });

  it('stops the wallet when switched off', async () => {
    const { s, ctrl, moneroWallet } = setup({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>);
    await ctrl.setEnabled(false);
    expect(moneroWallet.stop).toHaveBeenCalled();
    expect(moneroWallet.autoSync).not.toHaveBeenCalled();
    applyPaymentMode(s);
    expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false);
  });

  it('toggles the receive panel in place', () => {
    const { root } = setup({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>);
    const button = root.querySelector<HTMLButtonElement>('#tip-jar-receive')!;
    const panel = root.querySelector<HTMLElement>('#tip-jar-receive-panel')!;
    expect(panel.hidden).toBe(true);
    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  // The row shows a shortened address (#268); what either control puts on the clipboard is the
  // whole one, or a reader pastes a truncated address into a wallet.
  it('copies the whole address from the row glyph and from Copy address alike', async () => {
    const writeText = vi.fn(async (_address: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { root } = setup({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>);

    root.querySelector<HTMLButtonElement>('.tip-jar-address-copy')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
    root.querySelector<HTMLButtonElement>('#tip-jar-copy')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls.map(([value]) => value)).toEqual([ADDRESS, ADDRESS]);
    expect(root.querySelector('.tip-jar-address')?.textContent).not.toBe(ADDRESS);
  });
});
