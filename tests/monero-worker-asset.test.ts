import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Monero worker asset', () => {
  it('ships the monero-ts worker expected by proxyToWorker wallet creation', async () => {
    const worker = await readFile('public/monero.worker.js', 'utf8');
    const license = await readFile('public/monero.worker.js.LICENSE.txt', 'utf8');

    expect(worker).toContain('self.createWalletFull');
    expect(worker).toContain('self.createSubaddress');
    expect(worker).toContain('For license information please see monero.worker.js.LICENSE.txt');
    expect(license.length).toBeGreaterThan(100);
  });
});
