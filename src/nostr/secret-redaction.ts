// Secret material that must never reach a public event or a message on screen: Nostr Wallet
// Connect strings, secret-looking query parameters, nsecs and bare 64-hex keys. Workstr no
// longer connects a wallet, but a creator can still paste a connection string into a program
// they are about to publish, and a relay can still echo one back inside an error.

const SECRET_QUERY_KEYS = new Set(['secret', 'token', 'privatekey', 'private_key', 'nsec']);
const HEX_SECRET_RE = /\b[0-9a-f]{64}\b/gi;
const NSEC_RE = /nsec1[02-9ac-hj-np-z]+/gi;
const SECRET_PARAM_RE = /(^|[?&\s])((?:secret|token|private_?key|nsec)=)[^&\s<>'"]+/gi;

export function redactSecrets(value: string): string {
  const withoutUris = value.replace(/nostr\+walletconnect:\/\/[^\s<>'"]+/gi, (match) => redactWalletConnectUri(match));
  return redactBareSecrets(withoutUris);
}

// A string that names a wallet connection at all is refused, not only one `redactSecrets`
// would change: a connection string with its secret mangled is still not something to publish.
export function containsSecretMaterial(value: string): boolean {
  return /walletconnect/i.test(value) || redactSecrets(value) !== value;
}

function redactWalletConnectUri(input: string): string {
  const value = String(input).trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'nostr+walletconnect:') return redactBareSecrets(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString().replace(/%5BREDACTED%5D/g, '[REDACTED]');
  } catch {
    return redactBareSecrets(value);
  }
}

function redactBareSecrets(value: string): string {
  return value
    .replace(SECRET_PARAM_RE, '$1$2[REDACTED]')
    .replace(NSEC_RE, 'nsec1[REDACTED]')
    .replace(HEX_SECRET_RE, '[REDACTED_HEX]');
}
