// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { moneroAddressFitsNetwork, parseXmrAmount, sendErrorMessage, sendReadiness, xmrExact } from '../src/features/monero/wallet-send';
import { createMoneroSendController } from '../src/app/monero-send-controller';
import { createMoneroTipController } from '../src/app/monero-tip-controller';
import { tipJarView, updateTipJarPage } from '../src/features/monero/tip-jar-view';
import type { AppState } from '../src/app/state';
import type { MoneroPreparedTransfer, MoneroSendRecipient } from '../src/features/monero/types';

const ACCOUNT = 'ab'.repeat(32);
const CREATOR = 'cd'.repeat(32);
const CREATOR_ADDRESS = `8${'C'.repeat(94)}`;
const OTHER_ADDRESS = `4${'D'.repeat(94)}`;
const STAGENET_ADDRESS = `5${'E'.repeat(94)}`;

function state(overrides: Partial<AppState> = {}, balance = { atomicBalance: '24000000000', atomicUnlockedBalance: '20000000000' }, synchronized = true): AppState {
  return {
    pubkey: ACCOUNT, profileNames: {}, authorProfiles: {}, deviceVault: 'unlocked',
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] },
    monero: { status: 'ready', address: '' },
    moneroWallet: { status: 'ready', stored: true, snapshot: { metadata: { id: 'wallet-1', network: 'mainnet', creatorSubaddress: `8${'T'.repeat(94)}` }, balance, sync: { height: 10, daemonHeight: 10, synchronized, updatedAt: '' } } },
    programs: [],
    ...overrides
  } as unknown as AppState;
}

