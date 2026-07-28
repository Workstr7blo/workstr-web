import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Vite always allows IP and localhost host headers, so this only needs to
    // cover named hosts. The leading dot matches any Tailscale MagicDNS name.
    allowedHosts: ['.ts.net']
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts']
  }
});
