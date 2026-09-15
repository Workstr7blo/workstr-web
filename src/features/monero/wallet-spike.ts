import type { MoneroLibraryProbe } from './types';

export async function probeMoneroTsImport(): Promise<MoneroLibraryProbe> {
  try {
    const module = await import('monero-ts');
    const exports = Object.keys(module).sort();
    const hasCreateWalletFull = typeof (module as Record<string, unknown>).createWalletFull === 'function';
    const hasDaemonRpc = typeof (module as Record<string, unknown>).connectToDaemonRpc === 'function';
    return {
      ok: hasCreateWalletFull && hasDaemonRpc,
      packageName: 'monero-ts',
      exports: exports.slice(0, 80),
      hasCreateWalletFull,
      hasDaemonRpc,
      message: hasCreateWalletFull ? 'monero-ts loaded in this runtime' : 'monero-ts loaded but wallet-full factory is missing'
    };
  } catch (error) {
    return {
      ok: false,
      packageName: 'monero-ts',
      exports: [],
      hasCreateWalletFull: false,
      hasDaemonRpc: false,
      message: error instanceof Error ? error.message : String(error ?? 'monero-ts import failed')
    };
  }
}
