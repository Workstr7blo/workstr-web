import { renderSVG } from 'uqr';
import { nip19 } from 'nostr-tools';
import { MONTHLY_COST_SATS, OPERATOR_LUD16 } from '../../core/funding';
import { OPERATOR_PUBKEY } from '../../nostr/canon';
import { fundingTotals, lightningUri, type ZapReceipt } from '../../nostr/zaps';
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
    return '<div class="terminal-mini">reading zap receipts from relays...</div>';
  }
  if (state.status === 'offline') {
    // Never render 0 sats on a failed fetch: "nobody donated" and "we could
    // not check" are different claims and only one of them is true.
    return '<div class="terminal-mini">could not reach relays — donations this month unknown</div>';
  }
  if (state.status === 'idle') return '';

  const totals = fundingTotals(state.receipts, MONTHLY_COST_SATS);
  const supporters = new Set(state.receipts.map((receipt) => receipt.senderPubkey).filter(Boolean)).size;
  const detail = totals.count
    ? `${totals.count} zap${totals.count === 1 ? '' : 's'}${supporters ? ` from ${supporters} supporter${supporters === 1 ? '' : 's'}` : ''}`
    : 'no zaps yet this month';
  return `
    <div class="dist">
      <div class="dist-row">
        <span>This month</span>
        <span class="track"><span class="fill" style="width:${totals.percent}%"></span></span>
        <small>${totals.percent}%</small>
      </div>
    </div>
    <div class="terminal-mini">received: ${sats(totals.sats)} sats\nmonthly cost: ${sats(MONTHLY_COST_SATS)} sats\n${detail}</div>`;
}

// Defaults to idle so a caller that has not fetched yet — or a test rendering
// a minimal state — gets the address and QR without a funding panel.
export function supportPanel(state: SupportState = { status: 'idle', receipts: [] }): string {
  const npub = nip19.npubEncode(OPERATOR_PUBKEY);
  return `<div class="panel">
    <div class="panel-head"><span>Support Workstr</span></div>
    <p class="section-help">Workstr is free and stays free. It runs on donations rather than
    subscriptions: ${sats(MONTHLY_COST_SATS)} sats a month covers the relay, backups and the domain.
    What comes in is shown below, read straight from public zap receipts — no analytics, no account.</p>
    <div class="signer-qr">${renderSVG(lightningUri(OPERATOR_LUD16), { border: 2 })}</div>
    <div class="terminal-mini">${html(OPERATOR_LUD16)}</div>
    <div class="web-empty-actions">
      <button id="copy-lightning" class="button primary" data-copy="${html(OPERATOR_LUD16)}">Copy Lightning address</button>
      <button id="copy-npub" class="button ghost" data-copy="${html(npub)}">Copy npub to zap</button>
    </div>
    <p class="section-help">Scan with any Lightning wallet, or zap the npub from your Nostr client —
    both reach the same wallet, and only zaps show up in the total below.</p>
    ${fundingPanel(state)}
  </div>`;
}
