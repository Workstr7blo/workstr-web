import { renderSVG } from 'uqr';
import type { RelayProgram } from '../../nostr/canon';
import { looksLikeMoneroAddress } from '../../nostr/payment-targets';
import type { AppState } from '../../app/state';
import { displayPubkey, html } from '../../app/format';
import { moneroBadge } from '../../app/monero-mark';
import { normalizePaymentMode } from '../../core/types';

export function moneroMode(state: AppState): boolean {
  return normalizePaymentMode(state.settings.paymentMode) === 'monero';
}

/**
 * The program author's public Monero address, or an empty string.
 *
 * Empty covers three different situations on purpose — no author, no lookup yet, and an
 * author who publishes no target — because the card does the same thing in all three:
 * shows nothing. A disabled "no address" control would put a stranger's payment setup on
 * screen as if it were a Workstr problem.
 */
export function moneroTipAddress(program: RelayProgram, state: AppState): string {
  const address = program.pubkey ? state.authorPaymentTargets?.[program.pubkey] : null;
  return address && looksLikeMoneroAddress(address) ? address : '';
}

export function moneroTipButton(program: RelayProgram, state: AppState): string {
  if (!moneroTipAddress(program, state)) return '';
  return `<button class="button payment small monero-tip-cta" type="button" data-monero-tip="${html(program.address)}" aria-label="Tip ${html(moneroTipCreator(program, state))} with Monero">${moneroBadge(18)}<span class="monero-tip-label">Tip</span></button>`;
}

export interface MoneroTipDetails {
  address: string;
  creator: string;
  programName: string;
}

/**
 * The hand-off, for when the Tip Jar cannot send (off, not set up, or still syncing): creator,
 * address, QR and the two actions. No amount, total or status: a transfer from another wallet
 * leaves no trace Workstr can read. It hands over an address and gets out of the way.
 */
export function moneroTipModal(details: MoneroTipDetails): string {
  const address = details.address.trim();
  const uri = `monero:${address}`;
  return `<div class="monero-tip">
    <div class="monero-tip-mark">${moneroBadge(54)}</div>
    <div class="page-title">Tip with Monero</div>
    <p class="section-help monero-tip-creator">${html(details.creator)}${details.programName ? ` · ${html(details.programName)}` : ''}</p>
    <div class="monero-tip-qr">${renderSVG(uri, { border: 2 })}</div>
    <code class="monero-tip-address" id="monero-tip-address">${html(address)}</code>
    <div class="web-empty-actions monero-tip-actions">
      <button id="monero-tip-copy" class="button payment" type="button">Copy address</button>
      <a id="monero-tip-open" class="button" href="${html(uri)}">Open wallet</a>
    </div>
    <p class="section-help">Paid from your own wallet straight to the creator. Workstr does not see a payment made this way and records nothing about it.</p>
  </div>`;
}

export function moneroTipCreator(program: RelayProgram, state: AppState): string {
  if (!program.pubkey) return 'This creator';
  return state.authorProfiles?.[program.pubkey]?.name || state.profileNames?.[program.pubkey] || displayPubkey(program.pubkey);
}
