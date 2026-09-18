import type { DeviceVault } from '../../security/device-vault';
import { base64ToBytes, bytesToBase64 } from '../../nostr/envelope';
import { DEFAULT_MONERO_NODE, MOCK_STAGENET_NODE, normalizeMoneroNodeConfig } from './wallet-node';
import { loadMoneroTsRuntime, moneroWalletConfig } from './wallet-runtime';
import {
  LEGACY_MONERO_WALLET_SCOPE,
  loadMoneroWalletBundle,
  loadMoneroWalletData,
  moneroWalletDataScope,
  moneroWalletScope,
  saveMoneroWalletBundle,
  saveMoneroWalletData,
  snapshotFromBundle
} from './wallet-storage';
import { tipJarBackupPayload, type TipJarBackupPayload } from './wallet-backup';
import { walletTxFromRuntime } from './tip-jar-history';
import type {
  MoneroWalletBalance,
  MoneroWalletBackupInfo,
  MoneroWalletCreateRequest,
  MoneroWalletDataRecord,
  MoneroWalletMetadata,
  MoneroWalletRestoreRequest,
  MoneroWalletRuntime,
  MoneroWalletRuntimeWallet,
  MoneroWalletSecretBundle,
  MoneroWalletSnapshot,
  MoneroWalletSyncState,
  TipJarWalletTx
} from './types';

type WalletVault = Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'putSecret' | 'getSecret' | 'deleteSecret'>;

export const WALLET_ALREADY_STORED = 'A Monero wallet is already stored for this account. Open it instead.';

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

function copyBytes(value: ArrayLike<number> | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
  return new Uint8Array(value);
}

// Lower is always safe for a restore height: it only costs scan time, never payments.
async function walletRestoreHeight(wallet: MoneroWalletRuntimeWallet, probed: number): Promise<number> {
  const reported = await wallet.getRestoreHeight?.().catch(() => undefined);
  return Number.isInteger(reported) && (reported as number) >= 0 ? Math.min(reported as number, probed) : probed;
}

export interface MoneroWalletCoreOptions {
  vault: WalletVault;
  // The signed-in Nostr account. Each account has its own wallet scope.
  account: () => string | null;
  runtime?: MoneroWalletRuntime;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export class MoneroWalletCore {
  private readonly vault: WalletVault;
  private readonly account: () => string | null;
  private readonly runtime?: MoneroWalletRuntime;
  private readonly fetcher?: typeof fetch;
  private readonly now: () => Date;
  private wallet: MoneroWalletRuntimeWallet | null = null;
  private walletRuntime: MoneroWalletRuntime | null = null;
  // The account the open wallet belongs to; every write goes to that account's scopes.
  private walletPubkey: string | null = null;
  private bundle: MoneroWalletSecretBundle | null = null;
  private data: MoneroWalletDataRecord | null = null;
  // Bumped by close(), so an open or create that finishes after a lock or an account switch
  // closes what it produced instead of installing it.
  private generation = 0;

  constructor(options: MoneroWalletCoreOptions) {
    this.vault = options.vault;
    this.account = options.account;
    this.runtime = options.runtime;
    this.fetcher = options.fetcher;
    this.now = options.now ?? (() => new Date());
  }

  private pubkey(): string {
    const pubkey = this.account();
    if (!pubkey) throw new Error('Sign in before using the Monero wallet.');
    return pubkey;
  }

  private scope(): string {
    return moneroWalletScope(this.pubkey());
  }

  async hasWallet(): Promise<boolean> {
    return this.vault.hasSecret(this.scope());
  }

  async hasLegacyWallet(): Promise<boolean> {
    return this.vault.hasSecret(LEGACY_MONERO_WALLET_SCOPE);
  }

  // Public addresses only, so Settings can tell whether the published tip address is this wallet's.
  async storedAddresses(): Promise<string[]> {
    if (!await this.hasWallet()) return [];
    const bundle = await loadMoneroWalletBundle(this.vault, this.scope());
    return [bundle.metadata.creatorSubaddress, bundle.metadata.primaryAddress].filter(Boolean);
  }

  // Moves a wallet saved under the old device-wide scope to this account. The legacy copy is
  // removed only after the account copy has been written and read back.
  async claimLegacyWallet(): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    const scope = this.scope();
    if (await this.vault.hasSecret(scope)) throw new Error(WALLET_ALREADY_STORED);
    const legacy = await loadMoneroWalletBundle(this.vault, LEGACY_MONERO_WALLET_SCOPE);
    const snapshot = await saveMoneroWalletBundle(this.vault, { ...legacy, metadata: { ...legacy.metadata, scope, updatedAt: this.now().toISOString() } });
    await this.vault.deleteSecret(LEGACY_MONERO_WALLET_SCOPE);
    return snapshot;
  }

