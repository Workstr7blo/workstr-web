import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { isMoneroGenUtils, moneroTsCspPlugin, patchMoneroGenUtils } from '../scripts/monero-ts-csp.mjs';

// The pinned monero-ts, read from disk: the build patch has to match the code actually shipped.
const require = createRequire(import.meta.url);
const GEN_UTILS = require.resolve('monero-ts/dist/src/main/ts/common/GenUtils.js');
const SOURCE = readFileSync(GEN_UTILS, 'utf8');

function isBrowserBody(code: string): string {
  const start = code.indexOf('static isBrowser()');
  return code.slice(start, code.indexOf('\n  }', start));
}

describe('the monero-ts CSP build patch', () => {
  it('finds the string-compiled browser check in the pinned monero-ts', () => {
    expect(isBrowserBody(SOURCE)).toContain('new Function(');
  });

  it('rewrites it without compiling a string, and touches nothing else', () => {
    const patched = patchMoneroGenUtils(SOURCE);
    expect(isBrowserBody(patched)).not.toMatch(/new Function\(|eval\(/);
    expect(patched.replace(isBrowserBody(patched), '')).toBe(SOURCE.replace(isBrowserBody(SOURCE), ''));
  });

  it('gives the answers the original gives', () => {
    const body = isBrowserBody(patchMoneroGenUtils(SOURCE)).replace('static isBrowser()', 'return (function isBrowser()') + '\n  })()';
    const run = (scope: Record<string, unknown>) => new Function('globalThis', 'window', 'importScripts', body)(scope, scope.window, scope.importScripts) as boolean;
    const page: Record<string, unknown> = { navigator: { userAgent: 'Mozilla/5.0 (iPhone)' } };
    page.window = page;
    expect(run(page)).toBe(true);
    const jsdom: Record<string, unknown> = { navigator: { userAgent: 'Mozilla/5.0 jsdom/24' } };
    jsdom.window = jsdom;
    expect(run(jsdom)).toBe(false);
    expect(run({ importScripts: () => undefined })).toBe(true);
    expect(run({})).toBe(false);
  });

  it('applies to GenUtils only, and fails the build if an upgrade moved the code', () => {
    const plugin = moneroTsCspPlugin();
    expect(plugin.transform('let x = 1;', '/app/src/main.ts')).toBeNull();
    expect(isMoneroGenUtils(GEN_UTILS)).toBe(true);
    expect(plugin.transform(SOURCE, GEN_UTILS)?.code).not.toContain('new Function("try {return this===window');
    expect(() => patchMoneroGenUtils('static isBrowser() { return true; }')).toThrow('GenUtils.isBrowser has changed');
  });
});