describe('send rules', () => {
  it('parses XMR amounts into atomic units without floating point', () => {
    expect(parseXmrAmount('0.005')).toBe('5000000000');
    expect(parseXmrAmount('0,005')).toBe('5000000000');
    expect(parseXmrAmount('.1')).toBe('100000000000');
    expect(parseXmrAmount('2')).toBe('2000000000000');
    expect(parseXmrAmount('0.000000000001')).toBe('1');
    for (const bad of ['', '0', '0.0', '-1', '1e3', '0.0000000000001', 'abc', '1.2.3', '.']) expect(parseXmrAmount(bad)).toBeNull();
  });

  it('shows every significant digit on the confirmation screen', () => {
    expect(xmrExact('5000000000')).toBe('0.005 XMR');
    expect(xmrExact('30720000')).toBe('0.00003072 XMR');
    expect(xmrExact('2000000000000')).toBe('2 XMR');
  });

  it('accepts only addresses for the wallet\'s own network', () => {
    expect(moneroAddressFitsNetwork(CREATOR_ADDRESS, 'mainnet')).toBe(true);
    expect(moneroAddressFitsNetwork(OTHER_ADDRESS, 'mainnet')).toBe(true);
    expect(moneroAddressFitsNetwork(STAGENET_ADDRESS, 'mainnet')).toBe(false);
    expect(moneroAddressFitsNetwork(STAGENET_ADDRESS, 'stagenet')).toBe(true);
    expect(moneroAddressFitsNetwork(`8${'0'.repeat(94)}`, 'mainnet')).toBe(false);
    expect(moneroAddressFitsNetwork('8short', 'mainnet')).toBe(false);
  });

  it('allows a send only from an open, synchronized Tip Jar with spendable XMR', () => {
    expect(sendReadiness(state())).toEqual({ ok: true, availableAtomic: '20000000000', network: 'mainnet' });
    expect(sendReadiness(state({ settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } } as Partial<AppState>)).ok).toBe(false);
    expect(sendReadiness(state({ deviceVault: 'locked' } as Partial<AppState>)).ok).toBe(false);
    expect(sendReadiness(state({}, undefined, false))).toMatchObject({ ok: false, reason: expect.stringMatching(/syncing/) });
    expect(sendReadiness(state({}, { atomicBalance: '5', atomicUnlockedBalance: '0' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/10 confirmations/) });
    expect(sendReadiness(state({}, { atomicBalance: '0', atomicUnlockedBalance: '0' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/empty/) });
  });

  it('puts wallet errors into words a person can act on', () => {
    expect(sendErrorMessage(new Error('not enough unlocked money'), '3000000000')).toBe('Insufficient balance for this amount plus the network fee. Available: 0.003 XMR.');
    expect(sendErrorMessage(new Error('Invalid destination address'), '0')).toMatch(/not valid/);
  });
});

function setup(overrides: Partial<AppState> = {}, wallet?: Partial<{ prepareTransfer: ReturnType<typeof vi.fn>; relayTransfer: ReturnType<typeof vi.fn> }>) {
  const s = state(overrides);
  document.body.innerHTML = '<div id="app"><div id="modal"><div id="modal-content"></div></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const prepared: MoneroPreparedTransfer = { address: CREATOR_ADDRESS, amountAtomic: '5000000000', feeAtomic: '30720000', metadata: 'signed-tx' };
  const walletApi = {
    prepareTransfer: wallet?.prepareTransfer ?? vi.fn(async (request: { address: string; amountAtomic: string }) => ({ ...prepared, ...request })),
    relayTransfer: wallet?.relayTransfer ?? vi.fn(async () => 'f9a0000000000000000000000000000000000000000000000000000000073c')
  };
  const activity = { recordOutgoing: vi.fn(async () => undefined) };
  const toast = vi.fn();
  const afterSend = vi.fn();
  const closeModal = vi.fn(() => { root.querySelector('#modal-content')!.innerHTML = ''; });
  const ctrl = createMoneroSendController({
    root, state: s, toast, closeModal, afterSend, activity, wallet: walletApi as never,
    openModal: (content) => { root.querySelector('#modal-content')!.innerHTML = content; }
  });
  return { s, root, ctrl, walletApi, activity, toast, afterSend, closeModal };
}

const creator: MoneroSendRecipient = { address: CREATOR_ADDRESS, pubkey: CREATOR, name: 'Settebello', programAddress: '33402:x:5x5', programName: '5x5 Strength' };

function click(root: HTMLElement, selector: string): void {
  root.querySelector<HTMLElement>(selector)!.click();
}

function submit(root: HTMLElement): void {
  root.querySelector<HTMLFormElement>('#monero-send-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('the send sheet', () => {
  it('tips a creator: amount, review with fee and total, explicit confirm, then the txid', async () => {
    const { root, ctrl, walletApi, activity, afterSend } = setup();
    expect(ctrl.openTip(creator)).toBe(true);
    expect(root.querySelector('#monero-send-title')?.textContent).toBe('Tip with Monero');
    expect(root.textContent).toContain('Available 0.02 XMR');
    click(root, '[data-send-preset="0.005"]');
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('#monero-send-title')?.textContent).toBe('Confirm Monero tip'));
    expect(walletApi.prepareTransfer).toHaveBeenCalledWith({ address: CREATOR_ADDRESS, amountAtomic: '5000000000' });
    // Nothing has been broadcast from the amount or review steps.
    expect(walletApi.relayTransfer).not.toHaveBeenCalled();
    const review = Object.fromEntries([...root.querySelectorAll('.monero-send-review > div')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]));
    expect(review).toEqual({ Send: '0.005 XMR', To: 'Settebello', Address: '8CCCCC…CCCCCC', 'Network fee': '0.00003072 XMR', Total: '0.00503072 XMR' });
    click(root, '[data-send-action="confirm"]');
    await vi.waitFor(() => expect(root.querySelector('#monero-send-title')?.textContent).toBe('Tip sent'));
    expect(walletApi.relayTransfer).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.monero-send-txid code')?.textContent).toBe('f9a000…00073c');
    expect(activity.recordOutgoing).toHaveBeenCalledWith(expect.objectContaining({
      txid: 'f9a0000000000000000000000000000000000000000000000000000000073c', amountAtomic: '5000000000', feeAtomic: '30720000',
      recipientAddress: CREATOR_ADDRESS, recipientPubkey: CREATOR, program: { address: '33402:x:5x5', name: '5x5 Strength' }
    }));
    expect(afterSend).toHaveBeenCalled();
  });

  it('refuses an amount above the spendable balance before building anything', async () => {
    const { root, ctrl, walletApi } = setup();
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.5';
    submit(root);
    expect(root.querySelector('.monero-send-error')?.textContent).toBe('Insufficient balance. Available: 0.02 XMR.');
    expect(walletApi.prepareTransfer).not.toHaveBeenCalled();
  });

  it('refuses when the amount plus the fee is more than is spendable', async () => {
    const { root, ctrl } = setup({}, { prepareTransfer: vi.fn(async () => ({ address: CREATOR_ADDRESS, amountAtomic: '20000000000', feeAtomic: '30720000', metadata: 'm' })) });
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.02';
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('.monero-send-error')?.textContent).toMatch(/Required with the network fee: 0.02003072 XMR/));
    expect(root.querySelector('#monero-send-title')?.textContent).toBe('Tip with Monero');
  });

  it('returns to the amount with a reason when the wallet cannot build the transfer', async () => {
    const { root, ctrl } = setup({}, { prepareTransfer: vi.fn(async () => { throw new Error('not enough money'); }) });
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.01';
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('.monero-send-error')?.textContent).toMatch(/^Insufficient balance/));
    expect(root.querySelector<HTMLInputElement>('#monero-send-amount')?.value).toBe('0.01');
  });

  it('never offers to send again after a broadcast with an unknown outcome', async () => {
    const relay = vi.fn(async () => { throw new Error('timeout'); });
    const { root, ctrl, activity } = setup({}, { relayTransfer: relay });
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.005';
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('[data-send-action="confirm"]')).toBeTruthy());
    click(root, '[data-send-action="confirm"]');
    await vi.waitFor(() => expect(root.querySelector('#monero-send-title')?.textContent).toBe('Send not confirmed'));
    expect(root.textContent).toMatch(/check Recent activity/);
    expect(root.querySelector('[data-send-action="back"]')).toBeNull();
    expect(root.querySelector('[data-send-action="confirm"]')).toBeNull();
    expect(relay).toHaveBeenCalledTimes(1);
    expect(activity.recordOutgoing).not.toHaveBeenCalled();
  });

  it('broadcasts once even if Confirm is tapped twice', async () => {
    let finish: (txid: string) => void = () => undefined;
    const relay = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { root, ctrl } = setup({}, { relayTransfer: relay });
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.005';
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('[data-send-action="confirm"]')).toBeTruthy());
    const confirm = root.querySelector<HTMLButtonElement>('[data-send-action="confirm"]')!;
    confirm.click();
    confirm.click();
    root.querySelector<HTMLButtonElement>('[data-send-action="confirm"]')?.click();
    finish('abc');
    await vi.waitFor(() => expect(root.querySelector('#monero-send-title')?.textContent).toBe('Tip sent'));
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('reports the result by toast when the sheet was closed while sending', async () => {
    let finish: (txid: string) => void = () => undefined;
    const { root, ctrl, toast } = setup({}, { relayTransfer: vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })) });
    ctrl.openTip(creator);
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.005';
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('[data-send-action="confirm"]')).toBeTruthy());
    click(root, '[data-send-action="confirm"]');
    root.querySelector('#modal-content')!.innerHTML = '';
    finish('abc');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Tip sent'));
  });

  it('sends to a typed address and rejects one for another network', async () => {
    const { root, ctrl, walletApi } = setup();
    expect(ctrl.openSend()).toBe(true);
    expect(root.querySelector('#monero-send-title')?.textContent).toBe('Send Monero');
    expect(root.querySelector('[data-send-preset]')).toBeNull();
    root.querySelector<HTMLTextAreaElement>('#monero-send-address')!.value = STAGENET_ADDRESS;
    root.querySelector<HTMLInputElement>('#monero-send-amount')!.value = '0.001';
    submit(root);
    expect(root.querySelector('.monero-send-error')?.textContent).toBe('Enter a valid Monero address.');
    root.querySelector<HTMLTextAreaElement>('#monero-send-address')!.value = OTHER_ADDRESS;
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('#monero-send-title')?.textContent).toBe('Confirm send'));
    expect(walletApi.prepareTransfer).toHaveBeenCalledWith({ address: OTHER_ADDRESS, amountAtomic: '1000000000' });
  });

  it('opens a native Tip Jar state when a creator tip cannot send yet, and says why for a plain send', () => {
    const { ctrl, toast } = setup({}, undefined);
    const syncing = setup();
    syncing.s.moneroWallet!.snapshot!.sync!.synchronized = false;
    expect(syncing.ctrl.openTip(creator)).toBe(true);
    expect(syncing.root.querySelector('#monero-tip-start')?.textContent).toContain('Getting your Tip Jar ready');
    expect(syncing.root.innerHTML).not.toContain('Open wallet');
    expect(syncing.root.innerHTML).not.toContain(`monero:${CREATOR_ADDRESS}`);
    expect(syncing.ctrl.openSend()).toBe(false);
    expect(syncing.toast).toHaveBeenCalledWith(expect.stringMatching(/syncing/), 'bad');
    expect(ctrl.openSend()).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('the program-card tip', () => {
  const program = { address: '33402:x:5x5', pubkey: CREATOR, name: '5x5 Strength' };

  it('opens the Tip Jar sheet when the Tip Jar can send', () => {
    const s = state({ programs: [program], authorPaymentTargets: { [CREATOR]: CREATOR_ADDRESS }, authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: 'Settebello', picture: 'https://img/s.png' } } } as unknown as Partial<AppState>);
    const sendTip = vi.fn(() => true);
    const openModal = vi.fn();
    const ctrl = createMoneroTipController({ root: document.body, state: s, toast: vi.fn(), openModal, sendTip });
    ctrl.show(program.address);
    expect(sendTip).toHaveBeenCalledWith({ address: CREATOR_ADDRESS, pubkey: CREATOR, name: 'Settebello', picture: 'https://img/s.png', programAddress: program.address, programName: '5x5 Strength' });
    expect(openModal).not.toHaveBeenCalled();
  });

  it('opens a native Tip Jar state when it cannot send instead of handing off to another wallet', () => {
    const s = state({ programs: [program], authorPaymentTargets: { [CREATOR]: CREATOR_ADDRESS }, settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } } as unknown as Partial<AppState>);
    const openModal = vi.fn((content: string) => { document.body.innerHTML = content; });
    createMoneroTipController({ root: document.body, state: s, toast: vi.fn(), openModal, sendTip: () => {
      openModal('<section id="monero-tip-start">Turn on your Tip Jar to send tips in Workstr.<button data-tip-start-action="enable">Enable Tip Jar</button></section>');
      return true;
    } }).show(program.address);
    expect(openModal).toHaveBeenCalledWith(expect.stringContaining('Turn on your Tip Jar'));
    expect(document.body.textContent).not.toContain('Open wallet');
    expect(document.body.innerHTML).not.toContain(`monero:${CREATOR_ADDRESS}`);
  });
});

describe('the Tip Jar page Send button', () => {
  it('is enabled only while the Tip Jar can send, and follows sync ticks in place', () => {
    const s = state({}, undefined, false);
    document.body.innerHTML = tipJarView(s);
    const button = document.querySelector<HTMLButtonElement>('#tip-jar-send')!;
    expect(button.disabled).toBe(true);
    s.moneroWallet!.snapshot!.sync!.synchronized = true;
    updateTipJarPage(document, s);
    expect(document.querySelector('#tip-jar-send')).toBe(button);
    expect(button.disabled).toBe(false);
  });
});
