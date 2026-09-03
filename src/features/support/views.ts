import { nip19 } from 'nostr-tools';
import { MONTHLY_COST_SATS, OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../../core/funding';
import { OPERATOR_PUBKEY } from '../../nostr/canon';
import { fundingTotals, type ZapReceipt } from '../../nostr/zaps';
import { redactNwcSecrets } from '../../nostr/nwc';
import { html } from '../../app/format';
import type { NwcViewState } from '../../app/state';

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
  const rawPercent = MONTHLY_COST_SATS > 0 ? Math.round((totals.sats / MONTHLY_COST_SATS) * 100) : 0;
  const gap = totals.sats - MONTHLY_COST_SATS;
  const isCovered = gap >= 0;
  const detail = totals.count
    ? `${totals.count} zap${totals.count === 1 ? '' : 's'}${supporters ? ` from ${supporters} supporter${supporters === 1 ? '' : 's'}` : ''}`
    : 'no zaps yet this month';
  return `
    <div class="support-meter ${isCovered ? 'covered' : 'under'}">
      <div class="support-meter-head">
        <span>This month</span>
        <strong>${rawPercent}%</strong>
      </div>
      <div class="support-track" aria-hidden="true"><span style="width:${totals.percent}%"></span></div>
      <div class="support-stats">
        <div><span>received</span><strong>${sats(totals.sats)} sats</strong></div>
        <div><span>monthly target</span><strong>${sats(MONTHLY_COST_SATS)} sats</strong></div>
        <div><span>gap / runway</span><strong>${gap >= 0 ? '+' : '-'}${sats(Math.abs(gap))} sats</strong></div>
        <div><span>receipts</span><strong>${html(detail)}</strong></div>
      </div>
      <p class="support-meter-note">${isCovered
        ? 'This month is covered. Extra verified zaps become Workstr runway.'
        : 'Verified zaps are under the monthly operating target. The remaining gap is founder-funded.'}</p>
    </div>`;
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
//
// `moneroMode` drops the in-app NWC controls only. The operator's zap target, the receipt
// history and the funding meter are public NIP-57 facts about how Workstr is funded, and
// they stay readable on either rail; what disappears is every control that would have the
// user connect or spend from a Lightning wallet.
export function supportPanel(state: SupportState = { status: 'idle', receipts: [] }, nwc: NwcViewState = { active: false, status: 'idle' }, signedIn = false, moneroMode = false): string {
  const npub = nip19.npubEncode(OPERATOR_PUBKEY);
  const summary = supportSummary(state);
  return `<details class="settings-category support-panel compact-support">
    <summary><span class="settings-category-copy"><strong>Support Workstr</strong><small>${html(summary)}</small></span><span class="settings-category-meta">ZAP</span></summary>
    <div class="settings-category-body">
    <div class="settings-row-main support-summary-row">
      <div>
        <strong>Fund the build. Keep the receipt.</strong>
        <small>${html(summary)}</small>
      </div>
      <div class="settings-row-actions">
        ${moneroMode ? '' : `<button id="open-nwc-zap" class="button primary" ${nwc.active && signedIn ? '' : 'disabled'}>Zap with wallet</button>`}
        <a id="open-zap-target" class="button ghost" href="${html(OPERATOR_NOSTR_URL)}" target="_blank" rel="noreferrer">External zap</a>
        <button id="copy-npub" class="button ghost" data-copy="${html(npub)}">Copy npub</button>
      </div>
    </div>
    ${moneroMode ? `<div class="nwc-support-status">
      <strong>Creator support is on Monero.</strong>
      <small>Workstr's own support target is still a Nostr zap address. Use the external zap link above, or switch back to Lightning zaps in Monero Mode for in-app zaps.</small>
    </div>` : `<div class="nwc-support-status ${nwc.active ? 'ok' : ''}">
      <strong>${nwc.active ? 'NWC wallet ready' : signedIn ? 'Connect a zap wallet in Settings for in-app zaps.' : 'Sign in and connect a zap wallet for in-app zaps.'}</strong>
      <small>${html(redactNwcSecrets(nwc.message || (nwc.active ? `${nwc.walletLabel || 'Wallet'} · ${nwc.relayLabel || 'wallet relay'}` : 'The external zap link still works without an in-app wallet.')))}</small>
    </div>`}
    <div class="support-details">
      <p class="section-help">Workstr is free and stays free. The monthly target covers AI credits, development, growth tests, media hosting, the domain, and buffer. Zaps keep support public and receipt-backed.</p>
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
      ${fundingPanel(state)}
    </div>
    </div>
  </details>`;
}
