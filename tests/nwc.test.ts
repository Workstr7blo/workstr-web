import { describe, expect, it } from 'vitest';
import {
  NwcError,
  logSafeNwcConnection,
  maskNwcConnectionString,
  parseNwcConnectionString,
  parseNwcConnectionStringResult,
  redactNwcSecrets,
  redactNwcUri
} from '../src/nostr/nwc';

const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const VALID = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}`;

describe('parseNwcConnectionString', () => {
  it('parses a valid connection string', () => {
    const connection = parseNwcConnectionString(VALID);
    expect(connection.walletPubkey).toBe(WALLET_PUBKEY);
    expect(connection.secret).toBe(SECRET);
    expect(connection.relays).toEqual(['wss://relay.example.com']);
  });

  it('collects multiple relay params, optional lud16, and future expiry', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const uri = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Fa.example.com&relay=wss%3A%2F%2Fb.example.com&secret=${SECRET}&lud16=user%40wallet.com&expires_at=${expiresAt}`;
    const connection = parseNwcConnectionString(uri);
    expect(connection.relays).toEqual(['wss://a.example.com', 'wss://b.example.com']);
    expect(connection.lud16).toBe('user@wallet.com');
    expect(connection.expiresAt).toBe(expiresAt);
  });

  it('rejects empty input with the invalid-format taxonomy', () => {
    expect(() => parseNwcConnectionString('  ')).toThrowError(NwcError);
    expect(errorOf('  ').code).toBe('invalid_format');
    expect(errorOf('  ').kind).toBe('invalid_format');
  });

  it('rejects a Lightning address pasted into the field', () => {
    expect(errorOf('user@wallet.com').code).toBe('invalid_format');
  });

  it('rejects non-NWC schemes', () => {
    expect(errorOf(`https://${WALLET_PUBKEY}?secret=${SECRET}&relay=wss://r.example.com`).code).toBe('invalid_format');
  });

  it('rejects a bad wallet pubkey', () => {
    expect(errorOf(`nostr+walletconnect://nothex?secret=${SECRET}&relay=wss://r.example.com`).code).toBe('invalid_format');
  });

  it('rejects a missing secret', () => {
    expect(errorOf(`nostr+walletconnect://${WALLET_PUBKEY}?relay=wss://r.example.com`).code).toBe('invalid_format');
  });

  it('rejects a malformed secret', () => {
    expect(errorOf(`nostr+walletconnect://${WALLET_PUBKEY}?relay=wss://r.example.com&secret=xyz`).code).toBe('invalid_format');
  });

  it('rejects a string with no relay', () => {
    expect(errorOf(`nostr+walletconnect://${WALLET_PUBKEY}?secret=${SECRET}`).code).toBe('invalid_format');
  });

  it('rejects non-websocket relays', () => {
    expect(errorOf(`nostr+walletconnect://${WALLET_PUBKEY}?secret=${SECRET}&relay=https://relay.example.com`).code).toBe('invalid_format');
  });

  it('rejects expired connection strings distinctly when expiry is detectable', () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    const error = errorOf(`${VALID}&expires_at=${expired}`);
    expect(error.code).toBe('expired_connection');
    expect(error.kind).toBe('expired_connection');
  });

  it('returns a typed parse result instead of throwing when requested', () => {
    const valid = parseNwcConnectionStringResult(VALID);
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.walletPubkey).toBe(WALLET_PUBKEY);

    const invalid = parseNwcConnectionStringResult('not an nwc string');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.kind).toBe('invalid_format');
  });

  function errorOf(input: string): NwcError {
    try {
      parseNwcConnectionString(input);
    } catch (error) {
      expect(error).toBeInstanceOf(NwcError);
      return error as NwcError;
    }
    throw new Error('expected parse to throw');
  }
});

describe('NWC error taxonomy', () => {
  it('distinguishes required top-level failure kinds', () => {
    expect(new NwcError('invalid_format', 'bad uri').kind).toBe('invalid_format');
    expect(new NwcError('expired_connection', 'expired').kind).toBe('expired_connection');
    expect(new NwcError('rejected_unauthorized', 'denied').kind).toBe('rejected_unauthorized');
    expect(new NwcError('unreachable_service', 'offline').kind).toBe('unreachable_service');
    expect(new NwcError('timeout', 'slow wallet').kind).toBe('unreachable_service');
    expect(new NwcError('payment_failure', 'failed').kind).toBe('payment_failure');
    expect(new NwcError('unknown_failure', 'unknown').kind).toBe('unknown_failure');
  });

  it('redacts secrets from thrown error messages and JSON payloads', () => {
    const error = new NwcError('payment_failure', `wallet echoed ${VALID} and token=super-secret`);
    const serialized = JSON.stringify(error);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain('super-secret');
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('NWC redaction helpers', () => {
  it('shows only the pubkey prefix and relay host, never the secret', () => {
    const masked = maskNwcConnectionString(parseNwcConnectionString(VALID));
    expect(masked).toContain(WALLET_PUBKEY.slice(0, 8));
    expect(masked).not.toContain(WALLET_PUBKEY);
    expect(masked).not.toContain(SECRET);
    expect(masked).not.toContain('secret=');
    expect(masked).toContain('relay.example.com');
  });

  it('redacts NWC URI secret params without exposing raw tokens', () => {
    const redacted = redactNwcUri(`${VALID}&token=abc123`);
    expect(redacted).toContain('secret=[REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain('abc123');
  });

  it('redacts embedded NWC strings, nsecs, tokens, and hex keys from arbitrary text', () => {
    const rawHexKey = 'f'.repeat(64);
    const redacted = redactNwcSecrets(`pay with ${VALID} token=abc nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq ${rawHexKey}`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain(rawHexKey);
    expect(redacted).not.toContain('nsec1qqqq');
    expect(redacted).not.toContain('token=abc');
    expect(redacted).toContain('[REDACTED]');
  });

  it('returns a log-safe connection object with the secret removed', () => {
    const safe = logSafeNwcConnection(parseNwcConnectionString(VALID));
    expect(safe.secret).toBe('[REDACTED]');
    expect(JSON.stringify(safe)).not.toContain(SECRET);
    expect(safe.walletPubkey).toBe(WALLET_PUBKEY);
  });
});
