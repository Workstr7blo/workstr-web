import { nip19 } from 'nostr-tools';
import { MONTHLY_COST_SATS, OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../../core/funding';
import { OPERATOR_PUBKEY } from '../../nostr/canon';
import { fundingTotals, type ZapReceipt } from '../../nostr/zaps';
import { html } from '../../app/format';

export type FundingStatus = 'idle' | 'loading' | 'ready' | 'offline';

export interface SupportState {
  status: FundingStatus;
  receipts: ZapReceipt[];
  fetchedAt?: number;
}

const sats = (value: number) => value.toLocaleString('en-US');

// Received against the published cost. Both numbers are in sats, so the
// comparison needs no exchange rate and cannot quietly go stale.
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
  const supporters = new Set(state.receipts.map((receipt) => receipt.senderPubkey).filter(Boolean)).size;
  const detail = totals.count
    ? `${totals.count} zap${totals.count === 1 ? '' : 's'}${supporters ? ` from ${supporters} supporter${supporters === 1 ? '' : 's'}` : ''}`
    : 'no zaps yet this month';
  return `
    <div class="support-meter">
      <div class="support-meter-head">
        <span>This month</span>
        <strong>${totals.percent}%</strong>
      </div>
      <div class="support-track" aria-hidden="true"><span style="width:${totals.percent}%"></span></div>
      <div class="support-stats">
        <div><span>received</span><strong>${sats(totals.sats)} sats</strong></div>
        <div><span>monthly cost</span><strong>${sats(MONTHLY_COST_SATS)} sats</strong></div>
        <div><span>receipts</span><strong>${html(detail)}</strong></div>
      </div>
    </div>`;
}

// Defaults to idle so a caller that has not fetched yet — or a test rendering
// a minimal state — gets the zap target without a funding panel.
export function supportPanel(state: SupportState = { status: 'idle', receipts: [] }): string {
  const npub = nip19.npubEncode(OPERATOR_PUBKEY);
  return `<div class="panel support-panel">
    <div class="support-hero-row">
      <div class="support-bolt" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M13.6 2 4.8 13.2h6.4L9.9 22l8.9-12.2h-6.2L13.6 2Z" fill="currentColor"/></svg></div>
      <div>
        <div class="panel-head"><span>Support Workstr</span><strong>zap receipts</strong></div>
        <h3>Fund the build. Keep the receipt.</h3>
        <p class="section-help">Workstr is free and stays free. Donations cover the relay, backups and domain:
        ${sats(MONTHLY_COST_SATS)} sats a month. Zaps keep support public and receipt-backed.</p>
      </div>
    </div>
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
    <div class="web-empty-actions support-actions">
      <a id="open-zap-target" class="button primary" href="${html(OPERATOR_NOSTR_URL)}" target="_blank" rel="noreferrer">Zap on Nostr</a>
      <button id="copy-npub" class="button ghost" data-copy="${html(npub)}">Copy npub</button>
    </div>
    <p class="section-help support-note">The only donation path is a Nostr zap. Every counted donation is transparently
    accounted for through verified NIP-57 zap receipts in the meter below.</p>
    ${fundingPanel(state)}
  </div>`;
}
