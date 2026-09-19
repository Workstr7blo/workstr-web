import type { RelayProgram } from '../../nostr/canon';
import { looksLikeMoneroAddress } from '../../nostr/payment-targets';
import type { AppState } from '../../app/state';
import { displayPubkey, html } from '../../app/format';
import { tipPiggyIcon } from '../../app/piggy-bank';
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

/**
 * The card's Tip: a piggy bank with a plus, and the word Tip.
 *
 * The icon says what the button does - add to this creator's Tip Jar - rather than which rail
 * carries it. A Monero mark here made every card advertise the network, and the reader has
 * already been told once, in Settings, that tips are Monero (#267). Monero branding stays on
 * the surfaces where the payment itself happens: the tip sheet and the receive codes.
 */
export function moneroTipButton(program: RelayProgram, state: AppState): string {
  if (!moneroTipAddress(program, state)) return '';
  return `<button class="button payment small monero-tip-cta" type="button" data-monero-tip="${html(program.address)}" aria-label="Tip ${html(moneroTipCreator(program, state))}">${tipPiggyIcon(18)}<span class="monero-tip-label">Tip</span></button>`;
}

export function moneroTipCreator(program: RelayProgram, state: AppState): string {
  if (!program.pubkey) return 'This creator';
  return state.authorProfiles?.[program.pubkey]?.name || state.profileNames?.[program.pubkey] || displayPubkey(program.pubkey);
}
