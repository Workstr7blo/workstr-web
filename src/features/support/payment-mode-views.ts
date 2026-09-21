import { html } from '../../app/format';
import { normalizePaymentMode } from '../../core/types';
import type { AppState } from '../../app/state';
import type { SignedNostrEvent } from '../../signer/types';

// The current user's public NIP-A3 Monero target, as the Profile card knows it. It is
// deliberately not a stored setting: the address lives in the user's `kind:10133` on public relays, so
// the relays stay the source of truth and nothing about it enters encrypted sync.
export interface MoneroAddressState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  /** The address currently advertised on relays. Empty string means "publishes none". */
  address: string;
  message?: string;
  messageKind?: 'ok' | 'bad';
  /**
   * The latest `kind:10133`, or null when the author has none. Left undefined until a
   * lookup actually succeeds: publishing without a confirmed read would overwrite payment
   * targets Workstr does not manage.
   */
  event?: SignedNostrEvent | null;
}

// Tip Jar is a switch rather than a choice between rails: Monero is the only rail, and off is
// a real state. On shows a Tip button on creators' programs and runs the Tip Jar wallet.
// The user-facing name is Tip Jar; code keeps the `monero`/`paymentMode` names underneath.
//
// The public Monero address is not here. It is part of the reader's Profile, and it outlives
// the switch in both directions: turning tips off does not unpublish it, and turning them on
// does not publish or replace one.
const TIPS_HELP = 'Send and receive tips in Workstr.';

export function moneroTipsOn(state: AppState): boolean {
  return normalizePaymentMode(state.settings.paymentMode) === 'monero';
}

export function moneroTipsCard(state: AppState): string {
  const on = moneroTipsOn(state);
  return `<section class="settings-category monero-tips-card" data-settings-section="monero-tips">
    <div class="monero-tips-row">
      <span class="settings-category-copy"><strong id="monero-tips-label">Tip Jar</strong><small id="monero-tips-copy">${html(TIPS_HELP)}</small></span>
      <input type="checkbox" role="switch" id="monero-tips-toggle" class="settings-toggle" aria-labelledby="monero-tips-label" aria-describedby="monero-tips-copy"${on ? ' checked' : ''} />
    </div>
  </section>`;
}
