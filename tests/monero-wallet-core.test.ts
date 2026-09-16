import { describe, expect, it, vi } from 'vitest';
import { MoneroWalletCore } from '../src/features/monero/wallet-core';
import { MONERO_WALLET_SCOPE } from '../src/features/monero/mock-stagenet-wallet';
import { hasStoredMoneroWallet, loadMoneroWalletBundle, saveMoneroWalletBundle } from '../src/features/monero/wallet-storage';
import { moneroWalletConfig } from '../src/features/monero/wallet-runtime';
import type { MoneroWalletRuntime, MoneroWalletRuntimeWallet } from '../src/features/monero/types';

function response(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
}

function nodeFetcher(network = 'mainnet', height = 3_763_261): typeof fetch {
  return vi.fn(async () => response({ result: { nettype: network, height, synchronized: true, restricted: true } })) as unknown as typeof fetch;
}

function fakeVault(unlocked = true) {
  const writes: Record<string, string> = {};
  return {
    writes,
    vault: {
      isUnlocked: () => unlocked,
      hasSecret: async (scope: string) => Object.prototype.hasOwnProperty.call(writes, scope),
      putSecret: async (scope: string, plaintext: string) => { writes[scope] = plaintext; },
      getSecret: async (scope: string) => {
        if (!Object.prototype.hasOwnProperty.call(writes, scope)) throw new Error('scope-not-found');
        return writes[scope];
      },
      deleteSecret: async (scope: string) => { delete writes[scope]; }
    }
  };
}

class FakeWallet implements MoneroWalletRuntimeWallet {
  saved = 0;
  closed = false;

  constructor(private readonly seed = 'mock seed words', private readonly height = 1234) {}

  async getSeed() { return this.seed; }
  async getPrivateSpendKey() { return 'spend-key-material'; }
  async getPrivateViewKey() { return 'view-key-material'; }
  async getPrimaryAddress() { return '48fPrimaryAddress'; }
  async createSubaddress() { return { address: '8CreatorSubaddress', index: 1 }; }
  async getBalance() { return 123456789n; }
  async getUnlockedBalance() { return 120000000n; }
  async getHeight() { return this.height; }
  async getDaemonHeight() { return this.height; }
  async sync() { return {}; }
  async save() { this.saved += 1; }
  async close() { this.closed = true; }
}

function runtime(wallet = new FakeWallet()): { runtime: MoneroWalletRuntime; wallet: FakeWallet; configs: Record<string, unknown>[] } {
  const configs: Record<string, unknown>[] = [];
  return {
    wallet,
    configs,
    runtime: {
      createWallet: async (config) => {
        configs.push(config);
        return wallet;
      }
    }
  };
}

describe('Monero wallet runtime config', () => {
  it('builds monero-ts config from the browser-probed daemon without importing the runtime', async () => {
    const fetcher = nodeFetcher('mainnet', 3_000_123);
    const { config, node, restoreHeight } = await moneroWalletConfig({ fetcher });
    expect(node.host).toBe('xmr.workstr.fit');
    expect(restoreHeight).toBe(3_000_123);
    expect(config).toMatchObject({ networkType: 'mainnet', restoreHeight: 3_000_123, server: 'https://xmr.workstr.fit:43736/json_rpc', proxyToWorker: true });
  });

  it('rejects the wrong daemon network before wallet creation', async () => {
    await expect(moneroWalletConfig({ fetcher: nodeFetcher('stagenet') })).rejects.toThrow(/expected mainnet|not ready/);
  });
});

