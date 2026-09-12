import { describe, expect, it } from 'vitest';
import { containsSecretMaterial, redactSecrets } from '../src/nostr/secret-redaction';

const HEX = 'b'.repeat(64);
const URI = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Fwallet.example.test&secret=${HEX}`;

describe('secret redaction', () => {
  it('removes the secret from a wallet connection string', () => {
    const redacted = redactSecrets(`connect with ${URI}`);
    expect(redacted).not.toContain(HEX);
    expect(redacted).toContain('secret=[REDACTED]');
  });

  it('removes nsecs, secret parameters and bare 64-hex keys', () => {
    expect(redactSecrets(`key nsec1${'q'.repeat(58)}`)).toBe('key nsec1[REDACTED]');
    expect(redactSecrets('token=abc123 next')).toBe('token=[REDACTED] next');
    expect(redactSecrets(`hex ${HEX}`)).toBe('hex [REDACTED_HEX]');
  });

  it('leaves ordinary program text alone', () => {
    const text = 'Bench 3x8 at 60kg, rest 90s. Notes on workstr.fit';
    expect(redactSecrets(text)).toBe(text);
    expect(containsSecretMaterial(text)).toBe(false);
  });

  // A connection string with its secret already mangled is still not something to publish.
  it('flags any mention of a wallet connection, secret or not', () => {
    expect(containsSecretMaterial('paste your walletconnect string here')).toBe(true);
    expect(containsSecretMaterial(URI)).toBe(true);
  });
});
