import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A console is not a safe place for a secret: logs are copied into bug reports, screenshots
// and remote debugging sessions, and a browser keeps them after the page that wrote them. No
// production path logs a seed, key, recovery phrase or wallet object today, and this keeps it
// that way. It reads source rather than running it, so a new log line fails here before it
// can ever run on someone's phone.
//
// It flags a console call whose arguments mention anything secret-shaped, and any console call
// in the modules that hold secrets at all. Tests, scripts and fixtures are not scanned: they
// use these words legitimately.
const SOURCE = 'src';
const CONSOLE_CALL = /console\s*\.\s*(log|debug|info|warn|error|trace|dir|dirxml|table|group|groupCollapsed|assert)\s*\(/g;
const SECRET_WORDS = /seed|mnemonic|recovery|private|secret|spend|viewkey|view_key|nsec|wallet|bundle|payload|password|passphrase|device ?code|\bpin\b|vault|rootkey|root_key/i;
// Modules that handle key material or seeds directly. Any console call in them is suspect,
// whatever it names.
const SECRET_MODULES = [/^src\/security\//, /^src\/signer\//, /^src\/features\/monero\/wallet-/, /^src\/features\/monero\/tip-jar-history\.ts$/, /^src\/nostr\/backup-key\.ts$/, /^src\/app\/monero-(wallet|send)-controller\.ts$/, /^src\/app\/tip-jar-backup-controller\.ts$/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) ? [path.replaceAll('\\', '/')] : [];
  });
}

// The argument list of each console call, balanced over parentheses so a multi-line call is
// read whole.
function consoleCalls(text: string): Array<{ line: number; args: string }> {
  const calls: Array<{ line: number; args: string }> = [];
  for (const match of text.matchAll(CONSOLE_CALL)) {
    let depth = 1;
    let at = match.index! + match[0].length;
    const start = at;
    while (at < text.length && depth > 0) {
      if (text[at] === '(') depth += 1;
      else if (text[at] === ')') depth -= 1;
      at += 1;
    }
    calls.push({ line: text.slice(0, match.index).split('\n').length, args: text.slice(start, at - 1) });
  }
  return calls;
}

describe('production code never logs secrets', () => {
  const files = sources(SOURCE);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('passes nothing secret-shaped to the console', () => {
    const offenders = files.flatMap((file) => consoleCalls(readFileSync(file, 'utf8'))
      .filter((call) => SECRET_WORDS.test(call.args))
      .map((call) => `${file}:${call.line}: console(${call.args.trim().slice(0, 80)})`));
    expect(offenders).toEqual([]);
  });

  it('keeps the console out of the modules that hold keys and seeds', () => {
    const offenders = files
      .filter((file) => SECRET_MODULES.some((pattern) => pattern.test(file)))
      .flatMap((file) => consoleCalls(readFileSync(file, 'utf8')).map((call) => `${file}:${call.line}`));
    expect(offenders).toEqual([]);
  });

  // The check is only worth something if it would have caught the obvious mistakes.
  it('recognises the calls it exists to stop', () => {
    for (const bad of ['console.log(wallet)', 'console.debug(bundle)', 'console.error(error, payload)', 'console.log(`seed: ${seed}`)', 'console.info(\n  nsec\n)']) {
      const [call] = consoleCalls(bad);
      expect(SECRET_WORDS.test(call.args), bad).toBe(true);
    }
    expect(consoleCalls("console.warn('service worker registration failed', error)").every((call) => !SECRET_WORDS.test(call.args))).toBe(true);
  });
});
