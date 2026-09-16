import type { DeviceVault } from '../../security/device-vault';
import { MONERO_WALLET_SCOPE } from './mock-stagenet-wallet';
import { DEFAULT_MONERO_NODE, MOCK_STAGENET_NODE, normalizeMoneroNodeConfig } from './wallet-node';
import { loadMoneroTsRuntime, moneroWalletConfig } from './wallet-runtime';
import { loadMoneroWalletBundle, saveMoneroWalletBundle, snapshotFromBundle } from './wallet-storage';
import type {
  MoneroWalletBalance,
  MoneroWalletCreateRequest,
  MoneroWalletMetadata,
  MoneroWalletRestoreRequest,
  MoneroWalletRuntime,
  MoneroWalletRuntimeWallet,
  MoneroWalletSecretBundle,
  MoneroWalletSnapshot,
  MoneroWalletSyncState
} from './types';

function walletId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `monero-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readSubaddressAddress(value: Awaited<ReturnType<MoneroWalletRuntimeWallet['createSubaddress']>>): { address: string; index: number } {
  const address = typeof value.getAddress === 'function' ? value.getAddress() : value.address;
  const index = typeof value.getIndex === 'function' ? value.getIndex() : value.index;
  if (!address || typeof index !== 'number') throw new Error('Monero wallet did not return a creator subaddress.');
  return { address, index };
}

function ensureUnlocked(vault: Pick<DeviceVault, 'isUnlocked'>): void {
  if (!vault.isUnlocked()) throw new Error('Unlock Workstr before using the Monero wallet.');
}

async function optionalSecret(read: (() => Promise<string>) | undefined): Promise<string | undefined> {
  if (!read) return undefined;
  const value = await read();
  return value || undefined;
}

export interface MoneroWalletCoreOptions {
  vault: Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'putSecret' | 'getSecret'>;
  runtime?: MoneroWalletRuntime;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export class MoneroWalletCore {
  private readonly vault: Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'putSecret' | 'getSecret'>;
  private readonly runtime?: MoneroWalletRuntime;
  private readonly fetcher?: typeof fetch;
  private readonly now: () => Date;
  private wallet: MoneroWalletRuntimeWallet | null = null;
  private bundle: MoneroWalletSecretBundle | null = null;

  constructor(options: MoneroWalletCoreOptions) {
    this.vault = options.vault;
    this.runtime = options.runtime;
    this.fetcher = options.fetcher;
    this.now = options.now ?? (() => new Date());
  }

  async hasWallet(): Promise<boolean> {
    return this.vault.hasSecret(MONERO_WALLET_SCOPE);
  }

  async createWallet(request: MoneroWalletCreateRequest = {}): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const { config, node, restoreHeight } = await moneroWalletConfig({ node: request.node ?? DEFAULT_MONERO_NODE, restoreHeight: request.restoreHeight, fetcher: this.fetcher });
    const wallet = await runtime.createWallet(config);
    return this.persistNewWallet(wallet, node, restoreHeight, request.now ?? this.now(), 'created');
  }

  async restoreWallet(request: MoneroWalletRestoreRequest): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    const seed = request.seed.trim();
    if (!seed) throw new Error('Monero recovery seed is required.');
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const { config, node, restoreHeight } = await moneroWalletConfig({ node: request.node ?? DEFAULT_MONERO_NODE, seed, restoreHeight: request.restoreHeight, fetcher: this.fetcher });
    const wallet = await runtime.createWallet(config);
    return this.persistNewWallet(wallet, node, restoreHeight, request.now ?? this.now(), 'restored');
  }

  async createMockStagenetWallet(request: MoneroWalletCreateRequest = {}): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    if (!this.runtime) throw new Error('A mock Monero runtime is required for mock stagenet wallet creation.');
    const node = normalizeMoneroNodeConfig({ ...(request.node ?? MOCK_STAGENET_NODE), mode: 'mock-stagenet' });
    const restoreHeight = request.restoreHeight ?? 2_800_000;
    const wallet = await this.runtime.createWallet({ password: '', networkType: 'stagenet', restoreHeight, server: 'mock-stagenet' });
    return this.persistNewWallet(wallet, node, restoreHeight, request.now ?? this.now(), 'mock-stagenet');
  }

  async openWallet(): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    const bundle = await loadMoneroWalletBundle(this.vault);
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const { config } = await moneroWalletConfig({
      node: bundle.metadata.node,
      seed: bundle.seed,
      restoreHeight: bundle.metadata.restoreHeight,
      fetcher: this.fetcher
    });
    this.wallet = await runtime.createWallet(config);
    this.bundle = bundle;
    return snapshotFromBundle(bundle);
  }

  async sync(): Promise<MoneroWalletSyncState> {
    const wallet = await this.requireOpenWallet();
    await wallet.sync();
    const [height, daemonHeight] = await Promise.all([wallet.getHeight().catch(() => null), wallet.getDaemonHeight().catch(() => null)]);
    const sync: MoneroWalletSyncState = { height, daemonHeight, synchronized: height !== null && daemonHeight !== null && height >= daemonHeight, updatedAt: this.now().toISOString() };
    await wallet.save();
    await this.updateBundle({ lastSync: sync });
    return sync;
  }

  async balance(): Promise<MoneroWalletBalance> {
    const wallet = await this.requireOpenWallet();
    const [balance, unlocked] = await Promise.all([wallet.getBalance(), wallet.getUnlockedBalance()]);
    const lastBalance = { atomicBalance: balance.toString(), atomicUnlockedBalance: unlocked.toString() };
    await this.updateBundle({ lastBalance });
    return lastBalance;
  }

  async close(): Promise<void> {
    const wallet = this.wallet;
    this.wallet = null;
    this.bundle = null;
    if (wallet) await wallet.close(true).catch(() => undefined);
  }

  private async persistNewWallet(wallet: MoneroWalletRuntimeWallet, node: MoneroWalletMetadata['node'], restoreHeight: number, now: Date, source: MoneroWalletMetadata['source']): Promise<MoneroWalletSnapshot> {
    this.wallet = wallet;
    const [seed, primaryAddress, creator, privateSpendKey, privateViewKey] = await Promise.all([
      wallet.getSeed(),
      wallet.getPrimaryAddress(),
      wallet.createSubaddress(0, 'Workstr creator support'),
      optionalSecret(wallet.getPrivateSpendKey?.bind(wallet)),
      optionalSecret(wallet.getPrivateViewKey?.bind(wallet))
    ]);
    const creatorSubaddress = readSubaddressAddress(creator);
    const timestamp = now.toISOString();
    const metadata: MoneroWalletMetadata = {
      version: 1,
      id: walletId(),
      scope: MONERO_WALLET_SCOPE,
      network: node.network,
      node,
      restoreHeight,
      primaryAddress,
      creatorSubaddress: creatorSubaddress.address,
      creatorSubaddressIndex: creatorSubaddress.index,
      createdAt: timestamp,
      updatedAt: timestamp,
      source
    };
    const bundle: MoneroWalletSecretBundle = { version: 1, metadata, seed, privateSpendKey, privateViewKey };
    this.bundle = bundle;
    await wallet.save();
    try {
      return await saveMoneroWalletBundle(this.vault, bundle);
    } catch (error) {
      this.wallet = null;
      this.bundle = null;
      await wallet.close(false).catch(() => undefined);
      throw error;
    }
  }

  private async requireOpenWallet(): Promise<MoneroWalletRuntimeWallet> {
    ensureUnlocked(this.vault);
    if (!this.wallet) throw new Error('Open the Monero wallet before using it.');
    return this.wallet;
  }

  private async updateBundle(update: Partial<Pick<MoneroWalletSecretBundle, 'lastBalance' | 'lastSync'>>): Promise<void> {
    ensureUnlocked(this.vault);
    const current = this.bundle ?? await loadMoneroWalletBundle(this.vault);
    const next: MoneroWalletSecretBundle = { ...current, ...update, metadata: { ...current.metadata, updatedAt: this.now().toISOString() } };
    this.bundle = next;
    await saveMoneroWalletBundle(this.vault, next);
  }
}
