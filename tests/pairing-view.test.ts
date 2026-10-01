import { describe, expect, it } from 'vitest';
import { approvalMarkup, errorMarkup, qrMarkup, successMarkup } from '../src/features/identity/pairing-view';

describe('pairing screens', () => {
  it('opens each screen with an icon head naming the flow', () => {
    const qr = qrMarkup('workstr://pair?v=1', 300);
    expect(qr).toContain('class="account-flow-head info"');
    expect(qr).toContain('data-icon="qr-code"');
    expect(qr).toContain('Device pairing');
    expect(qr).toContain('This code expires in 5 minutes.');
  });

  it('tones the approval as a warning, since approving copies the key', () => {
    const markup = approvalMarkup();
    expect(markup).toContain('class="account-flow-head warn"');
    expect(markup).toContain('Nobody from Workstr will ever ask you to scan a code.');
    expect(markup).toContain('id="pairing-approve"');
  });

  it('keeps the account name and the warning to check it on success', () => {
    const markup = successMarkup('npub1abcdefghijklmnopqrstuvwxyz0123456789');
    expect(markup).toContain('recovery-key-box');
    expect(markup).toContain('Check this matches the account on your other device.');
  });

  it('escapes the failure message and announces it', () => {
    const markup = errorMarkup('<b>relay</b>');
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('<b>relay</b>');
    expect(markup).toContain('relay');
  });
});