  async createWallet(request: MoneroWalletCreateRequest = {}): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    await this.assertNoWallet();
    const generation = this.generation;
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const { config, node, restoreHeight } = await moneroWalletConfig({ node: request.node ?? DEFAULT_MONERO_NODE, fetcher: this.fetcher });
    const wallet = await runtime.createWallet(config);
    const height = await walletRestoreHeight(wallet, request.restoreHeight ?? restoreHeight);
    return this.persistNewWallet(runtime, wallet, node, height, request.now ?? this.now(), 'created', generation);
  }

  async restoreWallet(request: MoneroWalletRestoreRequest): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    const seed = request.seed.trim();
    if (!seed) throw new Error('Monero recovery seed is required.');
    const replace = request.replace === true;
    // Replacing ends the stored wallet's life on this device, so the open one is closed before
    // anything is written: nothing should still be syncing against a seed being thrown away.
    if (replace) await this.close();
    else await this.assertNoWallet();
    const generation = this.generation;
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const { config, node, restoreHeight } = await moneroWalletConfig({ node: request.node ?? DEFAULT_MONERO_NODE, seed, restoreHeight: request.restoreHeight, fetcher: this.fetcher });
    const wallet = await runtime.createWallet(config);
    return this.persistNewWallet(runtime, wallet, node, restoreHeight, request.now ?? this.now(), 'restored', generation, replace);
  }

  async createMockStagenetWallet(request: MoneroWalletCreateRequest = {}): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    if (!this.runtime) throw new Error('A mock Monero runtime is required for mock stagenet wallet creation.');
    await this.assertNoWallet();
    const generation = this.generation;
    const node = normalizeMoneroNodeConfig({ ...(request.node ?? MOCK_STAGENET_NODE), mode: 'mock-stagenet' });
    const restoreHeight = request.restoreHeight ?? 2_800_000;
    const wallet = await this.runtime.createWallet({ password: '', networkType: 'stagenet', restoreHeight, server: 'mock-stagenet' });
    return this.persistNewWallet(this.runtime, wallet, node, restoreHeight, request.now ?? this.now(), 'mock-stagenet', generation);
  }

  async openWallet(): Promise<MoneroWalletSnapshot> {
    ensureUnlocked(this.vault);
    await this.close();
    const generation = this.generation;
    const pubkey = this.pubkey();
    const scope = moneroWalletScope(pubkey);
    const bundle = await loadMoneroWalletBundle(this.vault, scope);
    const data = await loadMoneroWalletData(this.vault, moneroWalletDataScope(pubkey), bundle.metadata.id);
    const runtime = this.runtime ?? await loadMoneroTsRuntime();
    const wallet = await this.openRuntimeWallet(runtime, bundle, data);
    if (generation !== this.generation || scope !== this.scope()) {
      await wallet.close(false).catch(() => undefined);
      throw new Error('The Monero wallet was closed while it was opening.');
    }
    this.wallet = wallet;
    this.walletRuntime = runtime;
    this.walletPubkey = pubkey;
    this.bundle = bundle;
    this.data = data;
    return this.snapshot();
  }

  isOpen(): boolean {
    return Boolean(this.wallet) && this.walletPubkey === this.account();
  }

  async sync(onProgress?: (fraction: number, remainingBlocks: number) => void): Promise<MoneroWalletSyncState> {
    const wallet = this.requireOpenWallet();
    const listener = onProgress ? this.walletRuntime?.syncListener?.(onProgress) : undefined;
    await (listener ? wallet.sync(listener) : wallet.sync());
    const [height, daemonHeight] = await Promise.all([wallet.getHeight().catch(() => null), wallet.getDaemonHeight().catch(() => null)]);
    const sync: MoneroWalletSyncState = { height, daemonHeight, synchronized: height !== null && daemonHeight !== null && height >= daemonHeight, updatedAt: this.now().toISOString() };
    await this.saveData(wallet, { lastSync: sync }, true);
    return sync;
  }

  async balance(): Promise<MoneroWalletBalance> {
    const wallet = this.requireOpenWallet();
    const [balance, unlocked] = await Promise.all([wallet.getBalance(), wallet.getUnlockedBalance()]);
    const lastBalance = { atomicBalance: balance.toString(), atomicUnlockedBalance: unlocked.toString() };
    await this.saveData(wallet, { lastBalance }, false);
    return lastBalance;
  }

  // The wallet's own transaction list, the source of truth for Tip Jar activity. A runtime
  // that cannot list transactions reports none rather than failing the sync around it.
  async transactions(): Promise<TipJarWalletTx[]> {
    const wallet = this.requireOpenWallet();
    if (!wallet.getTxs) return [];
    const txs = await wallet.getTxs();
    return txs.map(walletTxFromRuntime).filter((tx): tx is TipJarWalletTx => tx !== null);
  }

  // The stored wallet's id, which Tip Jar activity is kept against, whether or not it is open.
  async storedWalletId(): Promise<string> {
    return (await this.storedBundle()).metadata.id;
  }

  async backupInfo(): Promise<MoneroWalletBackupInfo> {
    const bundle = await this.storedBundle();
    return { seed: bundle.seed, restoreHeight: bundle.metadata.restoreHeight };
  }

  // Everything a restore on another device needs, and nothing that is only true of this one.
  // The caller seals it; the seed never leaves this process unencrypted.
  async backupPayload(): Promise<TipJarBackupPayload> {
    return tipJarBackupPayload(await this.storedBundle());
  }

  private async storedBundle(): Promise<MoneroWalletSecretBundle> {
    ensureUnlocked(this.vault);
    const scope = this.scope();
    return this.bundle?.metadata.scope === scope ? this.bundle : loadMoneroWalletBundle(this.vault, scope);
  }

  async close(): Promise<void> {
    this.generation += 1;
    const wallet = this.wallet;
    this.wallet = null;
    this.walletRuntime = null;
    this.walletPubkey = null;
    this.bundle = null;
    this.data = null;
    if (wallet) await wallet.close(false).catch(() => undefined);
  }

  private async assertNoWallet(): Promise<void> {
    if (await this.vault.hasSecret(this.scope())) throw new Error(WALLET_ALREADY_STORED);
  }

  // Saved keys and cache resume the last sync. Anything wrong with them falls back to the seed,
  // which is always sufficient on its own.
  private async openRuntimeWallet(runtime: MoneroWalletRuntime, bundle: MoneroWalletSecretBundle, data: MoneroWalletDataRecord | null): Promise<MoneroWalletRuntimeWallet> {
    const keysData = data?.keysDataBase64 ? base64ToBytes(data.keysDataBase64) : null;
    if (keysData && runtime.openWallet) {
      try {
        const cacheData = data?.cacheDataBase64 ? base64ToBytes(data.cacheDataBase64) ?? undefined : undefined;
        const { config } = await moneroWalletConfig({ node: bundle.metadata.node, keysData, cacheData, fetcher: this.fetcher });
        return await runtime.openWallet(config);
      } catch (error) {
        if (error instanceof Error && /^Monero node/.test(error.message)) throw error;
      }
    }
    const { config } = await moneroWalletConfig({ node: bundle.metadata.node, seed: bundle.seed, restoreHeight: bundle.metadata.restoreHeight, fetcher: this.fetcher });
    return runtime.createWallet(config);
  }

  private snapshot(): MoneroWalletSnapshot {
    const snapshot = snapshotFromBundle(this.bundle as MoneroWalletSecretBundle);
    return {
      ...snapshot,
      balance: this.data?.lastBalance ? { ...this.data.lastBalance } : snapshot.balance,
      sync: this.data?.lastSync ? { ...this.data.lastSync } : snapshot.sync
    };
  }

  private async persistNewWallet(runtime: MoneroWalletRuntime, wallet: MoneroWalletRuntimeWallet, node: MoneroWalletMetadata['node'], restoreHeight: number, now: Date, source: MoneroWalletMetadata['source'], generation: number, replace = false): Promise<MoneroWalletSnapshot> {
    try {
      const pubkey = this.pubkey();
      const scope = moneroWalletScope(pubkey);
      const [seed, primaryAddress, creator, privateSpendKey, privateViewKey] = await Promise.all([
        wallet.getSeed(),
        wallet.getPrimaryAddress(),
        wallet.createSubaddress(0, 'Workstr creator support'),
        optionalSecret(wallet.getPrivateSpendKey?.bind(wallet)),
        optionalSecret(wallet.getPrivateViewKey?.bind(wallet))
      ]);
      const creatorSubaddress = readSubaddressAddress(creator);
      // Checked again after the slow runtime work: a second tap, another tab, a lock or an
      // account switch may have happened meanwhile, and none of them may be overwritten.
      if (generation !== this.generation || pubkey !== this.account()) throw new Error('The Monero wallet was closed while it was being set up.');
      // Skipped only for a deliberate replace, which the caller has already confirmed with the
      // user. The stored wallet's keys and scan cache are keyed by wallet id, so the new id
      // leaves them unreadable rather than half-applied to the restored wallet.
      if (!replace) await this.assertNoWallet();
      const timestamp = now.toISOString();
      const metadata: MoneroWalletMetadata = {
        version: 1,
        id: walletId(),
        scope,
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
      const snapshot = await saveMoneroWalletBundle(this.vault, bundle);
      this.wallet = wallet;
      this.walletRuntime = runtime;
      this.walletPubkey = pubkey;
      this.bundle = bundle;
      this.data = null;
      await this.saveData(wallet, {}, true).catch(() => undefined);
      return snapshot;
    } catch (error) {
      if (this.wallet === wallet) {
        this.wallet = null;
        this.walletPubkey = null;
        this.bundle = null;
      }
      await wallet.close(false).catch(() => undefined);
      throw error;
    }
  }

  private requireOpenWallet(): MoneroWalletRuntimeWallet {
    ensureUnlocked(this.vault);
    if (!this.wallet || this.walletPubkey !== this.account()) throw new Error('Open the Monero wallet before using it.');
    return this.wallet;
  }

  // Writes the data record, never the seed bundle. With `exportData` the runtime's current keys
  // and scan cache are included, so the next open resumes from this point.
  private async saveData(wallet: MoneroWalletRuntimeWallet, update: Pick<MoneroWalletDataRecord, 'lastBalance' | 'lastSync'>, exportData: boolean): Promise<void> {
    const bundle = this.bundle;
    const pubkey = this.walletPubkey;
    if (!bundle || !pubkey) return;
    const exported = exportData ? await wallet.getData?.().catch(() => null) : null;
    const next: MoneroWalletDataRecord = {
      ...(this.data ?? {}),
      ...update,
      version: 1,
      walletId: bundle.metadata.id,
      savedAt: this.now().toISOString()
    };
    if (exported && exported.length >= 2) {
      next.keysDataBase64 = bytesToBase64(copyBytes(exported[0]));
      next.cacheDataBase64 = bytesToBase64(copyBytes(exported[1]));
    }
    await saveMoneroWalletData(this.vault, moneroWalletDataScope(pubkey), next);
    if (this.bundle === bundle) this.data = next;
  }
}
