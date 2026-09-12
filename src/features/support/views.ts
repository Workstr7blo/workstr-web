import { OPERATOR_MONERO_ADDRESS } from '../../core/funding';
import { looksLikeMoneroAddress } from '../../nostr/payment-targets';
import { moneroQr } from '../../app/monero-mark';
import { html } from '../../app/format';

function supportCard(summary: string, body: string): string {
  return `<details class="settings-category support-panel compact-support support-panel-monero" data-settings-section="support">
    <summary><span class="settings-category-copy"><strong>Support Workstr</strong><small>${html(summary)}</small></span><span class="settings-category-meta">XMR</span></summary>
    <div class="settings-category-body">${body}</div>
  </details>`;
}

// First 12 characters and last 9, the same shape the address is quoted in elsewhere. Only
// ever a display: every control copies, encodes and announces the whole address.
export function shortMoneroAddress(address: string): string {
  return address.length > 24 ? `${address.slice(0, 12)}...${address.slice(-9)}` : address;
}

/**
 * Support Workstr: a code, an address, and a way to copy it.
 *
 * Shown whether or not Monero tips are on, because supporting Workstr is not creator
 * tipping. There is no month, no supporter count and no meter: a Monero transfer leaves no
 * trace Workstr can read, so any figure here would be invented.
 */
export function supportPanel(address: string = OPERATOR_MONERO_ADDRESS): string {
  const target = address.trim();
  if (!looksLikeMoneroAddress(target)) {
    // A QR of a broken address is worse than no QR: it fails in the wallet, after the money.
    return supportCard('Monero support unavailable', `<div class="support-status">
      <strong>Monero support is temporarily unavailable.</strong>
      <small>The configured Workstr Monero address is not valid, so no payment code is shown.</small>
    </div>`);
  }
  // No `tx_amount`: what to send is the supporter's decision, not a number Workstr fills in.
  const uri = `monero:${target}`;
  return supportCard('Private support with Monero', `
    <div class="support-monero">
      <div class="support-monero-qr" role="img" aria-label="QR code for the Workstr Monero address ${html(target)}">${moneroQr(uri)}</div>
      <code class="support-monero-address" aria-hidden="true">${html(shortMoneroAddress(target))}</code>
      <span class="sr-only">Workstr Monero address: ${html(target)}</span>
      <div class="web-empty-actions support-monero-actions">
        <button id="copy-monero-support" class="button payment" type="button" data-copy="${html(target)}" aria-label="Copy the full Workstr Monero address">Copy address</button>
        <a id="open-monero-support" class="button" href="${html(uri)}">Open wallet</a>
      </div>
      <p class="section-help">Scan with a Monero wallet or copy the address.</p>
    </div>`);
}
