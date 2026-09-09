import { renderSVG } from 'uqr';
import { nip19 } from 'nostr-tools';
import { MONTHLY_COST_SATS, OPERATOR_MONERO_ADDRESS, OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../../core/funding';
import { OPERATOR_PUBKEY } from '../../nostr/canon';
import { fundingTotals, type ZapReceipt } from '../../nostr/zaps';
import { looksLikeMoneroAddress } from '../../nostr/payment-targets';
import { redactNwcSecrets } from '../../nostr/nwc';
import { moneroBadge } from '../../app/monero-mark';
import { html } from '../../app/format';
import type { NwcViewState } from '../../app/state';

export type FundingStatus = 'idle' | 'loading' | 'ready' | 'offline';

export interface SupportState {
  status: FundingStatus;
  receipts: ZapReceipt[];
  fetchedAt?: number;
}

const sats = (value: number) => value.toLocaleString('en-US');

// Both rails are the same Settings category: same title, same disclosure, same place in the
// Support group. Only the meta pill, the summary line and the body change, so the card
// itself is written once and the rail decides what goes in it.
function supportCard(rail: 'lightning' | 'monero', meta: string, summary: string, body: string): string {
  return `<details class="settings-category support-panel compact-support support-panel-${rail}" data-settings-section="support">
    <summary><span class="settings-category-copy"><strong>Support Workstr</strong><small>${html(summary)}</small></span><span class="settings-category-meta">${html(meta)}</span></summary>
    <div class="settings-category-body">${body}</div>
  </details>`;
}

// Received against the published cost. Both numbers are in sats, so the
// comparison needs no exchange rate and cannot quietly go stale.
//
// The first surface carries the month and nothing else. Everything a reader would have to
// study — the four counts, the target, the zap address — is one disclosure deeper, because
// someone who has decided to support Workstr should not have to read an accounting report
// on the way to the button.
function fundingPanel(state: SupportState): string {
  if (state.status === 'loading') {
    return '<div class="support-meter loading">reading zap receipts from relays...</div>';
  }
  if (state.status === 'offline') {
    // Never render 0 sats on a failed fetch: "nobody donated" and "we could
    // not check" are different claims and only one of them is true.
    return '<div class="support-meter offline">could not reach relays — donations this month unknown</div>';
  }
  if (state.status === 'idle') return '';

  const totals = fundingTotals(state.receipts, MONTHLY_COST_SATS);
  return `
    <div class="support-meter ${totals.sats >= MONTHLY_COST_SATS ? 'covered' : 'under'}">
      <div class="support-meter-head">
        <span>This month</span>
        <strong>${sats(totals.sats)} / ${sats(MONTHLY_COST_SATS)} sats</strong>
      </div>
      <div class="support-track" aria-hidden="true"><span style="width:${totals.percent}%"></span></div>
      <p class="support-meter-note">Verified public receipts</p>
    </div>`;
}

// The month in full, for the reader who opened the details to check the arithmetic.
function transparencyStats(state: SupportState): string {
  if (state.status !== 'ready') {
    return `<div class="support-stats">
      <div><span>monthly target</span><strong>${sats(MONTHLY_COST_SATS)} sats</strong></div>
      <div><span>received</span><strong>${state.status === 'offline' ? 'unknown' : 'not read yet'}</strong></div>
    </div>`;
  }
  const totals = fundingTotals(state.receipts, MONTHLY_COST_SATS);
  const supporters = new Set(state.receipts.map((receipt) => receipt.senderPubkey).filter(Boolean)).size;
  const gap = totals.sats - MONTHLY_COST_SATS;
  return `<div class="support-stats">
      <div><span>monthly target</span><strong>${sats(MONTHLY_COST_SATS)} sats</strong></div>
      <div><span>received</span><strong>${sats(totals.sats)} sats</strong></div>
      <div><span>supporters</span><strong>${supporters}</strong></div>
      <div><span>receipts</span><strong>${totals.count}</strong></div>
      <div><span>gap / runway</span><strong>${gap >= 0 ? '+' : '-'}${sats(Math.abs(gap))} sats</strong></div>
    </div>
    <p class="support-meter-note">${gap >= 0
      ? 'This month is covered. Extra verified zaps become Workstr runway.'
      : 'Verified zaps are under the monthly operating target. The remaining gap is founder-funded.'}</p>`;
}

export function supportSummary(state: SupportState = { status: 'idle', receipts: [] }): string {
  const totals = fundingTotals(state.receipts, MONTHLY_COST_SATS);
  return state.status === 'ready'
    ? `${sats(totals.sats)} / ${sats(MONTHLY_COST_SATS)} sats this month`
    : state.status === 'loading'
      ? 'Reading zap receipts…'
      : state.status === 'offline'
        ? 'Receipt check offline'
        : `Monthly target ${sats(MONTHLY_COST_SATS)} sats`;
}

// Defaults to idle so a caller that has not fetched yet — or a test rendering
// a minimal state — gets the zap target without a funding panel.
export function lightningSupportPanel(state: SupportState = { status: 'idle', receipts: [] }, nwc: NwcViewState = { active: false, status: 'idle' }, signedIn = false): string {
  const npub = nip19.npubEncode(OPERATOR_PUBKEY);
  return supportCard('lightning', 'ZAP', supportSummary(state), `
    <div class="settings-row-main support-summary-row">
      <div>
        <strong>Voluntary support</strong>
        <small>No subscription. Workstr is free either way.</small>
      </div>
      <div class="settings-row-actions">
        <button id="open-nwc-zap" class="button payment" ${nwc.active && signedIn ? '' : 'disabled'}>Zap Workstr</button>
        <a id="open-zap-target" class="button" href="${html(OPERATOR_NOSTR_URL)}" target="_blank" rel="noreferrer">External zap</a>
      </div>
    </div>
    <div class="nwc-support-status ${nwc.active ? 'ok' : ''}">
      <strong>${nwc.active ? 'NWC wallet ready' : signedIn ? 'Connect a zap wallet in Settings for in-app zaps.' : 'Sign in and connect a zap wallet for in-app zaps.'}</strong>
      <small>${html(redactNwcSecrets(nwc.message || (nwc.active ? `${nwc.walletLabel || 'Wallet'} · ${nwc.relayLabel || 'wallet relay'}` : 'The external zap link still works without an in-app wallet.')))}</small>
    </div>
    <div id="support-funding">${fundingPanel(state)}</div>
    <details class="support-transparency">
      <summary><span>View transparency details</span></summary>
      <div class="support-transparency-body">
        <div id="support-transparency-stats">${transparencyStats(state)}</div>
        <div class="support-zap-card">
          <div class="support-zap-copy">
            <span class="card-label">Zap target</span>
            <strong>${html(OPERATOR_NOSTR_HANDLE)}</strong>
            <small>${html(npub)}</small>
          </div>
          <div class="support-receipt-badge">
            <span>verified</span>
            <strong>NIP-57</strong>
          </div>
        </div>
        <div class="settings-row-actions">
          <button id="copy-npub" class="button" data-copy="${html(npub)}">Copy npub</button>
        </div>
        <p class="section-help">The monthly target covers AI credits, development, growth tests, media hosting, the domain, and buffer. Zaps keep support public and receipt-backed.</p>
      </div>
    </details>`);
}

// First 12 characters and last 9, the same shape the address is quoted in elsewhere. Only
// ever a display: every control copies, encodes and announces the whole address.
export function shortMoneroAddress(address: string): string {
  return address.length > 24 ? `${address.slice(0, 12)}...${address.slice(-9)}` : address;
}

/**
 * Support on the Monero rail: a code, an address, and a way to copy it.
 *
 * Deliberately not a mirror of the Lightning card. A Monero transfer leaves no trace Workstr
 * can read, so there is no month, no supporter count and no meter here — inventing one would
 * be inventing the numbers in it.
 */
export function moneroSupportPanel(address: string = OPERATOR_MONERO_ADDRESS): string {
  const target = address.trim();
  if (!looksLikeMoneroAddress(target)) {
    // A QR of a broken address is worse than no QR: it fails in the wallet, after the money.
    return supportCard('monero', 'XMR', 'Monero support unavailable', `<div class="nwc-support-status">
      <strong>Monero support is temporarily unavailable.</strong>
      <small>The configured Workstr Monero address is not valid, so no payment code is shown.</small>
    </div>`);
  }
  // No `tx_amount`: what to send is the supporter's decision, not a number Workstr fills in.
  const uri = `monero:${target}`;
  return supportCard('monero', 'XMR', 'Private support with Monero', `
    <div class="support-monero">
      <div class="support-monero-mark">${moneroBadge(46)}</div>
      <div class="support-monero-qr" role="img" aria-label="QR code for the Workstr Monero address ${html(target)}">${renderSVG(uri, { border: 2 })}</div>
      <code class="support-monero-address" aria-hidden="true">${html(shortMoneroAddress(target))}</code>
      <span class="sr-only">Workstr Monero address: ${html(target)}</span>
      <div class="web-empty-actions support-monero-actions">
        <button id="copy-monero-support" class="button payment" type="button" data-copy="${html(target)}" aria-label="Copy the full Workstr Monero address">Copy address</button>
        <a id="open-monero-support" class="button" href="${html(uri)}">Open wallet</a>
      </div>
      <p class="section-help">Scan with a Monero wallet or copy the address.</p>
    </div>`);
}

/**
 * The Support card for the active rail.
 *
 * Support follows the payment mode rather than explaining why it differs from it: a reader
 * on Monero is shown a Monero address, not a Lightning target and a paragraph about why.
 */
export function supportPanel(state: SupportState = { status: 'idle', receipts: [] }, nwc: NwcViewState = { active: false, status: 'idle' }, signedIn = false, moneroMode = false): string {
  return moneroMode ? moneroSupportPanel() : lightningSupportPanel(state, nwc, signedIn);
}

// Reading the zap receipts is the one background answer that lands on Settings while the
// reader is sitting in it, and it arrives twice - once to say it is reading, once with the
// month. Rendering the page for either closed whichever category was open, which is the
// last thing `src/app/settings-disclosure.ts` existed to paper over. Only the summary line,
// the meter and the transparency counts depend on the funding state, and none of them
// carries a control, so this needs no rebinding.
//
// False when the card is not mounted, which is every view except Settings.
export function updateSupportFunding(root: ParentNode, state: SupportState): boolean {
  const card = root.querySelector('.support-panel');
  if (!card) return false;
  const meter = card.querySelector('#support-funding');
  // Monero mode mounts the same Support category with no Lightning funding surface in it.
  // Nothing to patch, and nothing worth rebuilding the page for either.
  if (!meter) return true;
  const head = card.querySelector(':scope > summary .settings-category-copy small');
  if (head) head.textContent = supportSummary(state);
  meter.innerHTML = fundingPanel(state);
  const stats = card.querySelector('#support-transparency-stats');
  if (stats) stats.innerHTML = transparencyStats(state);
  return true;
}