describe('Monero wallet vault storage', () => {
  it('stores wallet secrets only under the monero.hot-wallet vault scope', async () => {
    const { vault, writes } = fakeVault(true);
    const bundle = {
      version: 1 as const,
      seed: 'seed words',
      privateSpendKey: 'spend',
      privateViewKey: 'view',
      metadata: {
        version: 1 as const,
        id: 'wallet-1',
        scope: MONERO_WALLET_SCOPE as typeof MONERO_WALLET_SCOPE,
        network: 'mainnet' as const,
        node: { mode: 'workstr' as const, host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' as const },
        restoreHeight: 1,
        primaryAddress: 'primary',
        creatorSubaddress: 'creator',
        creatorSubaddressIndex: 1,
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
        source: 'created' as const
      }
    };
    await saveMoneroWalletBundle(vault, bundle);
    expect(Object.keys(writes)).toEqual([MONERO_WALLET_SCOPE]);
    expect(await hasStoredMoneroWallet(vault)).toBe(true);
    expect((await loadMoneroWalletBundle(vault)).seed).toBe('seed words');
  });

  it('refuses to read or write while the Workstr vault is locked', async () => {
    const { vault } = fakeVault(false);
    await expect(loadMoneroWalletBundle(vault)).rejects.toThrow(/Unlock Workstr/);
    await expect(saveMoneroWalletBundle(vault, {} as never)).rejects.toThrow(/Unlock Workstr/);
  });
});

describe('Monero wallet core', () => {
  it('creates a wallet, dedicated creator subaddress, and vault bundle without using Nostr material', async () => {
    const { vault, writes } = fakeVault(true);
    const fake = runtime();
    const core = new MoneroWalletCore({ vault, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
    const snapshot = await core.createWallet();
    expect(snapshot.metadata.scope).toBe(MONERO_WALLET_SCOPE);
    expect(snapshot.metadata.restoreHeight).toBe(3_763_261);
    expect(snapshot.metadata.creatorSubaddress).toBe('8CreatorSubaddress');
    expect(fake.configs[0]).toMatchObject({ networkType: 'mainnet' });
    expect(fake.configs[0]).not.toHaveProperty('seed');
    expect(JSON.stringify(writes)).not.toContain('nsec');
    expect(JSON.parse(writes[MONERO_WALLET_SCOPE]).seed).toBe('mock seed words');
  });

  it('restores from a seed and passes that seed only to the lazy wallet runtime', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime(new FakeWallet('restored seed words'));
    const core = new MoneroWalletCore({ vault, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
    const snapshot = await core.restoreWallet({ seed: ' restored seed words ', restoreHeight: 2_500_000 });
    expect(fake.configs[0]).toMatchObject({ seed: 'restored seed words', restoreHeight: 2_500_000 });
    expect(snapshot.metadata.source).toBe('restored');
  });

  it('updates balance and sync snapshots only while the vault-backed wallet is open', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime();
    const core = new MoneroWalletCore({ vault, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
    await core.createWallet();
    await expect(core.balance()).resolves.toEqual({ atomicBalance: '123456789', atomicUnlockedBalance: '120000000' });
    await expect(core.sync()).resolves.toMatchObject({ synchronized: true, height: 1234, daemonHeight: 1234 });
    await core.close();
    expect(fake.wallet.closed).toBe(true);
    await expect(core.balance()).rejects.toThrow(/Open the Monero wallet/);
  });

  it('closes the runtime wallet if vault verification fails during create', async () => {
    const fake = runtime();
    const vault = {
      isUnlocked: () => true,
      hasSecret: async () => false,
      putSecret: async () => undefined,
      getSecret: async () => JSON.stringify({ broken: true })
    };
    const core = new MoneroWalletCore({ vault, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
    await expect(core.createWallet()).rejects.toThrow(/unsupported|corrupt/);
    expect(fake.wallet.closed).toBe(true);
    await expect(core.balance()).rejects.toThrow(/Open the Monero wallet/);
  });

  it('opens a stored wallet by rebuilding the lazy runtime from the vault seed', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime(new FakeWallet('stored seed words'));
    const core = new MoneroWalletCore({ vault, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
    await core.createWallet();
    await core.close();
    const reopened = await core.openWallet();
    expect(reopened.metadata.creatorSubaddress).toBe('8CreatorSubaddress');
    expect(fake.configs.at(-1)).toMatchObject({ seed: 'stored seed words', restoreHeight: 3_763_261 });
    await expect(core.balance()).resolves.toEqual({ atomicBalance: '123456789', atomicUnlockedBalance: '120000000' });
  });

  it('requires an unlocked Workstr vault before creating or opening the Monero wallet', async () => {
    const { vault } = fakeVault(false);
    const core = new MoneroWalletCore({ vault, runtime: runtime().runtime, fetcher: nodeFetcher() });
    await expect(core.createWallet()).rejects.toThrow(/Unlock Workstr/);
    await expect(core.openWallet()).rejects.toThrow(/Unlock Workstr/);
  });
});
