// monero-ts decides whether it runs in a browser by compiling two functions from strings, in
// `GenUtils.isBrowser`, and `LibraryUtils` calls that while the module is still being imported.
// Workstr's Content Security Policy forbids compiling strings (no 'unsafe-eval'), so the import
// itself throws and no Tip Jar wallet can be created. Allowing eval for the whole app to suit
// one environment check is the wrong trade, so the check is rewritten, at build time, as the
// same test written as code.
//
// The match is exact on purpose. If a monero-ts upgrade changes these lines the build fails
// here instead of shipping a wallet that cannot load - see "Dependency and build integrity"
// in docs/security-model.md.
const GEN_UTILS = /monero-ts[\\/]dist[\\/]src[\\/]main[\\/]ts[\\/]common[\\/]GenUtils\.js$/;

const ORIGINAL = [
  'let isBrowserMain = new Function("try {return this===window;}catch(e){return false;}")();',
  'let isJsDom = isBrowserMain ? new Function("try {return window.navigator.userAgent.includes(\'jsdom\');}catch(e){return false;}")() : false;'
];

const REPLACEMENT = [
  'let isBrowserMain = typeof window !== "undefined" && globalThis === window;',
  'let isJsDom = isBrowserMain ? String(window.navigator && window.navigator.userAgent || "").includes("jsdom") : false;'
];

export function isMoneroGenUtils(id) {
  return GEN_UTILS.test(id.split('?')[0]);
}

export function patchMoneroGenUtils(code) {
  let patched = code;
  ORIGINAL.forEach((line, index) => {
    if (!patched.includes(line)) throw new Error(`monero-ts GenUtils.isBrowser has changed; update scripts/monero-ts-csp.mjs (missing: ${line})`);
    patched = patched.replace(line, REPLACEMENT[index]);
  });
  return patched;
}

// The Vite build and dev transforms. `bundler` leaves out the Vite-only `enforce` key for the
// Rolldown pass that pre-bundles dependencies in dev.
export function moneroTsCspPlugin({ bundler = false } = {}) {
  return {
    name: 'workstr-monero-ts-csp',
    ...(bundler ? {} : { enforce: 'pre' }),
    transform(code, id) {
      return isMoneroGenUtils(id) ? { code: patchMoneroGenUtils(code), map: null } : null;
    }
  };
}
