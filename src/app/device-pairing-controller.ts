// Orchestrates QR device pairing. Depends on the crypto, transport, camera and view
// modules; reimplements none of them.
//
// Both halves live here because they are one feature with one lifecycle: whichever side
// the person is on, cancelling, expiry and success all have to release the same things -
// the camera, the relay subscription, and the ephemeral key.
import { nip19 } from 'nostr-tools';
import {
  createPairingSession,
  destroyPairingSession,
  openTransfer,
  PairingError,
  pairingUri,
  parsePairingUri,
  sealTransfer,
  type PairingRequest,
  type PairingSession
} from '../signer/pairing';
import { awaitPairingResponse, publishPairingResponse } from '../nostr/device-pairing';
import { scanQr, ScannerError, type ScannerHandle } from './qr-scanner';
import {
  approvalMarkup,
  errorMarkup,
  expiredMarkup,
  externalSignerMarkup,
  qrMarkup,
  scannerMarkup,
  sendingMarkup,
  sentMarkup,
  successMarkup,
  waitingMarkup
} from '../features/identity/pairing-view';
import type { Signer } from '../signer/types';

export interface DevicePairingContext {
  root: HTMLElement;
  relayUrl: string;
  openModal(markup: string): void;
  closeModal(): void;
  /** The signer for the account being transferred, or null when signed out. */
  getSigner(): Promise<Signer | null>;
  /** The nsec this device holds, or null for an external signer that Workstr cannot copy. */
  getLocalNsec(): Promise<string | null>;
  /** Hands a received key to the existing local sign-in path. */
  adoptTransferredKey(nsec: string): Promise<void>;
}

export function createDevicePairingController(ctx: DevicePairingContext) {
  const { root, relayUrl, openModal, closeModal, getSigner, getLocalNsec, adoptTransferredKey } = ctx;

  // One teardown for every exit: cancel, expiry, success, error, and leaving the screen.
  // Anything that acquires a resource registers it here rather than remembering to undo
  // itself, because the path that gets forgotten is always the unhappy one.
  let session: PairingSession | null = null;
  let scanner: ScannerHandle | null = null;
  let abort: AbortController | null = null;

  function release(): void {
    scanner?.stop();
    scanner = null;
    abort?.abort();
    abort = null;
    if (session) { destroyPairingSession(session); session = null; }
  }

  function bindCancel(): void {
    root.querySelector('#pairing-cancel')?.addEventListener('click', () => { release(); closeModal(); });
    root.querySelector('#pairing-done')?.addEventListener('click', () => { release(); closeModal(); });
  }

  function show(markup: string): void {
    openModal(markup);
    bindCancel();
  }

  function fail(error: unknown): void {
    release();
    const message = error instanceof PairingError || error instanceof ScannerError
      ? error.message
      : 'Something went wrong. Try again.';
    show(errorMarkup(message));
    root.querySelector('#pairing-restart')?.addEventListener('click', () => { void startNewDevice(); });
  }

  // New device: show a code and wait for the answer.
  async function startNewDevice(): Promise<void> {
    release();
    const current = createPairingSession();
    session = current;
    show(qrMarkup(pairingUri(current), current.expiresAt - Math.floor(Date.now() / 1000)));

    abort = new AbortController();
    try {
      const event = await awaitPairingResponse(relayUrl, current.pairingId, (candidate) => {
        try {
          // Several responses can match the envelope - anyone may publish against a
          // pairing id scraped off the open relay. A forged one fails here and the wait
          // continues rather than ending in an error.
          openTransfer(current, candidate.content, candidate.pubkey);
          return true;
        } catch {
          return false;
        }
      }, { signal: abort.signal });

      // Cancelled, or nothing arrived before the code expired.
      if (!event) {
        if (!session) return;
        release();
        show(expiredMarkup());
        root.querySelector('#pairing-restart')?.addEventListener('click', () => { void startNewDevice(); });
        return;
      }

      const payload = openTransfer(current, event.content, event.pubkey);
      // Single use: the key is consumed and the session destroyed before the account is
      // adopted, so a duplicate response has nothing left to act on.
      release();
      show(sendingMarkup());
      await adoptTransferredKey(payload.nsec);
      show(successMarkup(nip19.npubEncode(payload.accountPubkey)));
    } catch (error) {
      fail(error);
    }
  }

  // Trusted device: scan a code, ask, then send.
  async function startScan(): Promise<void> {
    release();
    // Refused before the camera opens, not after: an external signer can never complete
    // this, and asking for the camera first would be a prompt for nothing.
    const nsec = await getLocalNsec().catch(() => null);
    if (!nsec) { show(externalSignerMarkup()); return; }

    show(scannerMarkup());
    const video = root.querySelector<HTMLVideoElement>('#pairing-video');
    if (!video) { fail(new Error('missing video element')); return; }

    try {
      scanner = await scanQr(video, (value) => { void onScanned(value, nsec); });
    } catch (error) {
      fail(error);
    }
  }

  async function onScanned(value: string, nsec: string): Promise<void> {
    scanner?.stop();
    scanner = null;
    let request: PairingRequest;
    try {
      request = parsePairingUri(value);
    } catch (error) {
      fail(error);
      return;
    }

    // Nothing has left this device yet. The key moves only when the button below is
    // pressed, which is the whole point of the screen.
    show(approvalMarkup());
    root.querySelector('#pairing-approve')?.addEventListener('click', () => { void approve(request, nsec); });
  }

  async function approve(request: PairingRequest, nsec: string): Promise<void> {
    show(sendingMarkup());
    try {
      const signer = await getSigner();
      if (!signer) throw new PairingError('rejected', 'Sign in again before adding a device.');
      const accountPubkey = await signer.getPublicKey();
      const ciphertext = await sealTransfer(signer, request, nsec, accountPubkey);
      await publishPairingResponse(signer, relayUrl, request.pairingId, ciphertext, request.expiresAt);
      show(sentMarkup());
    } catch (error) {
      fail(error);
    }
  }

  return {
    startNewDevice: () => { void startNewDevice(); },
    startScan: () => { void startScan(); },
    /** Called when the modal closes by any route, so the camera never outlives the screen. */
    release
  };
}
