import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function appVersion(): string {
  return process.env.APP_VERSION ?? 'browser-smoke';
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion())
  },
  build: {
    emptyOutDir: true,
    outDir: '.smoke-dist',
    rollupOptions: {
      input: { smoke: resolve(import.meta.dirname, 'smoke.html') }
    }
  }
});