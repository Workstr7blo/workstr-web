import type { DeviceVault } from '../../security/device-vault';
import type { MoneroMockWalletMetadata, MoneroMockWalletSecret } from './types';

export const MONERO_WALLET_SCOPE = 'monero.hot-wallet';

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const output = new Uint8Array(bytes);
  crypto.getRandomValues(output);
  return hex(output);
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function randomBase58(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => BASE58[byte % BASE58.length]).join('');
}

function fakeStagenetAddress(prefix: string): string {
  return `${prefix}${randomBase58(94)}`;
}

export function createMockStagenetWallet(restoreHeight = 2_800_000, now = new Date()): MoneroMockWalletSecret {
  const seed = `stagenet-mock-seed-${randomHex(32)}`;
  const metadata: MoneroMockWalletMetadata = {
    id: `mock-stagenet-${randomHex(8)}`,
    network: 'stagenet',
    restoreHeight,
    primaryAddress: fakeStagenetAddress('5'),
    creatorSubaddress: fakeStagenetAddress('7'),
    createdAt: now.toISOString()
  };
  return {
    version: 1,
    network: 'stagenet',
    seed,
    privateSpendKey: randomHex(32),
    privateViewKey: randomHex(32),
    metadata
  };
}

export async function storeMockWalletInVault(vault: Pick<DeviceVault, 'isUnlocked' | 'putSecret' | 'getSecret'>, wallet = createMockStagenetWallet()): Promise<MoneroMockWalletMetadata> {
  if (!vault.isUnlocked()) throw new Error('Unlock Workstr before storing the Monero wallet.');
  await vault.putSecret(MONERO_WALLET_SCOPE, JSON.stringify(wallet));
  const readBack = JSON.parse(await vault.getSecret(MONERO_WALLET_SCOPE)) as MoneroMockWalletSecret;
  if (readBack.seed !== wallet.seed || readBack.metadata.creatorSubaddress !== wallet.metadata.creatorSubaddress) {
    throw new Error('Monero wallet vault verification failed.');
  }
  return readBack.metadata;
}
