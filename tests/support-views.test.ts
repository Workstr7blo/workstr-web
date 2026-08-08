import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { supportPanel } from '../src/features/support/views';
import { OPERATOR_NOSTR_HANDLE, OPERATOR_NOSTR_URL } from '../src/core/funding';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';

describe('supportPanel', () => {
  it('renders zap-first support without a plain Lightning donation CTA', () => {
    const markup = supportPanel();
    const npub = nip19.npubEncode(OPERATOR_PUBKEY);

    expect(markup).toContain('Zap Workstr on Nostr');
    expect(markup).toContain(`href="${OPERATOR_NOSTR_URL}"`);
    expect(markup).toContain(`zap target: ${OPERATOR_NOSTR_HANDLE}`);
    expect(markup).toContain(npub);
    expect(markup).toContain('Copy npub');
    expect(markup).toContain('Support is zap-based');
    expect(markup).toContain('verified NIP-57 kind:9735 only');

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

    expect(markup).toContain('received: 3,000 sats');
    expect(markup).toContain('monthly cost: 50,000 sats');
    expect(markup).toContain('2 zaps from 2 supporters');
  });

  it('does not report zero when zap relays are unreachable', () => {
    const markup = supportPanel({ status: 'offline', receipts: [] });

    expect(markup).toContain('could not reach relays');
    expect(markup).toContain('donations this month unknown');
    expect(markup).not.toContain('received: 0 sats');
  });
});
