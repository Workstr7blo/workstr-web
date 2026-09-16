import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monero worker asset', () => {
  it('ships the monero-ts worker expected by proxyToWorker wallet creation', async () => {
    const worker = await readFile('public/monero.worker.js', 'utf8');
    const license = await readFile('public/monero.worker.js.LICENSE.txt', 'utf8');

    expect(worker).toContain('self.createWalletFull');
    expect(worker).toContain('self.createSubaddress');
    expect(worker).toContain('self.openWalletData');
    expect(worker).toContain('For license information please see monero.worker.js.LICENSE.txt');
    expect(license.length).toBeGreaterThan(100);
  });

  // The worker is a copied file, so an upgraded package would otherwise run its main thread
  // against the old worker. Copy node_modules/monero-ts/dist/monero.worker.js when this fails.
  it('is the exact worker of the installed monero-ts version', async () => {
    const [shipped, installed, pkg] = await Promise.all([
      readFile('public/monero.worker.js'),
      readFile('node_modules/monero-ts/dist/monero.worker.js'),
      readFile('package.json', 'utf8')
    ]);
    expect(shipped.equals(installed)).toBe(true);
    expect(JSON.parse(pkg).devDependencies['monero-ts']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
