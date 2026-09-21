// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMoneroAddressController } from '../src/app/monero-address-controller';
import { moneroTipsCard } from '../src/features/support/payment-mode-views';
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
  const app = state(overrides);
  const onChange = vi.fn();
  const controller = createMoneroAddressController({ state: app, getSigner, onChange });
  return { state: app, controller, onChange };
}

describe('the public Monero address service', () => {
  beforeEach(() => {
    fetchPaymentTargetsEventMock.mockReset();
    publishMoneroPaymentTargetMock.mockReset();
  });

  // The address is part of the Profile now. The Tip Jar card is only the switch, so turning
  // tips on or off can neither publish nor remove an address.
  it('leaves the Tip Jar card as a switch with no address editor', () => {
    for (const paymentMode of ['off', 'monero'] as const) {
      const markup = moneroTipsCard(state({ settings: { unit: 'kg', paymentMode, publicRelays: [] } }));
      expect(markup).toContain('role="switch" id="monero-tips-toggle"');
      expect(markup).toContain('<strong id="monero-tips-label">Tip Jar</strong>');
      expect(markup).not.toContain('monero-address');
      expect(markup).not.toContain('Refresh from relays');
      expect(markup).not.toContain('<details');
    }
  });

  it('reads the published address from kind:10133', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    const app = harness();

    await app.controller.refresh();

    expect(fetchPaymentTargetsEventMock).toHaveBeenCalledWith(PUBKEY, ['wss://relay.example']);
    expect(app.state.monero).toMatchObject({ status: 'ready', address: ADDRESS });
    expect(app.onChange).toHaveBeenCalled();
  });

  it('shares one lookup between callers that ask at the same time', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(null);
    const app = harness();

    await Promise.all([app.controller.refresh(), app.controller.refresh()]);

    expect(fetchPaymentTargetsEventMock).toHaveBeenCalledTimes(1);
    expect(app.state.monero).toMatchObject({ status: 'ready', address: '' });
  });

  it('marks a failed lookup unread rather than claiming there is no address', async () => {
    fetchPaymentTargetsEventMock.mockRejectedValueOnce(new Error('payment target lookup timed out'));
    const app = harness();

    await app.controller.refresh();

    expect(app.state.monero.status).toBe('error');
    expect(app.state.monero.event).toBeUndefined();
    expect(app.state.monero.message).toContain('payment target lookup timed out');
  });

  it('publishes through the NIP-A3 helper with the event it read, so other targets survive', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'lightning', 'user@example.com']]));
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({
      event: targetsEvent([['payto', 'lightning', 'user@example.com'], ['payto', 'monero', OTHER_ADDRESS]]),
      okRelays: ['wss://relay.example'],
      failedRelays: []
    });
    const app = harness();
    await app.controller.refresh();

    const result = await app.controller.publish(`  ${OTHER_ADDRESS} `);

    const [, address, options] = publishMoneroPaymentTargetMock.mock.calls[0];
    expect(address).toBe(OTHER_ADDRESS);
    expect(options.relays).toEqual(['wss://relay.example']);
    expect(options.existing?.tags).toEqual([['payto', 'lightning', 'user@example.com']]);
    expect(result).toEqual({ ok: true, address: OTHER_ADDRESS });
    expect(app.state.monero.address).toBe(OTHER_ADDRESS);
  });

  it('removes only the Monero target when published empty', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({ event: targetsEvent([]), okRelays: ['wss://relay.example'], failedRelays: [] });
    const app = harness();
    await app.controller.refresh();

    const result = await app.controller.publish('');

    expect(publishMoneroPaymentTargetMock.mock.calls[0][1]).toBe('');
    expect(result).toEqual({ ok: true, address: '' });
    expect(app.state.monero.address).toBe('');
  });

  it('refuses to publish something that is not a Monero address', async () => {
    const app = harness();

    const result = await app.controller.publish('not-an-address');

    expect(publishMoneroPaymentTargetMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('That does not look like a Monero address');
  });

  it('says the signer did not answer rather than blaming a relay', async () => {
    publishMoneroPaymentTargetMock.mockRejectedValueOnce(new Error('signer approval timed out'));
    const app = harness();

    const result = await app.controller.publish(ADDRESS);

    expect(!result.ok && result.message).toContain('Your signer did not answer');
  });

  it('keeps the known address when a publish fails', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    publishMoneroPaymentTargetMock.mockRejectedValueOnce(new Error('no relay accepted the payment target (wss://relay.example: blocked)'));
    const app = harness();
    await app.controller.refresh();

    const result = await app.controller.publish(OTHER_ADDRESS);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('blocked');
    expect(app.state.monero).toMatchObject({ status: 'ready', address: ADDRESS });
  });

  it('never publishes against an unread event, so unrelated targets cannot be dropped', async () => {
    publishMoneroPaymentTargetMock.mockResolvedValueOnce({ event: targetsEvent([['payto', 'monero', ADDRESS]]), okRelays: ['wss://relay.example'], failedRelays: [] });
    const app = harness();

    await app.controller.publish(ADDRESS);

    // Undefined means "look it up first" in publishMoneroPaymentTarget; null would mean
    // "this author has no event", which is a claim no lookup has backed here.
    expect(publishMoneroPaymentTargetMock.mock.calls[0][2].existing).toBeUndefined();
  });

  it('does nothing on relays until the user is signed in', async () => {
    const app = harness({ pubkey: null }, async () => null);

    app.controller.refreshIfNeeded();
    const result = await app.controller.publish(ADDRESS);

    expect(fetchPaymentTargetsEventMock).not.toHaveBeenCalled();
    expect(publishMoneroPaymentTargetMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('reads the address with tips off, because turning tips off unpublishes nothing', async () => {
    fetchPaymentTargetsEventMock.mockResolvedValueOnce(targetsEvent([['payto', 'monero', ADDRESS]]));
    const app = harness({ settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } });

    app.controller.refreshIfNeeded();
    await vi.waitFor(() => expect(app.state.monero.status).toBe('ready'));

    expect(app.state.monero.address).toBe(ADDRESS);
    expect(publishMoneroPaymentTargetMock).not.toHaveBeenCalled();
  });
});
