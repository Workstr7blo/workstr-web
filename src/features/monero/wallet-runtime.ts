import { moneroRpcUrl, normalizeMoneroNodeConfig, probeMoneroDaemon } from './wallet-node';
import type { MoneroNetwork, MoneroNodeConfig, MoneroWalletRuntime, MoneroWalletRuntimeWallet } from './types';

export async function loadMoneroTsRuntime(): Promise<MoneroWalletRuntime> {
  const module = await import('monero-ts') as Record<string, unknown>;
  const createWalletFull = module.createWalletFull;
  if (typeof createWalletFull !== 'function') throw new Error('monero-ts createWalletFull is unavailable.');
  return {
    async createWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet> {
      const wallet = await createWalletFull(config) as MoneroWalletRuntimeWallet;
      return wallet;
    }
  };
}

export async function moneroWalletConfig(input: {
  node?: Partial<MoneroNodeConfig> | null;
  seed?: string;
  restoreHeight?: number;
  fetcher?: typeof fetch;
} = {}): Promise<{ config: Record<string, unknown>; node: MoneroNodeConfig; restoreHeight: number }> {
  const node = normalizeMoneroNodeConfig(input.node);
  const status = await probeMoneroDaemon(node, input.fetcher ?? fetch);
  if (!status.ok) throw new Error(`Monero node is not ready: ${status.message}`);
  if (status.network && status.network !== node.network) throw new Error(`Monero node returned ${status.network}, expected ${node.network}.`);
  const restoreHeight = input.restoreHeight ?? status.height ?? 0;
  if (!Number.isInteger(restoreHeight) || restoreHeight < 0) throw new Error('Monero restore height must be a non-negative integer.');
  const config: Record<string, unknown> = {
    password: '',
    networkType: node.network,
    server: moneroRpcUrl(node),
    proxyToWorker: true
  };
  if (input.seed) {
    config.seed = input.seed;
    config.restoreHeight = restoreHeight;
  }
  return { config, node, restoreHeight };
}
