import { html } from '../../app/format';
import { normalizePaymentMode } from '../../core/types';
import type { AppState } from '../../app/state';
import type { SignedNostrEvent } from '../../signer/types';

// The current user's public NIP-A3 Monero target, as Settings knows it. It is deliberately
// not a stored setting: the address lives in the user's `kind:10133` on public relays, so
// the relays stay the source of truth and nothing about it enters encrypted sync or the
// NWC credential store.
export interface MoneroAddressState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  /** The address currently advertised on relays. Empty string means "publishes none". */
  address: string;
  /** Unsaved field content, kept in state so a rerender cannot discard what was typed. */
  draft?: string;
  message?: string;
  messageKind?: 'ok' | 'bad';
  /**
   * The latest `kind:10133`, or null when the author has none. Left undefined until a
   * lookup actually succeeds: publishing without a confirmed read would overwrite payment
   * targets Workstr does not manage.
   */
  event?: SignedNostrEvent | null;
}

export const EMPTY_ADDRESS_COPY = 'No public Monero address found. Add one to let compatible Nostr clients show a Monero tip button.';

const IDLE: MoneroAddressState = { status: 'idle', address: '' };

export function moneroAddressValue(monero: MoneroAddressState): string {
  return monero.draft ?? monero.address ?? '';
}

function pill(monero: MoneroAddressState, signedIn: boolean): { label: string; ok: boolean } {
  if (!signedIn) return { label: 'LOCAL', ok: false };
  if (monero.status === 'loading') return { label: 'READING', ok: false };
  if (monero.status === 'saving') return { label: 'PUBLISHING', ok: false };
  if (monero.status === 'error') return { label: 'UNREAD', ok: false };
  if (monero.status === 'ready' && monero.address) return { label: 'PUBLISHED', ok: true };
  if (monero.status === 'ready') return { label: 'NOT SET', ok: false };
  return { label: 'IDLE', ok: false };
}

function statusLine(monero: MoneroAddressState): string {
  if (monero.message) {
    return `<p class="monero-address-status ${monero.messageKind === 'bad' ? 'bad' : monero.messageKind === 'ok' ? 'ok' : ''}">${html(monero.message)}</p>`;
  }
  // Only claim there is no address once a relay has actually answered. Before that the
  // honest statement is that Workstr has not looked yet.
  if (monero.status === 'ready' && !monero.address) return `<p class="monero-address-status">${EMPTY_ADDRESS_COPY}</p>`;
  return '';
}

/**
 * The body of the Monero address section, so the controller can repaint it in place.
 *
 * A full shell render would collapse the Settings category the section lives in, which is
 * exactly the card the user is reading a publish result in.
 */
export function moneroAddressBody(monero: MoneroAddressState = IDLE, signedIn = false): string {
  const badge = pill(monero, signedIn);
  const heading = `<div class="settings-inline-heading">
      <span><strong>Monero payment address</strong><small>Published as a public Nostr payment target using NIP-A3 kind:10133.</small></span>
      <span class="status-pill ${badge.ok ? 'ok' : ''}">${badge.label}</span>
    </div>`;
  if (!signedIn) {
    return `${heading}
    <p class="section-help">Sign in with your Nostr signer to publish a public Monero address. Workstr never holds Monero keys or funds.</p>`;
  }
  const busy = monero.status === 'loading' || monero.status === 'saving';
  const value = moneroAddressValue(monero);
  const clearing = !value.trim() && Boolean(monero.address);
  return `${heading}
    <input id="monero-address" class="monero-address-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
      aria-label="Monero payment address" placeholder="Monero address starting with 8 or 4" value="${html(value)}" ${busy ? 'disabled' : ''} />
    ${statusLine(monero)}
    <p class="section-help">Use a fresh Monero subaddress. This address is public and replicated across relays. It is not stored in Workstr sync.</p>
    <div class="settings-row-actions">
      <button id="monero-address-save" class="button payment" ${busy ? 'disabled' : ''}>${clearing ? 'Remove address' : 'Save address'}</button>
      <button id="monero-address-refresh" class="button ghost" ${busy ? 'disabled' : ''}>Refresh from relays</button>
    </div>`;
}

export function moneroAddressSection(monero: MoneroAddressState = IDLE, signedIn = false): string {
  return `<div class="settings-inline-section monero-address-section" id="monero-address-section">${moneroAddressBody(monero, signedIn)}</div>`;
}

// Which rail carries creator support. Presented as a choice rather than an on/off switch,
// because that is what it is — the app is on Lightning or on Monero, never on "neither".
// Marks are `₿` (U+20BF) and `ɱ` (U+0271), the Bitcoin and Monero symbols. Real typographic
// characters rather than icon assets, so the pair stays symmetric and needs nothing vendored;
// #132 brings official Monero artwork in for the Tip CTA, where it carries more weight.
//
// Picking Monero also swaps what the rest of Settings offers: the NWC wallet card is
// replaced by the public payment address below, since a Monero target is published to
// relays rather than connected to a wallet.
export function paymentModeCard(state: AppState): string {
  const monero = normalizePaymentMode(state.settings.paymentMode) === 'monero';
  const rail = (value: 'lightning' | 'monero', mark: string, label: string, hint: string) => {
    const on = (value === 'monero') === monero;
    return `<label class="payment-rail-option${on ? ' selected' : ''}">
      <input type="radio" name="payment-mode" value="${value}" ${on ? 'checked' : ''} />
      <span class="payment-rail-mark" aria-hidden="true">${mark}</span>
      <span class="payment-rail-copy"><strong>${label}</strong><small>${hint}</small></span>
    </label>`;
  };
  return `<details class="settings-category payment-mode-card"${monero ? ' open' : ''}>
    <summary><span class="settings-category-copy"><strong>Monero Mode</strong><small>${monero ? 'Monero tips' : 'Lightning zaps'}</small></span><span class="status-pill ${monero ? 'ok' : ''}">${monero ? 'MONERO' : 'LIGHTNING'}</span></summary>
    <div class="settings-category-body">
      <p class="section-help">Switch creator support from Lightning zaps to public Monero payment targets. Workouts and programs stay the same.</p>
      <div class="payment-rail" role="radiogroup" aria-label="Creator support">
        ${rail('lightning', '₿', 'Lightning zaps', 'Default. Zap creators over NWC.')}
        ${rail('monero', 'ɱ', 'Monero tips', 'Tip creators at their public Monero address.')}
      </div>
      ${monero ? moneroAddressSection(state.monero, Boolean(state.pubkey)) : ''}
    </div>
  </details>`;
}
