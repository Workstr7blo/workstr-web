# Browser-compatible Monero RPC bridge

Issue #246 phase 1 found that `https://xmr.workstr.fit:43736/json_rpc` answers daemon RPC
from curl, but Chromium blocks browser access from the Workstr PWA because the preflight/RPC
responses do not include CORS headers.

The wallet UI should not proceed until one browser-compatible transport is available.

## Preferred fix: CORS at the Workstr Monero endpoint

Keep the daemon restricted, TLS-protected, and public-key/seed-blind. Terminate HTTPS in a
reverse proxy and forward only the restricted daemon RPC methods needed for wallet sync and
transaction relay.

Minimal Caddy-style shape:

```caddyfile
xmr.workstr.fit:43736 {
  tls you@example.com

  @preflight method OPTIONS
  handle @preflight {
    header Access-Control-Allow-Origin "https://app.workstr.fit"
    header Access-Control-Allow-Methods "POST, OPTIONS"
    header Access-Control-Allow-Headers "content-type"
    header Access-Control-Max-Age "600"
    respond "" 204
  }

  handle /json_rpc {
    header Access-Control-Allow-Origin "https://app.workstr.fit"
    header Access-Control-Allow-Methods "POST, OPTIONS"
    header Access-Control-Allow-Headers "content-type"
    reverse_proxy 127.0.0.1:18081
  }
}
```

For local phase-1 testing, temporarily allow the preview origin too:

```text
http://127.0.0.1:4182
```

Do not use `*` once wallet functionality exists. Wallet RPC metadata is sensitive enough that
Workstr should be explicit about which app origins can use this infrastructure.

## Alternative: same-origin RPC bridge

If Workstr moves off pure GitHub Pages or gets an edge worker, expose a same-origin path such
as:

```text
https://app.workstr.fit/monero-rpc/json_rpc
```

That removes cross-origin browser friction but adds an application-operated relay point. The
bridge must remain non-custodial and must never receive wallet seed, private spend key,
private view key, PIN, or decrypted vault contents.

## Retest after the fix

Rerun:

```bash
npm run spike:monero:browser
```

The expected blocker should disappear:

```text
Access-Control-Allow-Origin missing / Failed to fetch
```

Then proceed to a real stagenet wallet create/open/sync test before any production wallet UI.
