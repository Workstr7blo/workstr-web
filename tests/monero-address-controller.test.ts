// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMoneroAddressController } from '../src/app/monero-address-controller';
import { EMPTY_ADDRESS_COPY, moneroAddressSection, paymentModeCard } from '../src/features/support/payment-mode-views';
import type { AppState } from '../src/app/state';
import type { SignedNostrEvent, Signer } from '../src/signer/types';

const { fetchPaymentTargetsEventMock, publishMoneroPaymentTargetMock } = vi.hoisted(() => ({
  fetchPaymentTargetsEventMock: vi.fn(),
  publishMoneroPaymentTargetMock: vi.fn()
}));

vi.mock('../src/nostr/payment-targets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/payment-targets')>(),
  fetchPaymentTargetsEvent: fetchPaymentTargetsEventMock,
  publishMoneroPaymentTarget: publishMoneroPaymentTargetMock
}));

const ADDRESS = `8${'B'.repeat(94)}`;
const OTHER_ADDRESS = `4${'C'.repeat(94)}`;
const PUBKEY = 'a'.repeat(64);

function targetsEvent(tags: string[][]): SignedNostrEvent {
  return { id: 'e1', pubkey: PUBKEY, kind: 10133, created_at: 1, tags, content: '', sig: 's' } as SignedNostrEvent;
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: PUBKEY,
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: ['wss://relay.example'] },
    monero: { status: 'idle', address: '' },
    ...overrides
  } as AppState;
}

const signer = { getPublicKey: async () => PUBKEY, signEvent: vi.fn() } as unknown as Signer;

function harness(overrides: Partial<AppState> = {}, getSigner: () => Promise<Signer | null> = async () => signer) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const app = state(overrides);
  const toast = vi.fn();
  root.innerHTML = moneroAddressSection(app.monero, Boolean(app.pubkey));
  const controller = createMoneroAddressController({ root, state: app, toast, getSigner });
  controller.bind();
  const field = () => root.querySelector<HTMLInputElement>('#monero-address');
  const text = () => root.textContent || '';
  return { root, state: app, toast, controller, field, text };
}

