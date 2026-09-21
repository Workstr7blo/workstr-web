import {
  fetchPaymentTargetsEvent,
  looksLikeMoneroAddress,
  parseMoneroPaymentTarget,
  publishMoneroPaymentTarget
} from '../nostr/payment-targets';
import type { Signer } from '../signer/types';
import type { AppState } from './state';

// The current user's public NIP-A3 Monero address: reading it from the relays and publishing
// a change to it. It has no screen of its own. The Settings Profile editor shows and edits the
// address alongside the display name and picture, and calls `publish` only when the address is
// what changed; the Tip Jar page reads `state.monero` to say whether tips reach it.
export interface MoneroAddressControllerContext {
  state: AppState;
  getSigner(): Promise<Signer | null>;
  // Every address state change, so the Profile card and the Tip Jar page can follow it.
  onChange?(): void;
}

export type MoneroAddressPublishResult = { ok: true; address: string } | { ok: false; message: string };

const INVALID_ADDRESS = 'That does not look like a Monero address. Mainnet addresses are 95 characters (106 when integrated) and start with 4 or 8.';
const SIGN_IN_FIRST = 'Sign in to publish a public Monero address.';
// A signer that has not been granted this kind waits on a person, and the publish looks
// identical to a relay failure from here, so the one thing worth saying is where to look.
const SIGNER_SILENT = 'Your signer did not answer. Nothing was changed on the relays.';

export function isSignerTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /signer approval timed out|Signer did not respond/i.test(message);
}

// Relay and signer failures arrive as raw remote text, so only the first line is kept and it
// is capped. Nothing secret passes through this path: a payment target is public by
// definition and no key or wallet credential is in scope here.
export function publishFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const line = raw.split('\n')[0].trim();
  if (!line) return 'no reason given';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

export function createMoneroAddressController(ctx: MoneroAddressControllerContext) {
  const { state, getSigner } = ctx;
  let inflight: Promise<void> | null = null;

  function set(next: Partial<AppState['monero']>): void {
    state.monero = { ...state.monero, ...next };
    ctx.onChange?.();
  }

  // Read with tips off as well as on: an address published while tips were on stays public
  // when they are switched off, and the Profile editor is where it is changed or removed.
  // A second caller while a read is running shares it rather than starting another.
  function refresh(): Promise<void> {
    if (inflight) return inflight;
    if (!state.pubkey) { set({ status: 'idle', address: '', event: undefined, message: undefined, messageKind: undefined }); return Promise.resolve(); }
    if (state.monero.status === 'saving') return Promise.resolve();
    const pubkey = state.pubkey;
    set({ status: 'loading', message: undefined, messageKind: undefined });
    inflight = (async () => {
      try {
        const event = await fetchPaymentTargetsEvent(pubkey, state.settings.publicRelays);
        // A namespace switch mid-lookup would otherwise show one account's address to another.
        if (state.pubkey !== pubkey) return;
        set({ status: 'ready', address: parseMoneroPaymentTarget(event) ?? '', event, message: undefined, messageKind: undefined });
      } catch (error) {
        if (state.pubkey !== pubkey) return;
        set({ status: 'error', message: `Could not read your Monero address (${publishFailureReason(error)}).`, messageKind: 'bad' });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  // The first visit to Settings loads the address; after that only Refresh profile asks again.
  function refreshIfNeeded(): void {
    if (!state.pubkey || state.monero.status !== 'idle') return;
    void refresh();
  }

  // An empty address removes only the Monero target; every other `payto` and unknown tag in
  // the event is carried through by the NIP-A3 helper.
  async function publish(address: string): Promise<MoneroAddressPublishResult> {
    if (!state.pubkey) return { ok: false, message: SIGN_IN_FIRST };
    const next = address.trim();
    if (next && !looksLikeMoneroAddress(next)) return { ok: false, message: INVALID_ADDRESS };
    const signer = await getSigner();
    if (!signer) return { ok: false, message: SIGN_IN_FIRST };
    set({ status: 'saving', message: undefined, messageKind: undefined });
    try {
      // `existing` is only passed once a lookup has succeeded; left undefined the helper
      // reads the event itself and fails loudly rather than dropping unrelated targets.
      const result = await publishMoneroPaymentTarget(signer, next, { relays: state.settings.publicRelays, existing: state.monero.event });
      const published = parseMoneroPaymentTarget(result.event) ?? '';
      set({ status: 'ready', address: published, event: result.event });
      return { ok: true, address: published };
    } catch (error) {
      // A failed publish leaves the relays as they were, so the loaded event is still current.
      set({ status: state.monero.event === undefined ? 'error' : 'ready' });
      return { ok: false, message: isSignerTimeout(error) ? SIGNER_SILENT : `Could not publish (${publishFailureReason(error)}).` };
    }
  }

  return { refresh, refreshIfNeeded, publish, repaint: () => ctx.onChange?.() };
}
