import { describe, expect, it } from 'vitest';
import { renderSVG } from 'uqr';
import { nip19 } from 'nostr-tools';
import { lightningSupportPanel, moneroSupportPanel, shortMoneroAddress, supportPanel, supportSummary } from '../src/features/support/views';
import { MONTHLY_COST_SATS, OPERATOR_MONERO_ADDRESS, OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../src/core/funding';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';
import { looksLikeMoneroAddress } from '../src/nostr/payment-targets';

const receipts = [
  { id: 'one', sats: 1_000, createdAt: 1, senderPubkey: 'a'.repeat(64) },
  { id: 'two', sats: 2_000, createdAt: 2, senderPubkey: 'b'.repeat(64) }
];

describe('the Lightning support card', () => {
  it('leads with the zap action and the month, not with the accounting', () => {
    const markup = lightningSupportPanel();
    const primary = markup.slice(0, markup.indexOf('<details class="support-transparency"'));

    expect(primary).toContain('>Zap Workstr</button>');
    expect(primary).toContain('>External zap</a>');
    expect(primary).toContain(`href="${OPERATOR_NOSTR_URL}"`);
    expect(primary).toContain('Voluntary support');
    expect(markup).toContain('class="settings-category support-panel compact-support support-panel-lightning"');
    expect(markup).toContain('Monthly target 85,000 sats');

    // The fundraising pitch and every technical detail moved one level deeper.
    expect(primary).not.toContain('Fund the build. Keep the receipt.');
    expect(primary).not.toContain(`>${OPERATOR_NOSTR_HANDLE}</strong>`);
    expect(primary).not.toContain('Copy npub');
    expect(primary).not.toContain('NIP-57');
    expect(primary).not.toContain('AI credits');
  });

  it('keeps the transparent zap receipt facts inside the transparency disclosure', () => {
    const markup = lightningSupportPanel({ status: 'ready', receipts });
    const details = markup.slice(markup.indexOf('<details class="support-transparency"'));
    const npub = nip19.npubEncode(OPERATOR_PUBKEY);

    expect(markup).toContain('View transparency details');
    expect(markup).toContain('<strong>3,000 / 85,000 sats</strong>');
    expect(markup).toContain('Verified public receipts');
    expect(details).toContain('<span>monthly target</span><strong>85,000 sats</strong>');
    expect(details).toContain('<span>received</span><strong>3,000 sats</strong>');
    expect(details).toContain('<span>supporters</span><strong>2</strong>');
    expect(details).toContain('<span>receipts</span><strong>2</strong>');
    expect(details).toContain('<span>gap / runway</span><strong>-82,000 sats</strong>');
    expect(details).toContain('The remaining gap is founder-funded');
    expect(details).toContain(`>${OPERATOR_NOSTR_HANDLE}</strong>`);
    expect(details).toContain(npub);
    expect(details).toContain('Copy npub');
    expect(details).toContain('NIP-57');
  });

  it('does not report zero when zap relays are unreachable', () => {
    const markup = lightningSupportPanel({ status: 'offline', receipts: [] });

    expect(markup).toContain('could not reach relays');
    expect(markup).toContain('donations this month unknown');
    expect(markup).not.toContain('<strong>0 / 85,000 sats</strong>');
  });

  it('carries no Monero surface', () => {
    const markup = lightningSupportPanel({ status: 'ready', receipts }, { active: true, status: 'idle' }, true);

    expect(markup).not.toContain(OPERATOR_MONERO_ADDRESS);
    expect(markup).not.toContain('monero:');
    expect(markup).not.toContain('Copy address');
  });
});

describe('the Monero support card', () => {
  const markup = moneroSupportPanel();

  it('is the same category with a payment code in place of the funding meter', () => {
    expect(markup).toContain('class="settings-category support-panel compact-support support-panel-monero"');
    expect(markup).toContain('<strong>Support Workstr</strong>');
    expect(markup).toContain('Private support with Monero');
    expect(markup).toContain('Scan with a Monero wallet or copy the address.');
  });

  it('encodes the canonical address as an amount-free monero: URI', () => {
    expect(looksLikeMoneroAddress(OPERATOR_MONERO_ADDRESS)).toBe(true);
    expect(markup).toContain(renderSVG(`monero:${OPERATOR_MONERO_ADDRESS}`, { border: 2 }));
    expect(markup).toContain(`href="monero:${OPERATOR_MONERO_ADDRESS}"`);
    expect(markup).not.toContain('tx_amount');
  });

  it('shortens the address on screen but copies and announces all of it', () => {
    expect(markup).toContain(`>${shortMoneroAddress(OPERATOR_MONERO_ADDRESS)}</code>`);
    expect(shortMoneroAddress(OPERATOR_MONERO_ADDRESS)).toBe('43SH87nCju4L...ecLid3rQq');
    expect(markup).toContain(`data-copy="${OPERATOR_MONERO_ADDRESS}"`);
    expect(markup).toContain(`<span class="sr-only">Workstr Monero address: ${OPERATOR_MONERO_ADDRESS}</span>`);
    expect(markup).toContain(`aria-label="QR code for the Workstr Monero address ${OPERATOR_MONERO_ADDRESS}"`);
  });

  it('shows no Lightning controls and no explanation of why the rails differ', () => {
    expect(markup).not.toContain('open-nwc-zap');
    expect(markup).not.toContain('Zap Workstr');
    expect(markup).not.toContain('External zap');
    expect(markup).not.toContain('Copy npub');
    expect(markup).not.toContain('Creator support is on Monero');
    expect(markup).not.toContain('still a Nostr zap address');
    // No invented Monero accounting: a transfer leaves nothing Workstr could count.
    expect(markup).not.toContain('support-track');
    expect(markup).not.toContain('sats');
    expect(markup).not.toContain('NIP-57');
  });

  it('says so rather than drawing a broken code when the address is not usable', () => {
    const broken = moneroSupportPanel('not-an-address');

    expect(broken).toContain('Monero support is temporarily unavailable.');
    expect(broken).not.toContain('monero:');
    expect(broken).not.toContain('<svg');
    expect(broken).not.toContain('Copy address');
  });
});

describe('supportPanel', () => {
  it('follows the active payment mode', () => {
    expect(supportPanel({ status: 'idle', receipts: [] }, { active: false, status: 'idle' }, true, false)).toBe(lightningSupportPanel({ status: 'idle', receipts: [] }, { active: false, status: 'idle' }, true));
    expect(supportPanel({ status: 'idle', receipts: [] }, { active: true, status: 'idle' }, true, true)).toBe(moneroSupportPanel());
  });
});

describe('supportSummary', () => {
  it('derives the compact disclosure summary from receipt state', () => {
    expect(supportSummary()).toBe(`Monthly target ${MONTHLY_COST_SATS.toLocaleString('en-US')} sats`);
    expect(supportSummary({ status: 'offline', receipts: [] })).toBe('Receipt check offline');
    expect(supportSummary({ status: 'ready', receipts })).toBe('3,000 / 85,000 sats this month');
  });
});
