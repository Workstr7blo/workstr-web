import type { DeviceVault } from '../../security/device-vault';
import { MONERO_WALLET_SCOPE } from './mock-stagenet-wallet';
import type { MoneroWalletSecretBundle, MoneroWalletSnapshot } from './types';

export const MONERO_WALLET_SECRET_VERSION = 1;

function parseSecretBundle(raw: string): MoneroWalletSecretBundle {
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
  if (metadata.scope !== MONERO_WALLET_SCOPE || typeof metadata.id !== 'string' || typeof metadata.primaryAddress !== 'string' || typeof metadata.creatorSubaddress !== 'string') {
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

export async function hasStoredMoneroWallet(vault: Pick<DeviceVault, 'hasSecret'>): Promise<boolean> {
  return vault.hasSecret(MONERO_WALLET_SCOPE);
}

export async function saveMoneroWalletBundle(vault: Pick<DeviceVault, 'isUnlocked' | 'putSecret' | 'getSecret'>, bundle: MoneroWalletSecretBundle): Promise<MoneroWalletSnapshot> {
  ensureUnlocked(vault);
  if (bundle.version !== MONERO_WALLET_SECRET_VERSION || bundle.metadata.scope !== MONERO_WALLET_SCOPE) throw new Error('Invalid Monero wallet bundle.');
  await vault.putSecret(MONERO_WALLET_SCOPE, JSON.stringify(bundle));
  const readBack = parseSecretBundle(await vault.getSecret(MONERO_WALLET_SCOPE));
  if (readBack.metadata.id !== bundle.metadata.id || readBack.seed !== bundle.seed || readBack.metadata.creatorSubaddress !== bundle.metadata.creatorSubaddress) {
    throw new Error('Monero wallet vault verification failed.');
  }
  return snapshotFromBundle(readBack);
}

export async function loadMoneroWalletBundle(vault: Pick<DeviceVault, 'isUnlocked' | 'getSecret'>): Promise<MoneroWalletSecretBundle> {
  ensureUnlocked(vault);
  return parseSecretBundle(await vault.getSecret(MONERO_WALLET_SCOPE));
}

export async function deleteMoneroWalletBundle(vault: Pick<DeviceVault, 'deleteSecret'>): Promise<void> {
  await vault.deleteSecret(MONERO_WALLET_SCOPE);
}

export function snapshotFromBundle(bundle: MoneroWalletSecretBundle): MoneroWalletSnapshot {
  return {
    metadata: { ...bundle.metadata },
    balance: bundle.lastBalance ? { ...bundle.lastBalance } : null,
    sync: bundle.lastSync ? { ...bundle.lastSync } : null
  };
}