describe('Monero payment address settings', () => {
  beforeEach(() => {
    fetchPaymentTargetsEventMock.mockReset();
    publishMoneroPaymentTargetMock.mockReset();
  });

  it('renders the Monero address section only in Monero Mode', () => {
    const lightning = paymentModeCard(state({ settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] } }));
    expect(lightning).not.toContain('Monero payment address');
    expect(lightning).not.toContain('id="monero-address"');

    const monero = paymentModeCard(state());
    expect(monero).toContain('Monero payment address');
    expect(monero).toContain('NIP-A3 kind:10133');
    expect(monero).toContain('Use a fresh Monero subaddress.');
    expect(monero).toContain('It is not stored in Workstr sync.');
    // Opened by default so the address is reachable straight after picking the rail.
    expect(monero).toContain('<details class="settings-category payment-mode-card" open>');
  });

  it('never calls it a wallet and offers no NWC action', () => {
    const monero = paymentModeCard(state());
    expect(monero.toLowerCase()).not.toContain('wallet');
    expect(monero).not.toContain('nwc');
  });

  it('asks signed-out users to sign in instead of showing a publish field', () => {
    const markup = moneroAddressSection({ status: 'idle', address: '' }, false);
    expect(markup).toContain('Sign in with your Nostr signer');
    expect(markup).not.toContain('id="monero-address"');
    expect(markup).not.toContain('Save address');
  });

  it('shows the published address after reading kind:10133 from relays', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    const app = harness();

    await app.controller.refresh();

    expect(fetchPaymentTargetsEventMock).toHaveBeenCalledWith(PUBKEY, ['wss://relay.example']);
    expect(app.state.monero.status).toBe('ready');
    expect(app.state.monero.address).toBe(ADDRESS);
    expect(app.field()?.value).toBe(ADDRESS);
    expect(app.text()).toContain('PUBLISHED');
  });

  it('states plainly when the author publishes no Monero target', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(null);
    const app = harness();

    await app.controller.refresh();

    expect(app.state.monero.address).toBe('');
    expect(app.text()).toContain(EMPTY_ADDRESS_COPY);
    expect(app.text()).toContain('NOT SET');
  });

  it('keeps Settings usable when the lookup fails, and does not claim there is no address', async () => {
    fetchPaymentTargetsEventMock.mockRejectedValueOnce(new Error('payment target lookup timed out'));
    const app = harness();

    await app.controller.refresh();

    expect(app.state.monero.status).toBe('error');
    expect(app.text()).toContain('Could not read your payment targets');
    expect(app.text()).toContain('payment target lookup timed out');
    expect(app.text()).not.toContain(EMPTY_ADDRESS_COPY);
    expect(app.field()).toBeTruthy();
  });

  it('publishes an edited address through the NIP-A3 helper', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'lightning', 'user@example.com']]));
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({
      event: targetsEvent([['payto', 'lightning', 'user@example.com'], ['payto', 'monero', OTHER_ADDRESS]]),
      okRelays: ['wss://relay.example'],
      failedRelays: []
    });
    const app = harness();
    await app.controller.refresh();

    app.field()!.value = OTHER_ADDRESS;
    await app.controller.save();

    const [, address, options] = publishMoneroPaymentTargetMock.mock.calls[0];
    expect(address).toBe(OTHER_ADDRESS);
    expect(options.relays).toEqual(['wss://relay.example']);
    // The event just read is handed back so unrelated payment targets survive the write.
    expect(options.existing?.tags).toEqual([['payto', 'lightning', 'user@example.com']]);
    expect(app.state.monero.address).toBe(OTHER_ADDRESS);
    expect(app.text()).toContain('Monero address published.');
    expect(app.toast).toHaveBeenCalledWith('Monero address published');
  });

  it('clears the target when the field is emptied', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({
      event: targetsEvent([]),
      okRelays: ['wss://relay.example'],
      failedRelays: []
    });
    const app = harness();
    await app.controller.refresh();
    expect(app.text()).toContain('Save address');

    app.field()!.value = '   ';
    await app.controller.save();

    expect(publishMoneroPaymentTargetMock.mock.calls[0][1]).toBe('');
    expect(app.state.monero.address).toBe('');
    expect(app.text()).toContain('Monero address removed.');
  });

  it('refuses to publish something that is not a Monero address', async () => {
    const app = harness();

    app.field()!.value = 'not-an-address';
    await app.controller.save();

    expect(publishMoneroPaymentTargetMock).not.toHaveBeenCalled();
    expect(app.text()).toContain('That does not look like a Monero address');
    // The typed value survives so it can be corrected rather than retyped.
    expect(app.field()?.value).toBe('not-an-address');
  });

  it('reports a failed publish without losing the known address', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    publishMoneroPaymentTargetMock.mockRejectedValueOnce(new Error('no relay accepted the payment target (wss://relay.example: blocked)'));
    const app = harness();
    await app.controller.refresh();

    app.field()!.value = OTHER_ADDRESS;
    await app.controller.save();

    expect(app.state.monero.address).toBe(ADDRESS);
    expect(app.state.monero.status).toBe('ready');
    expect(app.text()).toContain('Could not publish');
    expect(app.text()).toContain('blocked');
    expect(app.toast).toHaveBeenCalledWith('Could not publish the Monero address', 'bad');
  });

  it('never publishes against an unread event, so unrelated targets cannot be dropped', async () => {
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({
      event: targetsEvent([['payto', 'monero', ADDRESS]]),
      okRelays: ['wss://relay.example'],
      failedRelays: []
    });
    const app = harness();

    app.field()!.value = ADDRESS;
    await app.controller.save();

    // Undefined means "look it up first" in publishMoneroPaymentTarget; null would mean
    // "this author has no event", which is a claim no lookup has backed here.
    expect(publishMoneroPaymentTargetMock.mock.calls[0][2].existing).toBeUndefined();
  });

  it('does nothing on relays until the user is signed in', async () => {
    const app = harness({ pubkey: null }, async () => null);

    app.controller.refreshIfNeeded();
    await app.controller.save();

    expect(fetchPaymentTargetsEventMock).not.toHaveBeenCalled();
    expect(publishMoneroPaymentTargetMock).not.toHaveBeenCalled();
    expect(app.toast).toHaveBeenCalledWith('Sign in to publish a Monero address', 'bad');
  });

  it('stays off the network in Lightning mode', () => {
    const app = harness({ settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] } });

    app.controller.refreshIfNeeded();

    expect(fetchPaymentTargetsEventMock).not.toHaveBeenCalled();
  });
});
