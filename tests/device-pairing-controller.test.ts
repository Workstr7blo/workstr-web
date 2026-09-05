// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { nip19 } from 'nostr-tools';
import type { Signer, SignedNostrEvent, UnsignedNostrEvent } from '../src/signer/types';

const published: { pairingId: string; ciphertext: string; expiresAt: number }[] = [];
let waitResult: SignedNostrEvent | null = null;
// A real wait stays open for the life of the code. Resolving immediately would race every
// assertion about the QR screen against the expiry screen that replaces it.
let waitExpiresNow = false;
let scannerStopped = 0;
let onScan: ((value: string) => void) | null = null;
let scanThrows: Error | null = null;

vi.mock('../src/nostr/device-pairing', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/device-pairing')>(),
  publishPairingResponse: vi.fn(async (_s, _r, pairingId: string, ciphertext: string, expiresAt: number) => {
    published.push({ pairingId, ciphertext, expiresAt });
    return { eventId: 'a'.repeat(64), createdAt: 0 };
  }),
  awaitPairingResponse: vi.fn((_relay, _id, onCandidate: (e: SignedNostrEvent) => boolean | Promise<boolean>) => {
    if (waitExpiresNow) return Promise.resolve(null);
    if (!waitResult) return new Promise<SignedNostrEvent | null>(() => {});
    return Promise.resolve(onCandidate(waitResult)).then((ok) => (ok ? waitResult : null));
  })
}));

vi.mock('../src/app/qr-scanner', () => ({
  ScannerError: class ScannerError extends Error { code = 'denied'; },
  scanQr: vi.fn(async (_video: HTMLVideoElement, cb: (value: string) => void) => {
    if (scanThrows) throw scanThrows;
    onScan = cb;
    return { stop: () => { scannerStopped += 1; } };
  })
}));

const { createDevicePairingController } = await import('../src/app/device-pairing-controller');
const { createPairingSession, pairingUri } = await import('../src/signer/pairing');

function account() {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  const signer: Signer = {
    type: 'local',
    getPublicKey: async () => pubkey,
    signEvent: async (event: UnsignedNostrEvent) => finalizeEvent(event, secret) as never,
    nip44Encrypt: async (peer: string, plaintext: string) => nip44Encrypt(plaintext, getConversationKey(secret, peer)),
    nip44Decrypt: async () => { throw new Error('unused'); }
  };
  return { secret, pubkey, nsec: nip19.nsecEncode(secret), signer };
}

function harness(overrides: Partial<Parameters<typeof createDevicePairingController>[0]> = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root') as HTMLElement;
  const adopted: string[] = [];
  const closed = { count: 0 };
  const acct = account();
  const controller = createDevicePairingController({
    root,
    relayUrl: 'wss://relay.test',
    openModal: (markup) => { root.innerHTML = markup; },
    closeModal: () => { closed.count += 1; },
    getSigner: async () => acct.signer,
    getLocalNsec: async () => acct.nsec,
    adoptTransferredKey: async (nsec) => { adopted.push(nsec); },
    ...overrides
  });
  return { root, controller, adopted, closed, acct };
}

beforeEach(() => {
  published.length = 0;
  waitResult = null;
  waitExpiresNow = false;
  scannerStopped = 0;
  onScan = null;
  scanThrows = null;
});

