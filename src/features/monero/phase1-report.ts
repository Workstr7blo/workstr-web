import { DEFAULT_MONERO_NODE, probeMoneroDaemon } from './wallet-node';
import { createMockStagenetWallet } from './mock-stagenet-wallet';
import { probeMoneroTsImport } from './wallet-spike';
import type { MoneroPhase1Report } from './types';

export async function runMoneroPhase1Probe(fetcher: typeof fetch = fetch): Promise<MoneroPhase1Report> {
  const [library, defaultNode] = await Promise.all([
    probeMoneroTsImport(),
    probeMoneroDaemon(DEFAULT_MONERO_NODE, fetcher)
  ]);
  const mockWallet = createMockStagenetWallet().metadata;
  const blockers: string[] = [];
  if (!library.ok) blockers.push(`monero-ts did not load cleanly: ${library.message}`);
  if (!defaultNode.ok) blockers.push(`browser cannot use ${DEFAULT_MONERO_NODE.host}:${DEFAULT_MONERO_NODE.port}: ${defaultNode.message}`);
  if (!defaultNode.corsOk) blockers.push('default Monero daemon needs browser-compatible CORS or a same-origin RPC proxy before wallet sync can run in the PWA');
  return {
    generatedAt: new Date().toISOString(),
    library,
    defaultNode,
    mockWallet,
    conclusion: blockers.length ? 'pass-with-blockers' : 'pass',
    blockers,
    nextStep: blockers.length
      ? 'Prototype a browser-compatible Monero RPC bridge/proxy or daemon CORS configuration, then rerun wallet create/sync against stagenet before production UI.'
      : 'Proceed to wallet-core implementation behind a lazy-loaded Monero module.'
  };
}
