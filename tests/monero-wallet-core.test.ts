import { describe, expect, it, vi } from 'vitest';
import { MoneroWalletCore as Core } from '../src/features/monero/wallet-core';
import {
  LEGACY_MONERO_WALLET_SCOPE,
  hasStoredMoneroWallet,
  loadMoneroWalletBundle,
  moneroWalletDataScope,
  moneroWalletScope,
  saveMoneroWalletBundle
} from '../src/features/monero/wallet-storage';
import { loadMoneroTsRuntime, moneroWalletConfig } from '../src/features/monero/wallet-runtime';
import type { MoneroSyncProgress, MoneroWalletRuntime, MoneroWalletRuntimeTx, MoneroWalletRuntimeWallet } from '../src/features/monero/types';

// The real package loads WebAssembly and a worker; this stands in for it, because what is under
// test is the adapter around its listener, not the wallet behind it.
vi.mock('monero-ts', () => ({
  createWalletFull: async () => ({}),
  openWalletFull: async () => ({}),
  MoneroWalletListener: class {}
}));

function response(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
}

function nodeFetcher(network = 'mainnet', height = 3_763_261): typeof fetch {
  return vi.fn(async () => response({ result: { nettype: network, height, synchronized: true, restricted: true } })) as unknown as typeof fetch;
}

const ALICE = 'a1'.repeat(32);
const BOB = 'b2'.repeat(32);
const ALICE_SCOPE = moneroWalletScope(ALICE);

