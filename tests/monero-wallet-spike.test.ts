import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONERO_NODE, MOCK_STAGENET_NODE, moneroRpcUrl, normalizeMoneroNodeConfig, probeMoneroDaemon } from '../src/features/monero/wallet-node';
import { createMockStagenetWallet, MONERO_WALLET_SCOPE, storeMockWalletInVault } from '../src/features/monero/mock-stagenet-wallet';
import { runMoneroPhase1Probe } from '../src/features/monero/phase1-report';

function response(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
}

describe('Monero node phase 1 config', () => {
  it('resolves the default Workstr node exactly as issue 246 specifies', () => {
    expect(DEFAULT_MONERO_NODE).toEqual({ mode: 'workstr', host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' });
    expect(moneroRpcUrl(DEFAULT_MONERO_NODE)).toBe('https://xmr.workstr.fit:43736/json_rpc');
  });

  it('normalizes custom and mock stagenet configs', () => {
    expect(normalizeMoneroNodeConfig({ mode: 'custom', host: ' node.example ', port: 38081, ssl: false, network: 'stagenet' })).toEqual({
      mode: 'custom', host: 'node.example', port: 38081, ssl: false, network: 'stagenet'
    });
    expect(normalizeMoneroNodeConfig({ mode: 'mock-stagenet' })).toEqual(MOCK_STAGENET_NODE);
  });

  it('rejects obviously invalid node settings before they become active', () => {
    expect(() => normalizeMoneroNodeConfig({ mode: 'custom', host: '', port: 18081, ssl: true, network: 'mainnet' })).toThrow(/host/);
    expect(() => normalizeMoneroNodeConfig({ mode: 'custom', host: 'node.example', port: 99999, ssl: true, network: 'mainnet' })).toThrow(/port/);
  });

  it('maps daemon get_info to status and rejects the wrong network', async () => {
    const fetcher = vi.fn(async () => response({ result: { nettype: 'stagenet', height: 123, synchronized: true, restricted: true } }));
    const status = await probeMoneroDaemon(DEFAULT_MONERO_NODE, fetcher as unknown as typeof fetch);
    expect(status.ok).toBe(false);
    expect(status.network).toBe('stagenet');
    expect(status.message).toContain('expected mainnet');
  });

  it('recognizes browser fetch failures as probable CORS/transport blockers', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const status = await probeMoneroDaemon(DEFAULT_MONERO_NODE, fetcher as unknown as typeof fetch);
    expect(status.ok).toBe(false);
    expect(status.corsOk).toBe(false);
  });
});

describe('Monero mock stagenet wallet spike', () => {
  it('creates independent stagenet wallet material and metadata without using Nostr keys', () => {
    const wallet = createMockStagenetWallet(2_700_001, new Date('2026-09-15T00:00:00Z'));
    expect(wallet.network).toBe('stagenet');
    expect(wallet.metadata.restoreHeight).toBe(2_700_001);
    expect(wallet.metadata.creatorSubaddress).not.toBe(wallet.metadata.primaryAddress);
    expect(wallet.seed).toContain('stagenet-mock-seed');
    expect(JSON.stringify(wallet)).not.toContain('nsec');
  });

  it('stores the mock wallet only through the device vault Monero scope', async () => {
    const writes: Record<string, string> = {};
    const vault = {
      isUnlocked: () => true,
      putSecret: async (scope: string, plaintext: string) => { writes[scope] = plaintext; },
      getSecret: async (scope: string) => writes[scope]
    };
    const wallet = createMockStagenetWallet();
    const metadata = await storeMockWalletInVault(vault, wallet);
    expect(Object.keys(writes)).toEqual([MONERO_WALLET_SCOPE]);
    expect(metadata.creatorSubaddress).toBe(wallet.metadata.creatorSubaddress);
  });

  it('does not write wallet secrets when the vault is locked', async () => {
    const vault = { isUnlocked: () => false, putSecret: vi.fn(), getSecret: vi.fn() };
    await expect(storeMockWalletInVault(vault)).rejects.toThrow(/Unlock Workstr/);
    expect(vault.putSecret).not.toHaveBeenCalled();
  });

  it('reports browser transport blockers and next-step solution', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const report = await runMoneroPhase1Probe(fetcher as unknown as typeof fetch);
    expect(report.conclusion).toBe('pass-with-blockers');
    expect(report.blockers.join('\n')).toContain('CORS');
    expect(report.nextStep).toContain('RPC bridge');
  });
});
