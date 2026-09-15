import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
    child.on('error', reject);
  });
}

async function waitForReady(process, timeoutMs = 20_000) {
  let output = '';
  process.stdout.on('data', (chunk) => { output += chunk.toString(); });
  process.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const started = Date.now();
  while (!output.includes('Local:')) {
    if (Date.now() - started > timeoutMs) throw new Error(`vite preview did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await run('npm', ['run', 'build:monero-spike']);

const preview = spawn('npx', ['vite', 'preview', '--outDir', '.monero-spike-dist', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await waitForReady(preview);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:4182/monero-spike.html', { waitUntil: 'networkidle' });
  const report = await page.waitForFunction(() => window.__WORKSTR_MONERO_SPIKE__, null, { timeout: 30_000 }).then((handle) => handle.jsonValue());
  await browser.close();
  const result = { ok: true, report, consoleMessages, pageErrors };
  console.log(JSON.stringify(result, null, 2));
  if (pageErrors.length) process.exitCode = 1;
} finally {
  if (preview.pid) {
    try { process.kill(-preview.pid, 'SIGTERM'); } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
