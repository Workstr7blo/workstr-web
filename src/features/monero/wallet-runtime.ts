import { moneroRpcUrl, normalizeMoneroNodeConfig, probeMoneroDaemon } from './wallet-node';
import type { MoneroNodeConfig, MoneroWalletRuntime, MoneroWalletRuntimeWallet } from './types';

export async function loadMoneroTsRuntime(): Promise<MoneroWalletRuntime> {
  const module = await import('monero-ts') as Record<string, unknown>;
  const createWalletFull = module.createWalletFull;
  const openWalletFull = module.openWalletFull;
  if (typeof createWalletFull !== 'function') throw new Error('monero-ts createWalletFull is unavailable.');
  return {
    async createWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet> {
      return await createWalletFull(config) as MoneroWalletRuntimeWallet;
    },
    ...(typeof openWalletFull === 'function' ? {
      async openWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet> {
        return await openWalletFull(config) as MoneroWalletRuntimeWallet;
      }
    } : {})
  };
}

// monero-ts accepts a restore height only with a seed: a random wallet takes the daemon's
// height itself, and opening saved data takes neither. A seed restore without a height scans
// from the genesis block, because starting at the tip would silently miss every earlier payment.
export async function moneroWalletConfig(input: {
  node?: Partial<MoneroNodeConfig> | null;
  seed?: string;
  restoreHeight?: number;
  keysData?: Uint8Array;
  cacheData?: Uint8Array;
  fetcher?: typeof fetch;
} = {}): Promise<{ config: Record<string, unknown>; node: MoneroNodeConfig; restoreHeight: number }> {
  const node = normalizeMoneroNodeConfig(input.node);
  const status = await probeMoneroDaemon(node, input.fetcher ?? fetch);
  if (!status.ok) throw new Error(`Monero node is not ready: ${status.message}`);
  if (status.network && status.network !== node.network) throw new Error(`Monero node returned ${status.network}, expected ${node.network}.`);
  const restoreHeight = input.restoreHeight ?? (input.seed ? 0 : status.height ?? 0);
  if (!Number.isInteger(restoreHeight) || restoreHeight < 0) throw new Error('Monero restore height must be a non-negative integer.');
  const config: Record<string, unknown> = {
    path: '',
    password: '',
    networkType: node.network,
    server: moneroRpcUrl(node),
    proxyToWorker: true
  };
  if (input.keysData) {
    config.keysData = input.keysData;
    if (input.cacheData?.length) config.cacheData = input.cacheData;
  } else if (input.seed) {
    config.seed = input.seed;
    config.restoreHeight = restoreHeight;
  }
  return { config, node, restoreHeight };
}
