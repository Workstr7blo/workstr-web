import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { shortMoneroAddress, supportPanel } from '../src/features/support/views';
import { OPERATOR_MONERO_ADDRESS } from '../src/core/funding';
import { looksLikeMoneroAddress } from '../src/nostr/payment-targets';
import { moneroQr } from '../src/app/monero-mark';

describe('the Support Workstr card', () => {
  const markup = supportPanel();

  it('is a Settings category with a payment code where a funding meter would be', () => {
    expect(markup).toContain('class="settings-category support-panel compact-support support-panel-monero"');
    expect(markup).toContain('<strong>Support Workstr</strong>');
    expect(markup).toContain('Private support with Monero');
    expect(markup).toContain('Scan with a Monero wallet or copy the address.');
  });

  it('encodes the canonical address as an amount-free monero: URI', () => {
    expect(looksLikeMoneroAddress(OPERATOR_MONERO_ADDRESS)).toBe(true);
    expect(markup).toContain(moneroQr(`monero:${OPERATOR_MONERO_ADDRESS}`));
    expect(markup).toContain(`href="monero:${OPERATOR_MONERO_ADDRESS}"`);
    expect(markup).not.toContain('tx_amount');
  });

  it('draws the mark inside the code, on a plate small enough for level H to survive', () => {
    const uri = `monero:${OPERATOR_MONERO_ADDRESS}`;
    const code = moneroQr(uri);

    // Level H, because the centre is covered. A lower level here would still render and
    // would still look right, and would fail in a camera after the money.
    const size = encode(uri, { ecc: 'H', border: 2 }).size;
    expect(code).toContain(`viewBox="0 0 ${size * 10} ${size * 10}"`);

    const plate = code.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" rx="\d+" fill="white"\/>/);
    expect(plate).not.toBeNull();
    const [, x, y, width, height] = plate!.map(Number);
    const codeSize = size * 10;
    expect(width).toBe(height);
    expect(width / codeSize).toBeLessThanOrEqual(0.22);
    // centred, so the knockout stays away from the three finder patterns
    expect(x).toBe(Math.round((codeSize - width) / 2));
    expect(y).toBe(x);
    // painted from the payment token: `currentColor` would inherit the page text colour
    // and disappear against the white plate
    expect(code).toContain('fill="var(--payment-accent)"');
  });

  it('no longer repeats the mark above the code', () => {
    expect(markup).not.toContain('support-monero-mark');
  });

  it('shortens the address on screen but copies and announces all of it', () => {
    expect(markup).toContain(`>${shortMoneroAddress(OPERATOR_MONERO_ADDRESS)}</code>`);
    expect(shortMoneroAddress(OPERATOR_MONERO_ADDRESS)).toBe('43SH87nCju4L...ecLid3rQq');
    expect(markup).toContain(`data-copy="${OPERATOR_MONERO_ADDRESS}"`);
    expect(markup).toContain(`<span class="sr-only">Workstr Monero address: ${OPERATOR_MONERO_ADDRESS}</span>`);
    expect(markup).toContain(`aria-label="QR code for the Workstr Monero address ${OPERATOR_MONERO_ADDRESS}"`);
  });

  // #218 removed Lightning. Nothing of its card survives, and nothing is invented in its
  // place: a Monero transfer leaves nothing Workstr could count.
  it('carries nothing from the retired Lightning card', () => {
    for (const gone of ['open-nwc-zap', 'Zap Workstr', 'External zap', 'Copy npub', 'NIP-57', 'sats', 'support-track', 'monthly target', 'Lightning']) {
      expect(markup).not.toContain(gone);
    }
  });

  it('says so rather than drawing a broken code when the address is not usable', () => {
    const broken = supportPanel('not-an-address');

    expect(broken).toContain('Monero support is temporarily unavailable.');
    expect(broken).toContain('class="support-status"');
    expect(broken).not.toContain('monero:');
    expect(broken).not.toContain('<svg');
    expect(broken).not.toContain('Copy address');
  });
});