describe('new device side', () => {
  it('shows a QR that carries no private key', async () => {
    const h = harness();
    h.controller.startNewDevice();
    await vi.waitFor(() => expect(h.root.querySelector('svg')).toBeTruthy());
    expect(h.root.textContent).toContain('Add this device');
    expect(h.root.innerHTML).not.toMatch(/nsec1/);
  });

  it('adopts a valid transfer and names the account that arrived', async () => {
    const h = harness();
    const session = createPairingSession();
    // Drive the real crypto through the controller by pre-building a response the
    // controller's own session will accept.
    const { awaitPairingResponse } = await import('../src/nostr/device-pairing');
    vi.mocked(awaitPairingResponse).mockImplementationOnce(async (_r, pairingId, onCandidate) => {
      const payload = JSON.stringify({
        version: 1, pairingId, challenge: capturedChallenge(h.root), accountPubkey: h.acct.pubkey,
        nsec: h.acct.nsec, issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 120
      });
      const event = {
        ...finalizeEvent({ kind: 20078, created_at: Math.floor(Date.now() / 1000), content: nip44Encrypt(payload, getConversationKey(h.acct.secret, capturedPubkey(h.root))), tags: [] }, h.acct.secret)
      } as unknown as SignedNostrEvent;
      return (await onCandidate(event)) ? event : null;
    });

    h.controller.startNewDevice();
    await vi.waitFor(() => expect(h.adopted).toHaveLength(1));
    expect(h.adopted[0]).toBe(h.acct.nsec);
    await vi.waitFor(() => expect(h.root.textContent).toContain('Signed in'));
    // The npub is the only defence against a consistent attacker key, so it must be shown.
    expect(h.root.textContent).toContain(nip19.npubEncode(h.acct.pubkey).slice(0, 12));
    expect(session.pairingId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('offers a new code when nothing arrives before expiry', async () => {
    waitExpiresNow = true;
    const h = harness();
    h.controller.startNewDevice();
    await vi.waitFor(() => expect(h.root.textContent).toContain('expired'));
    expect(h.root.querySelector('#pairing-restart')).toBeTruthy();
  });
});

describe('trusted device side', () => {
  it('refuses before opening the camera when the account uses an external signer', async () => {
    const h = harness({ getLocalNsec: async () => null });
    h.controller.startScan();
    await vi.waitFor(() => expect(h.root.textContent).toContain('external signer'));
    const { scanQr } = await import('../src/app/qr-scanner');
    expect(scanQr).not.toHaveBeenCalled();
  });

  it('asks before sending, and sends nothing until approval is pressed', async () => {
    const h = harness();
    const session = createPairingSession();
    h.controller.startScan();
    await vi.waitFor(() => expect(onScan).toBeTruthy());

    onScan!(pairingUri(session));
    await vi.waitFor(() => expect(h.root.textContent).toContain('Add another Workstr device?'));
    // The whole point of the screen: nothing has left the device yet.
    expect(published).toHaveLength(0);

    h.root.querySelector<HTMLElement>('#pairing-approve')!.click();
    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0].pairingId).toBe(session.pairingId);
    expect(published[0].ciphertext).not.toContain(h.acct.nsec);
    await vi.waitFor(() => expect(h.root.textContent).toContain('Device added'));
  });

  it('stops the camera as soon as a code is scanned', async () => {
    const h = harness();
    h.controller.startScan();
    await vi.waitFor(() => expect(onScan).toBeTruthy());
    onScan!(pairingUri(createPairingSession()));
    await vi.waitFor(() => expect(scannerStopped).toBeGreaterThan(0));
  });

  it('rejects a QR that is not a Workstr pairing code', async () => {
    const h = harness();
    h.controller.startScan();
    await vi.waitFor(() => expect(onScan).toBeTruthy());
    onScan!('nostrconnect://something-else');
    await vi.waitFor(() => expect(h.root.textContent).toContain('Transfer failed'));
    expect(published).toHaveLength(0);
  });

  it('reports a refused camera instead of failing silently', async () => {
    scanThrows = Object.assign(new Error('Camera access was refused.'), { code: 'denied' });
    const h = harness();
    h.controller.startScan();
    await vi.waitFor(() => expect(h.root.textContent).toContain('Transfer failed'));
  });
});

describe('teardown', () => {
  it('releases the camera when the screen is left by any route', async () => {
    const h = harness();
    h.controller.startScan();
    await vi.waitFor(() => expect(onScan).toBeTruthy());
    h.controller.release();
    expect(scannerStopped).toBeGreaterThan(0);
    // Idempotent: the shell also calls this on every modal close.
    h.controller.release();
  });
});

// The controller keeps its session private, so these read the URI it rendered. That value
// is the QR itself, so reading it is not reaching past the boundary.
const capturedUri = (root: HTMLElement) => {
  const uri = root.querySelector('[data-pairing-uri]')?.getAttribute('data-pairing-uri');
  if (!uri) throw new Error('no pairing QR rendered');
  return uri;
};
const qrParam = (root: HTMLElement, name: string) =>
  new URL(capturedUri(root).replace('workstr://', 'https://')).searchParams.get(name) as string;
const capturedChallenge = (root: HTMLElement) => qrParam(root, 'c');
const capturedPubkey = (root: HTMLElement) => qrParam(root, 'pub');
