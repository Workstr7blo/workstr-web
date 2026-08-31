import { execFileSync, spawn } from 'node:child_process';
import { request } from 'node:http';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = 4178;
const baseUrl = `http://${host}:${port}`;

function waitForPreview(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = request(baseUrl, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.end();
    };
    const retry = () => Date.now() >= deadline ? reject(new Error('Vite preview did not become ready')) : setTimeout(attempt, 100);
    attempt();
  });
}

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port), '--strictPort'], { stdio: 'inherit' });
let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const sockets = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto(`${baseUrl}/smoke.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.smokeIsolation === 'ready');
  if (sockets.length) throw new Error(`isolated smoke opened WebSocket transport: ${sockets.join(', ')}`);
  console.log('isolated browser smoke passed: mock signer/publisher booted with no WebSocket transport');
} finally {
  await browser?.close();
  preview.kill();
}