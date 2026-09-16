import type { DeviceVault } from '../../security/device-vault';
import { MONERO_WALLET_SCOPE } from './mock-stagenet-wallet';
import type { MoneroWalletDataRecord, MoneroWalletSecretBundle, MoneroWalletSnapshot } from './types';

export const MONERO_WALLET_SECRET_VERSION = 1;

// One wallet per Nostr account. A wallet shared between identities would link them on this
// device, so sharing is only ever the user's deliberate act (restoring the same seed twice).
// The earlier device-wide scope is kept as the legacy name an account may adopt.
export const LEGACY_MONERO_WALLET_SCOPE = MONERO_WALLET_SCOPE;
const WALLET_SCOPE_PREFIX = `${MONERO_WALLET_SCOPE}.`;
const DATA_SCOPE_PREFIX = 'monero.hot-wallet-data.';

function accountKey(pubkey: string): string {
  const key = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('A signed-in Nostr account is required for the Monero wallet.');
  return key;
}

export function moneroWalletScope(pubkey: string): string {
  return `${WALLET_SCOPE_PREFIX}${accountKey(pubkey)}`;
}

// The keys and scan cache live beside the seed bundle, not inside it: they are rewritten after
// every sync, and the seed bundle should only be rewritten when it genuinely changes.
export function moneroWalletDataScope(pubkey: string): string {
  return `${DATA_SCOPE_PREFIX}${accountKey(pubkey)}`;
}

export function isMoneroWalletScope(scope: string): boolean {
  return scope === LEGACY_MONERO_WALLET_SCOPE || scope.startsWith(WALLET_SCOPE_PREFIX);
}

export function isMoneroWalletDataScope(scope: string): boolean {
  return scope.startsWith(DATA_SCOPE_PREFIX);
}

function parseSecretBundle(raw: string, scope: string): MoneroWalletSecretBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored Monero wallet metadata is corrupt.');
  }
  const bundle = parsed as Partial<MoneroWalletSecretBundle> | null;
  const metadata = bundle?.metadata;
  if (!bundle || bundle.version !== MONERO_WALLET_SECRET_VERSION || !metadata || metadata.version !== MONERO_WALLET_SECRET_VERSION) {
    throw new Error('Stored Monero wallet metadata is unsupported.');
  }
  if (metadata.scope !== scope || typeof metadata.id !== 'string' || typeof metadata.primaryAddress !== 'string' || typeof metadata.creatorSubaddress !== 'string') {
    throw new Error('Stored Monero wallet metadata is corrupt.');
  }
  if (!['mainnet', 'stagenet', 'testnet'].includes(metadata.network)) throw new Error('Stored Monero wallet network is unsupported.');
  if (typeof metadata.restoreHeight !== 'number' || metadata.restoreHeight < 0) throw new Error('Stored Monero wallet restore height is corrupt.');
  if (typeof bundle.seed !== 'string' || !bundle.seed.trim()) throw new Error('Stored Monero wallet seed is missing.');
  return bundle as MoneroWalletSecretBundle;
}

function ensureUnlocked(vault: Pick<DeviceVault, 'isUnlocked'>): void {
  if (!vault.isUnlocked()) throw new Error('Unlock Workstr before using the Monero wallet.');
}

export async function hasStoredMoneroWallet(vault: Pick<DeviceVault, 'hasSecret'>, scope: string): Promise<boolean> {
  return vault.hasSecret(scope);
}

export async function saveMoneroWalletBundle(vault: Pick<DeviceVault, 'isUnlocked' | 'putSecret' | 'getSecret'>, bundle: MoneroWalletSecretBundle): Promise<MoneroWalletSnapshot> {
  ensureUnlocked(vault);
  const scope = bundle.metadata.scope;
  if (bundle.version !== MONERO_WALLET_SECRET_VERSION || !isMoneroWalletScope(scope)) throw new Error('Invalid Monero wallet bundle.');
  await vault.putSecret(scope, JSON.stringify(bundle));
  const readBack = parseSecretBundle(await vault.getSecret(scope), scope);
  if (readBack.metadata.id !== bundle.metadata.id || readBack.seed !== bundle.seed || readBack.metadata.creatorSubaddress !== bundle.metadata.creatorSubaddress) {
    throw new Error('Monero wallet vault verification failed.');
  }
  return snapshotFromBundle(readBack);
}

export async function loadMoneroWalletBundle(vault: Pick<DeviceVault, 'isUnlocked' | 'getSecret'>, scope: string): Promise<MoneroWalletSecretBundle> {
  ensureUnlocked(vault);
  return parseSecretBundle(await vault.getSecret(scope), scope);
}

export async function deleteMoneroWalletBundle(vault: Pick<DeviceVault, 'deleteSecret'>, scope: string): Promise<void> {
  await vault.deleteSecret(scope);
}

export async function saveMoneroWalletData(vault: Pick<DeviceVault, 'isUnlocked' | 'putSecret'>, scope: string, record: MoneroWalletDataRecord): Promise<void> {
  ensureUnlocked(vault);
  if (!isMoneroWalletDataScope(scope)) throw new Error('Invalid Monero wallet data scope.');
  await vault.putSecret(scope, JSON.stringify(record));
}

// Missing, unreadable, or belonging to another wallet id all mean the same thing to the
// caller: there is no usable record, so open from the seed instead.
export async function loadMoneroWalletData(vault: Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'getSecret'>, scope: string, walletId: string): Promise<MoneroWalletDataRecord | null> {
  ensureUnlocked(vault);
  try {
    if (!await vault.hasSecret(scope)) return null;
    const record = JSON.parse(await vault.getSecret(scope)) as Partial<MoneroWalletDataRecord> | null;
    if (!record || record.version !== 1 || record.walletId !== walletId) return null;
    return record as MoneroWalletDataRecord;
  } catch {
    return null;
  }
}

export function snapshotFromBundle(bundle: MoneroWalletSecretBundle): MoneroWalletSnapshot {
  return {
    metadata: { ...bundle.metadata },
    balance: bundle.lastBalance ? { ...bundle.lastBalance } : null,
    sync: bundle.lastSync ? { ...bundle.lastSync } : null
  };
}