function fakeVault(unlocked = true) {
  const writes: Record<string, string> = {};
  const puts: string[] = [];
  return {
    writes,
    puts,
    vault: {
      isUnlocked: () => unlocked,
      hasSecret: async (scope: string) => Object.prototype.hasOwnProperty.call(writes, scope),
      putSecret: async (scope: string, plaintext: string) => { puts.push(scope); writes[scope] = plaintext; },
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
  getPath() { return ''; }
  async getData() { return [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]; }
  async save() { this.saved += 1; }
  async close() { this.closed = true; }
}

function runtime(wallet = new FakeWallet()): { runtime: MoneroWalletRuntime; wallet: FakeWallet; configs: Record<string, unknown>[]; opened: Record<string, unknown>[] } {
  const configs: Record<string, unknown>[] = [];
  const opened: Record<string, unknown>[] = [];
  return {
    wallet,
    configs,
    opened,
    runtime: {
      createWallet: async (config) => {
        configs.push(config);
        return wallet;
      },
      openWallet: async (config) => {
        opened.push(config);
        return wallet;
      }
    }
  };
}

function core(vault: ReturnType<typeof fakeVault>['vault'], fake: ReturnType<typeof runtime>, account: () => string | null = () => ALICE) {
  return new Core({ vault, account, runtime: fake.runtime, fetcher: nodeFetcher(), now: () => new Date('2026-09-15T00:00:00Z') });
}

function bundle(scope: string, seed = 'seed words') {
  return {
    version: 1 as const,
    seed,
    privateSpendKey: 'spend',
    privateViewKey: 'view',
    metadata: {
      version: 1 as const,
      id: 'wallet-1',
      scope,
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
}

describe('Monero wallet runtime config', () => {
  it('builds a random-wallet config from the browser-probed daemon without a restore height', async () => {
    const fetcher = nodeFetcher('mainnet', 3_000_123);
    const { config, node, restoreHeight } = await moneroWalletConfig({ fetcher });
    expect(node.host).toBe('xmr.workstr.fit');
    expect(restoreHeight).toBe(3_000_123);
    expect(config).toMatchObject({ path: '', networkType: 'mainnet', server: 'https://xmr.workstr.fit:43736/json_rpc', proxyToWorker: true });
    expect(config).not.toHaveProperty('restoreHeight');
  });

  it('scans a seed restore from the genesis block when no height is given, never from the tip', async () => {
    const { config, restoreHeight } = await moneroWalletConfig({ seed: 'old seed', fetcher: nodeFetcher('mainnet', 3_000_123) });
    expect(restoreHeight).toBe(0);
    expect(config).toMatchObject({ seed: 'old seed', restoreHeight: 0 });
  });

  it('opens saved wallet data with neither a seed nor a restore height', async () => {
    const keysData = new Uint8Array([1]);
    const { config } = await moneroWalletConfig({ seed: 'ignored', keysData, cacheData: new Uint8Array([2]), fetcher: nodeFetcher() });
    expect(config).toMatchObject({ keysData, cacheData: new Uint8Array([2]) });
    expect(config).not.toHaveProperty('seed');
    expect(config).not.toHaveProperty('restoreHeight');
  });

  it('rejects the wrong daemon network before wallet creation', async () => {
    await expect(moneroWalletConfig({ fetcher: nodeFetcher('stagenet') })).rejects.toThrow(/expected mainnet|not ready/);
  });
});

describe('Monero wallet runtime listener', () => {
  // The Tip Jar ring is drawn from these heights, so the adapter keeps all of them: forwarding
  // only the runtime's percentage left the ring with nothing to measure a catch-up with (#266).
  it('passes every height monero-ts reports on, not only its percentage', async () => {
    const runtime = await loadMoneroTsRuntime();
    const reports: MoneroSyncProgress[] = [];
    const listener = runtime.syncListener?.((report) => { reports.push(report); }) as { onSyncProgress(height: unknown, start: unknown, end: unknown, percentDone: unknown): Promise<void> };
    // monero-ts reports heights as BigInt.
    await listener.onSyncProgress(3_763_250n, 3_763_000n, 3_764_000n, 0.9997);
    expect(reports).toEqual([{ currentHeight: 3_763_250, startHeight: 3_763_000, targetHeight: 3_764_000, fraction: 0.9997, remainingBlocks: 750 }]);
  });
});

describe('Monero wallet vault storage', () => {
  it('stores wallet secrets only under the account wallet scope', async () => {
    const { vault, writes } = fakeVault(true);
    await saveMoneroWalletBundle(vault, bundle(ALICE_SCOPE));
    expect(Object.keys(writes)).toEqual([`monero.hot-wallet.${ALICE}`]);
    expect(await hasStoredMoneroWallet(vault, ALICE_SCOPE)).toBe(true);
    expect((await loadMoneroWalletBundle(vault, ALICE_SCOPE)).seed).toBe('seed words');
  });

  it('refuses a bundle whose recorded scope is another account', async () => {
    const { vault, writes } = fakeVault(true);
    writes[ALICE_SCOPE] = JSON.stringify(bundle(moneroWalletScope(BOB)));
    await expect(loadMoneroWalletBundle(vault, ALICE_SCOPE)).rejects.toThrow(/corrupt/);
  });

  it('refuses a scope without a valid account', () => {
    expect(() => moneroWalletScope('')).toThrow(/signed-in/);
    expect(() => moneroWalletScope('npub1nothex')).toThrow(/signed-in/);
  });

  it('refuses to read or write while the Workstr vault is locked', async () => {
    const { vault } = fakeVault(false);
    await expect(loadMoneroWalletBundle(vault, ALICE_SCOPE)).rejects.toThrow(/Unlock Workstr/);
    await expect(saveMoneroWalletBundle(vault, {} as never)).rejects.toThrow(/Unlock Workstr/);
  });
});

describe('Monero wallet core', () => {
  it('creates a wallet, dedicated creator subaddress, and vault bundle without using Nostr material', async () => {
    const { vault, writes } = fakeVault(true);
    const fake = runtime();
    const snapshot = await core(vault, fake).createWallet();
    expect(snapshot.metadata.scope).toBe(ALICE_SCOPE);
    expect(snapshot.metadata.restoreHeight).toBe(3_763_261);
    expect(snapshot.metadata.creatorSubaddress).toBe('8CreatorSubaddress');
    expect(fake.configs[0]).toMatchObject({ path: '', networkType: 'mainnet' });
    expect(fake.configs[0]).not.toHaveProperty('restoreHeight');
    expect(fake.configs[0]).not.toHaveProperty('seed');
    expect(JSON.stringify(writes)).not.toContain('nsec');
    expect(JSON.parse(writes[ALICE_SCOPE]).seed).toBe('mock seed words');
  });

  it('records the lower of the runtime and daemon heights for a new wallet', async () => {
    const { vault } = fakeVault(true);
    const wallet = Object.assign(new FakeWallet(), { getRestoreHeight: async () => 3_700_000 });
    const snapshot = await core(vault, runtime(wallet)).createWallet();
    expect(snapshot.metadata.restoreHeight).toBe(3_700_000);
  });

  it('restores from a seed and passes that seed only to the lazy wallet runtime', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime(new FakeWallet('restored seed words'));
    const snapshot = await core(vault, fake).restoreWallet({ seed: ' restored seed words ', restoreHeight: 2_500_000 });
    expect(fake.configs[0]).toMatchObject({ seed: 'restored seed words', restoreHeight: 2_500_000 });
    expect(snapshot.metadata.source).toBe('restored');
  });

  it('restores from the genesis block when no restore height is given', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime(new FakeWallet('old seed'));
    const snapshot = await core(vault, fake).restoreWallet({ seed: 'old seed' });
    expect(fake.configs[0]).toMatchObject({ seed: 'old seed', restoreHeight: 0 });
    expect(snapshot.metadata.restoreHeight).toBe(0);
  });

  it('never overwrites a stored wallet by creating or restoring another', async () => {
    const { vault, writes } = fakeVault(true);
    await core(vault, runtime(new FakeWallet('first seed'))).createWallet();
    const second = runtime(new FakeWallet('second seed'));
    await expect(core(vault, second).createWallet()).rejects.toThrow(/already stored/);
    await expect(core(vault, second).restoreWallet({ seed: 'second seed' })).rejects.toThrow(/already stored/);
    expect(second.configs).toHaveLength(0);
    expect(JSON.parse(writes[ALICE_SCOPE]).seed).toBe('first seed');
  });

  it('refuses to save when a wallet was stored while the runtime was still creating', async () => {
    const { vault, writes } = fakeVault(true);
    const wallet = new FakeWallet('late seed');
    const slow = { runtime: { createWallet: async () => { writes[ALICE_SCOPE] = JSON.stringify(bundle(ALICE_SCOPE, 'first seed')); return wallet; } } };
    await expect(new Core({ vault, account: () => ALICE, runtime: slow.runtime, fetcher: nodeFetcher() }).createWallet()).rejects.toThrow(/already stored/);
    expect(wallet.closed).toBe(true);
    expect(JSON.parse(writes[ALICE_SCOPE]).seed).toBe('first seed');
  });

  it('keeps each account in its own wallet scope', async () => {
    const { vault, writes } = fakeVault(true);
    let account = ALICE;
    const shared = runtime();
    const walletCore = core(vault, shared, () => account);
    await walletCore.createWallet();
    account = BOB;
    await expect(walletCore.hasWallet()).resolves.toBe(false);
    await expect(walletCore.storedAddresses()).resolves.toEqual([]);
    await expect(walletCore.balance()).rejects.toThrow(/Open the Monero wallet/);
    await expect(walletCore.backupInfo()).rejects.toThrow(/scope-not-found/);
    expect(Object.keys(writes).some((scope) => scope.includes(BOB))).toBe(false);
  });

  it('refuses every wallet action while signed out', async () => {
    const { vault } = fakeVault(true);
    const walletCore = core(vault, runtime(), () => null);
    await expect(walletCore.hasWallet()).rejects.toThrow(/Sign in/);
    await expect(walletCore.createWallet()).rejects.toThrow(/Sign in/);
  });

  it('moves a legacy device-wide wallet to the account only on request, then removes the legacy copy', async () => {
    const { vault, writes } = fakeVault(true);
    writes[LEGACY_MONERO_WALLET_SCOPE] = JSON.stringify(bundle(LEGACY_MONERO_WALLET_SCOPE, 'legacy seed'));
    const walletCore = core(vault, runtime());
    await expect(walletCore.hasWallet()).resolves.toBe(false);
    await expect(walletCore.hasLegacyWallet()).resolves.toBe(true);
    const snapshot = await walletCore.claimLegacyWallet();
    expect(snapshot.metadata.scope).toBe(ALICE_SCOPE);
    expect(JSON.parse(writes[ALICE_SCOPE]).seed).toBe('legacy seed');
    expect(writes).not.toHaveProperty(LEGACY_MONERO_WALLET_SCOPE);
  });

  it('does not move a legacy wallet over one the account already has', async () => {
    const { vault, writes } = fakeVault(true);
    writes[LEGACY_MONERO_WALLET_SCOPE] = JSON.stringify(bundle(LEGACY_MONERO_WALLET_SCOPE, 'legacy seed'));
    writes[ALICE_SCOPE] = JSON.stringify(bundle(ALICE_SCOPE, 'account seed'));
    await expect(core(vault, runtime()).claimLegacyWallet()).rejects.toThrow(/already stored/);
    expect(JSON.parse(writes[ALICE_SCOPE]).seed).toBe('account seed');
    expect(writes).toHaveProperty(LEGACY_MONERO_WALLET_SCOPE);
  });

  it('keeps the legacy copy when the account copy cannot be verified', async () => {
    const { vault, writes } = fakeVault(true);
    writes[LEGACY_MONERO_WALLET_SCOPE] = JSON.stringify(bundle(LEGACY_MONERO_WALLET_SCOPE, 'legacy seed'));
    const broken = { ...vault, putSecret: async (scope: string) => { writes[scope] = '{"broken":true}'; } };
    await expect(core(broken, runtime()).claimLegacyWallet()).rejects.toThrow(/unsupported|corrupt/);
    expect(JSON.parse(writes[LEGACY_MONERO_WALLET_SCOPE]).seed).toBe('legacy seed');
  });

  it('updates balance and sync snapshots without rewriting the seed bundle', async () => {
    const { vault, puts } = fakeVault(true);
    const fake = runtime();
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    const bundleWrites = puts.filter((scope) => scope === ALICE_SCOPE).length;
    await expect(walletCore.balance()).resolves.toEqual({ atomicBalance: '123456789', atomicUnlockedBalance: '120000000' });
    await expect(walletCore.sync()).resolves.toMatchObject({ synchronized: true, height: 1234, daemonHeight: 1234 });
    expect(puts.filter((scope) => scope === ALICE_SCOPE).length).toBe(bundleWrites);
    await walletCore.close();
    expect(fake.wallet.closed).toBe(true);
    await expect(walletCore.balance()).rejects.toThrow(/Open the Monero wallet/);
  });

  it('lists the open wallet\'s transactions for Tip Jar activity, and none from a runtime that cannot', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime();
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    await expect(walletCore.transactions()).resolves.toEqual([]);
    const txs: MoneroWalletRuntimeTx[] = [
      { getHash: () => 'in-1', getIsIncoming: () => true, getIncomingAmount: () => 42n, getIsConfirmed: () => true },
      { getHash: () => undefined, getIsIncoming: () => true }
    ];
    Object.assign(fake.wallet, { getTxs: async () => txs });
    await expect(walletCore.transactions()).resolves.toEqual([{ txid: 'in-1', direction: 'in', amountAtomic: '42', state: 'confirmed' }]);
    await expect(walletCore.storedWalletId()).resolves.toMatch(/^monero-/);
    await walletCore.close();
    await expect(walletCore.transactions()).rejects.toThrow(/Open the Monero wallet/);
  });

  it('signs a transfer without broadcasting it, then relays exactly that transaction', async () => {
    const { vault, puts } = fakeVault(true);
    const fake = runtime();
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    const created: unknown[] = [];
    const relayed: string[] = [];
    Object.assign(fake.wallet, {
      createTx: async (config: unknown) => { created.push(config); return { getHash: () => 'tx-1', getFee: () => 30_720_000n, getMetadata: () => 'signed-blob' }; },
      relayTx: async (metadata: string) => { relayed.push(metadata); return 'tx-1'; }
    });
    const prepared = await walletCore.prepareTransfer({ address: ` ${'8'.repeat(95)} `, amountAtomic: '5000000000' });
    expect(created).toEqual([{ accountIndex: 0, address: '8'.repeat(95), amount: 5_000_000_000n, relay: false }]);
    expect(prepared).toEqual({ address: '8'.repeat(95), amountAtomic: '5000000000', feeAtomic: '30720000', metadata: 'signed-blob' });
    expect(relayed).toEqual([]);
    const dataWrites = puts.filter((scope) => scope.startsWith('monero.hot-wallet-data.')).length;
    await expect(walletCore.relayTransfer(prepared)).resolves.toBe('tx-1');
    expect(relayed).toEqual(['signed-blob']);
    // The spent outputs are saved at once, so a restart does not offer them again.
    expect(puts.filter((scope) => scope.startsWith('monero.hot-wallet-data.')).length).toBe(dataWrites + 1);
    await expect(walletCore.prepareTransfer({ address: '8'.repeat(95), amountAtomic: '0' })).rejects.toThrow(/above zero/);
    await walletCore.close();
    await expect(walletCore.relayTransfer(prepared)).rejects.toThrow(/Open the Monero wallet/);
  });

  it('refuses to send from a runtime that cannot create transactions', async () => {
    const { vault } = fakeVault(true);
    const walletCore = core(vault, runtime());
    await walletCore.createWallet();
    await expect(walletCore.prepareTransfer({ address: '8'.repeat(95), amountAtomic: '1' })).rejects.toThrow(/cannot send/);
  });

  it('closes the runtime wallet if vault verification fails during create', async () => {
    const fake = runtime();
    const vault = {
      isUnlocked: () => true,
      hasSecret: async () => false,
      putSecret: async () => undefined,
      getSecret: async () => JSON.stringify({ broken: true }),
      deleteSecret: async () => undefined
    };
    await expect(core(vault, fake).createWallet()).rejects.toThrow(/unsupported|corrupt/);
    expect(fake.wallet.closed).toBe(true);
  });

  it('reopens from the saved sync data instead of rescanning from the seed', async () => {
    const { vault, writes } = fakeVault(true);
    const fake = runtime(new FakeWallet('stored seed words'));
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    await walletCore.sync();
    await walletCore.close();
    const data = JSON.parse(writes[moneroWalletDataScope(ALICE)]);
    expect(data).toMatchObject({ version: 1, keysDataBase64: 'AQID', cacheDataBase64: 'BAU=', lastSync: { height: 1234 } });
    expect(data).not.toHaveProperty('seed');
    const configsBefore = fake.configs.length;
    const reopened = await walletCore.openWallet();
    expect(fake.configs).toHaveLength(configsBefore);
    expect(fake.opened.at(-1)).toMatchObject({ keysData: new Uint8Array([1, 2, 3]), cacheData: new Uint8Array([4, 5]) });
    expect(fake.opened.at(-1)).not.toHaveProperty('seed');
    expect(reopened.sync).toMatchObject({ height: 1234 });
  });

  it('falls back to the seed when the saved sync data cannot be opened', async () => {
    const { vault } = fakeVault(true);
    const fake = runtime(new FakeWallet('stored seed words'));
    fake.runtime.openWallet = async () => { throw new Error('bad keys data'); };
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    await walletCore.close();
    await walletCore.openWallet();
    expect(fake.configs.at(-1)).toMatchObject({ seed: 'stored seed words', restoreHeight: 3_763_261 });
    await expect(walletCore.balance()).resolves.toEqual({ atomicBalance: '123456789', atomicUnlockedBalance: '120000000' });
  });

  it('ignores sync data left by a different wallet id', async () => {
    const { vault, writes } = fakeVault(true);
    const fake = runtime(new FakeWallet('stored seed words'));
    const walletCore = core(vault, fake);
    await walletCore.createWallet();
    await walletCore.close();
    writes[moneroWalletDataScope(ALICE)] = JSON.stringify({ version: 1, walletId: 'someone-else', keysDataBase64: 'AQID', savedAt: 'x' });
    await walletCore.openWallet();
    expect(fake.opened).toHaveLength(0);
    expect(fake.configs.at(-1)).toMatchObject({ seed: 'stored seed words' });
  });

  it('closes a wallet whose open finished after the core was closed', async () => {
    const { vault } = fakeVault(true);
    const wallet = new FakeWallet();
    let finish: () => void = () => undefined;
    const slow: MoneroWalletRuntime = {
      createWallet: async () => wallet,
      openWallet: async () => { await new Promise<void>((resolve) => { finish = resolve; }); return wallet; }
    };
    const walletCore = new Core({ vault, account: () => ALICE, runtime: slow, fetcher: nodeFetcher() });
    await walletCore.createWallet();
    await walletCore.sync();
    await walletCore.close();
    wallet.closed = false;
    const opening = walletCore.openWallet();
    await vi.waitFor(() => expect(typeof finish).toBe('function'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await walletCore.close();
    finish();
    await expect(opening).rejects.toThrow(/closed while it was opening/);
    expect(wallet.closed).toBe(true);
    await expect(walletCore.balance()).rejects.toThrow(/Open the Monero wallet/);
  });

  it('returns recovery backup info only from the unlocked device vault', async () => {
    const { vault } = fakeVault(true);
    const walletCore = core(vault, runtime(new FakeWallet('backup seed words')));
    await walletCore.createWallet();
    await expect(walletCore.backupInfo()).resolves.toEqual({ seed: 'backup seed words', restoreHeight: 3_763_261 });
  });

  it('requires an unlocked Workstr vault before creating or opening the Monero wallet', async () => {
    const { vault } = fakeVault(false);
    const walletCore = core(vault, runtime());
    await expect(walletCore.createWallet()).rejects.toThrow(/Unlock Workstr/);
    await expect(walletCore.openWallet()).rejects.toThrow(/Unlock Workstr/);
  });
});
