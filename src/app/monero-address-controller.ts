import { normalizePaymentMode } from '../core/types';
import {
  fetchPaymentTargetsEvent,
  looksLikeMoneroAddress,
  parseMoneroPaymentTarget,
  publishMoneroPaymentTarget
} from '../nostr/payment-targets';
import { moneroAddressBody, moneroAddressValue, type MoneroAddressState } from '../features/support/payment-mode-views';
import type { Signer } from '../signer/types';
import type { AppState } from './state';

export interface MoneroAddressControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  getSigner(): Promise<Signer | null>;
}

const INVALID_ADDRESS = 'That does not look like a Monero address. Mainnet addresses are 95 characters (106 when integrated) and start with 4 or 8.';
const SIGN_IN_FIRST = 'Sign in with your Nostr signer to publish a public Monero address.';

// Relay and signer failures are worth showing — "which relay refused, and why" is the only
// actionable part — but they arrive as raw remote text, so only the first line is kept and
// it is capped. Nothing secret passes through this path: a payment target is public by
// definition and no key or wallet credential is in scope here.
function reason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const line = raw.split('\n')[0].trim();
  if (!line) return 'no reason given';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

export function createMoneroAddressController(ctx: MoneroAddressControllerContext) {
  const { root, state, toast, getSigner } = ctx;

  function moneroMode(): boolean {
    return normalizePaymentMode(state.settings.paymentMode) === 'monero';
  }

  function set(next: Partial<MoneroAddressState>): void {
    state.monero = { ...state.monero, ...next };
    paint();
  }

  // Repainted in place rather than through the shell render: a full render rebuilds the
  // Settings page and closes the very category the user is reading the result in.
  function paint(): void {
    const host = root.querySelector('#monero-address-section');
    if (!host) return;
    host.innerHTML = moneroAddressBody(state.monero, Boolean(state.pubkey));
    bind();
  }

  async function refresh(): Promise<void> {
    if (!moneroMode()) return;
    if (!state.pubkey) { set({ status: 'idle', address: '', draft: undefined, event: undefined, message: SIGN_IN_FIRST, messageKind: undefined }); return; }
    if (state.monero.status === 'loading' || state.monero.status === 'saving') return;
    const pubkey = state.pubkey;
    set({ status: 'loading', message: 'Reading your payment targets from relays…', messageKind: undefined });
    try {
      const event = await fetchPaymentTargetsEvent(pubkey, state.settings.publicRelays);
      // A namespace switch mid-lookup would otherwise show one account's address to another.
      if (state.pubkey !== pubkey) return;
      set({ status: 'ready', address: parseMoneroPaymentTarget(event) ?? '', draft: undefined, event, message: undefined, messageKind: undefined });
    } catch (error) {
      if (state.pubkey !== pubkey) return;
      set({ status: 'error', message: `Could not read your payment targets (${reason(error)}). Your published address is unchanged — try Refresh from relays.`, messageKind: 'bad' });
    }
  }

  // The first visit to Settings in Monero Mode loads the address; after that only the
  // Refresh button asks the relays again.
  function refreshIfNeeded(): void {
    if (!moneroMode() || !state.pubkey || state.monero.status !== 'idle') return;
    void refresh();
  }

  async function save(): Promise<void> {
    if (!moneroMode()) return;
    if (!state.pubkey) { set({ message: SIGN_IN_FIRST, messageKind: 'bad' }); toast('Sign in to publish a Monero address', 'bad'); return; }
    if (state.monero.status === 'loading' || state.monero.status === 'saving') return;
    const field = root.querySelector<HTMLInputElement>('#monero-address');
    const next = (field?.value ?? moneroAddressValue(state.monero)).trim();
    if (next && !looksLikeMoneroAddress(next)) {
      set({ draft: next, message: INVALID_ADDRESS, messageKind: 'bad' });
      toast('Check the Monero address', 'bad');
      return;
    }
    const signer = await getSigner();
    if (!signer) { set({ draft: next, message: SIGN_IN_FIRST, messageKind: 'bad' }); toast('Sign in to publish a Monero address', 'bad'); return; }
    set({ status: 'saving', draft: next, message: next ? 'Signing and publishing your payment target…' : 'Removing your Monero payment target…', messageKind: undefined });
    try {
      // `existing` is only passed once a lookup has succeeded; left undefined the helper
      // reads the event itself and fails loudly rather than dropping unrelated targets.
      const result = await publishMoneroPaymentTarget(signer, next, {
        relays: state.settings.publicRelays,
        existing: state.monero.event
      });
      const address = parseMoneroPaymentTarget(result.event) ?? '';
      const partial = result.failedRelays.length
        ? ` Accepted by ${result.okRelays.length} of ${result.okRelays.length + result.failedRelays.length} relays.`
        : '';
      set({
        status: 'ready',
        address,
        draft: undefined,
        event: result.event,
        message: `${address ? 'Monero address published.' : 'Monero address removed.'}${partial}`,
        messageKind: 'ok'
      });
      toast(address ? 'Monero address published' : 'Monero address removed');
    } catch (error) {
      set({
        // A failed publish leaves the relays as they were, so the loaded event is still
        // current; only a session that never managed to read one stays unread.
        status: state.monero.event === undefined ? 'error' : 'ready',
        draft: next,
        message: `Could not publish (${reason(error)}). Nothing was changed on the relays — try again.`,
        messageKind: 'bad'
      });
      toast('Could not publish the Monero address', 'bad');
    }
  }

  function bind(): void {
    const field = root.querySelector<HTMLInputElement>('#monero-address');
    // Deliberately no repaint on input: the draft is only mirrored so an unrelated repaint
    // cannot throw away what is being typed.
    field?.addEventListener('input', () => { state.monero = { ...state.monero, draft: field.value }; });
    field?.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void save(); }
    });
    root.querySelector('#monero-address-save')?.addEventListener('click', () => { void save(); });
    root.querySelector('#monero-address-refresh')?.addEventListener('click', () => { void refresh(); });
  }

  return { bind, refresh, refreshIfNeeded, save };
}
