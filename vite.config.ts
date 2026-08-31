import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Release builds get the tag from CI (APP_VERSION). Pages builds off main and
// local builds fall back to `git describe`, which yields e.g. v0.9.0-3-gabc1234
// — enough to tell a deployed build apart from the release it followed.
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync('git describe --tags --always --dirty', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion())
  },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), smoke: resolve(import.meta.dirname, 'smoke.html') }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Vite always allows IP and localhost host headers, so this only needs to
    // cover named hosts. The leading dot matches any Tailscale MagicDNS name.
    allowedHosts: ['.ts.net']
  },
  test: {
    // Pure logic, crypto, IndexedDB and protocol suites do not need a browser DOM.
    // DOM-facing suites opt into jsdom with a file-level environment annotation.
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['node_modules/**', 'dist/**', '.worktrees/**']
  }
});
