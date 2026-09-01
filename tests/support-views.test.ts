import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { supportPanel, supportSummary } from '../src/features/support/views';
import { OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../src/core/funding';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';

describe('supportPanel', () => {
  it('renders zap-first support without a plain Lightning donation CTA', () => {
    const markup = supportPanel();
    const npub = nip19.npubEncode(OPERATOR_PUBKEY);

    expect(markup).toContain('>External zap</a>');
    expect(markup).toContain('>Zap with wallet</button>');
    expect(markup).toContain(`href="${OPERATOR_NOSTR_URL}"`);
    expect(markup).toContain('Fund the build. Keep the receipt.');
    expect(markup).toContain(`>${OPERATOR_NOSTR_HANDLE}</strong>`);
    expect(markup).toContain(npub);
    expect(markup).toContain('Copy npub');
    expect(markup).toContain('class="settings-category support-panel compact-support"');
    expect(markup).toContain('Zaps keep support public and receipt-backed');
    expect(markup).toContain('Monthly target 85,000 sats');
    expect(markup).toContain('NIP-57');

    expect(markup).not.toContain('Plain Lightning and on-chain routes are not shown here');
    expect(markup).not.toContain('If support ever arrives');
    expect(markup).not.toContain('Copy Lightning address');
    expect(markup).not.toContain('lightning:');
    expect(markup).not.toContain('Scan with any Lightning wallet');
  });

  it('keeps the transparent zap receipt funding meter', () => {
    const markup = supportPanel({
      status: 'ready',
      receipts: [
        { id: 'one', sats: 1_000, createdAt: 1, senderPubkey: 'a'.repeat(64) },
        { id: 'two', sats: 2_000, createdAt: 2, senderPubkey: 'b'.repeat(64) }
      ]
    });

    expect(markup).toContain('<strong>3,000 sats</strong>');
    expect(markup).toContain('<strong>85,000 sats</strong>');
    expect(markup).toContain('<span>gap / runway</span><strong>-82,000 sats</strong>');
    expect(markup).toContain('The remaining gap is founder-funded');
    expect(markup).toContain('2 zaps from 2 supporters');
  });

  it('does not report zero when zap relays are unreachable', () => {
    const markup = supportPanel({ status: 'offline', receipts: [] });

    expect(markup).toContain('could not reach relays');
    expect(markup).toContain('donations this month unknown');
    expect(markup).not.toContain('received: 0 sats');
  });
});

describe('supportSummary', () => {
  it('derives the compact disclosure summary from receipt state', () => {
    expect(supportSummary()).toBe('Monthly target 85,000 sats');
    expect(supportSummary({ status: 'offline', receipts: [] })).toBe('Receipt check offline');
  });
});
