import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `avatarFace(className, identity)` stamps whatever class string it is handed, so a class
// with no rule behind it is not a compile error and not a test failure - it is a raw <img>
// at its natural size. A 400px profile picture then overruns its column with the name and
// npub sitting on top of it.
//
// It is also invisible in the test suite and in a sandboxed browser, because with no picture
// `avatarFace` renders the fallback <span> instead, which has no intrinsic size and collapses
// into the space it is given. The bug only appears for someone who has a profile picture.
// This checks the one thing that would have caught it: that every class the code stamps on an
// avatar is a class the stylesheet actually sizes.
const CSS = ['src/workstr-reference.css', 'src/style.css'].map((file) => readFileSync(file, 'utf8')).join('\n');
const SOURCES = ['src/app/account-chip.ts', 'src/app/settings-view.ts'].map((file) => readFileSync(file, 'utf8')).join('\n');

function avatarClasses(): string[] {
  const found = new Set<string>();
  for (const match of SOURCES.matchAll(/avatarFace\(\s*'([^']+)'/g)) found.add(match[1]);
  for (const match of SOURCES.matchAll(/patchAvatar\([^,]+,\s*'([^']+)'/g)) found.add(match[1]);
  return [...found];
}

describe('every avatar class the code stamps', () => {
  it('finds the classes actually in use', () => {
    // A guard on the guard: if the helpers are renamed and this stops matching, the test
    // would pass by finding nothing at all.
    expect(avatarClasses().length).toBeGreaterThanOrEqual(3);
    expect(avatarClasses()).toContain('settings-account-summary-avatar');
  });

  it('has a rule that gives it a size', () => {
    for (const className of avatarClasses()) {
      const rule = CSS.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
      expect(rule, `no CSS rule for .${className}`).toBeTruthy();
      expect(rule?.[1], `.${className} sets no width`).toMatch(/(^|[;{\s])width\s*:/);
      expect(rule?.[1], `.${className} sets no height`).toMatch(/(^|[;{\s])height\s*:/);
    }
  });

  // The fallback letter and the picture share the class, so whatever sizes one sizes both.
  it('hides the fallback when the picture loads', () => {
    for (const className of avatarClasses()) {
      expect(CSS, `.${className}[hidden] has no rule`).toContain(`.${className}[hidden]`);
    }
  });
});
