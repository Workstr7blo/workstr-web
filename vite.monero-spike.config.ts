import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'monero-phase1')
  },
  build: {
    emptyOutDir: true,
    outDir: '.monero-spike-dist',
    rollupOptions: {
      input: { moneroSpike: resolve(import.meta.dirname, 'monero-spike.html') }
    }
  }
});
