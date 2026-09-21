import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The policy is a <meta> tag because GitHub Pages cannot send response headers. What it can
// enforce is still worth enforcing, and what it forbids must stay forbidden as code changes:
// no inline script, no eval, no script from anywhere but this origin.
const INDEX = readFileSync('index.html', 'utf8');

function policy(): Map<string, string[]> {
  const content = INDEX.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  return new Map(content.split(';').map((part) => part.trim().split(/\s+/)).filter((words) => words[0]).map(([name, ...values]) => [name, values]));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) ? [path] : [];
  });
}

describe('the Content Security Policy', () => {
  const csp = policy();

  it('is declared before anything it governs loads', () => {
    const at = INDEX.indexOf('Content-Security-Policy');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(INDEX.indexOf('<link'));
    expect(at).toBeLessThan(INDEX.indexOf('<script'));
  });

  it('runs only this origin\'s scripts, and never eval', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
    // WebAssembly (Monero wallet, QR reader) needs compiling, which is not eval.
    expect(csp.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    const all = [...csp.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(csp.get('script-src')).not.toContain("'unsafe-inline'");
    expect(csp.get('script-src')).not.toContain('https:');
    expect(all).not.toContain('*');
  });

  it('shuts the doors a page like this never uses', () => {
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('worker-src')).toEqual(["'self'", 'blob:']);
  });

  it('reaches the relays, the Workstr Monero node and the photo host, and nothing else by name', () => {
    expect(csp.get('connect-src')).toEqual(["'self'", 'wss:', 'https://xmr.workstr.fit:43736', 'https://nostr.build', 'https://*.nostr.build', 'data:', 'blob:']);
    expect(csp.get('img-src')).toEqual(["'self'", 'https:', 'data:', 'blob:']);
  });

  // `script-src 'self'` blocks inline handlers, so one in a template would fail silently in
  // the browser. Fallbacks for broken images are declared with `data-fallback` instead.
  it('leaves no inline event handler in any template', () => {
    const offenders = sources('src').flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /<[a-z][^>]*\son[a-z]+\s*=\s*["']/i.test(line))
      .map(({ index }) => `${file}:${index + 1}`));
    expect(offenders).toEqual([]);
  });
});
