import type { MoneroDaemonStatus, MoneroNetwork, MoneroNodeConfig } from './types';

export const DEFAULT_MONERO_NODE: MoneroNodeConfig = {
  mode: 'workstr',
  host: 'xmr.workstr.fit',
  port: 43736,
  ssl: true,
  network: 'mainnet'
};

export const MOCK_STAGENET_NODE: MoneroNodeConfig = {
  mode: 'mock-stagenet',
  host: 'mock-stagenet.local',
  port: 38081,
  ssl: false,
  network: 'stagenet'
};

export function normalizeMoneroNodeConfig(input: Partial<MoneroNodeConfig> | null | undefined): MoneroNodeConfig {
  if (!input || input.mode === 'workstr') return { ...DEFAULT_MONERO_NODE };
  if (input.mode === 'mock-stagenet') return { ...MOCK_STAGENET_NODE };
  const host = `${input.host ?? ''}`.trim();
  const port = Number(input.port);
  const network = input.network ?? 'mainnet';
  if (!host) throw new Error('Monero node host is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Monero node port must be between 1 and 65535.');
  if (!['mainnet', 'stagenet', 'testnet'].includes(network)) throw new Error('Unsupported Monero network.');
  return { mode: 'custom', host, port, ssl: Boolean(input.ssl), network };
}

export function moneroRpcUrl(config: MoneroNodeConfig, path = '/json_rpc'): string {
  const scheme = config.ssl ? 'https' : 'http';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${scheme}://${config.host}:${config.port}${normalizedPath}`;
}

function networkFromInfo(result: Record<string, unknown>): MoneroNetwork | null {
  if (result.nettype === 'mainnet' || result.mainnet === true) return 'mainnet';
  if (result.nettype === 'stagenet' || result.stagenet === true) return 'stagenet';
  if (result.nettype === 'testnet' || result.testnet === true) return 'testnet';
  return null;
}

export async function probeMoneroDaemon(
  config: MoneroNodeConfig = DEFAULT_MONERO_NODE,
  fetcher: typeof fetch = fetch
): Promise<MoneroDaemonStatus> {
  if (config.mode === 'mock-stagenet') {
    return { ok: true, reachable: true, corsOk: true, network: 'stagenet', height: 2_800_000, synchronized: true, restricted: true, message: 'mock stagenet daemon reachable' };
  }
  try {
    const response = await fetcher(moneroRpcUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'workstr-phase1', method: 'get_info' })
    });
    const payload = await response.json() as { result?: Record<string, unknown>; error?: unknown };
    const result = payload.result ?? {};
    const network = networkFromInfo(result);
    const height = typeof result.height === 'number' ? result.height : null;
    const synchronized = typeof result.synchronized === 'boolean' ? result.synchronized : null;
    const restricted = typeof result.restricted === 'boolean' ? result.restricted : null;
    const networkOk = !network || network === config.network;
    return {
      ok: response.ok && !payload.error && networkOk,
      reachable: response.ok,
      corsOk: true,
      network,
      height,
      synchronized,
      restricted,
      message: !networkOk ? `node returned ${network}, expected ${config.network}` : `daemon answered ${response.status}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    return { ok: false, reachable: false, corsOk: !/failed to fetch/i.test(message), network: null, height: null, synchronized: null, restricted: null, message };
  }
}
