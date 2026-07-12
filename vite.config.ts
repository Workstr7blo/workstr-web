import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts']
  }
});
