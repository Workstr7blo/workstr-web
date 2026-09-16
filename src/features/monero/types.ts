export type MoneroNetwork = 'mainnet' | 'stagenet' | 'testnet';

export interface MoneroNodeConfig {
  mode: 'workstr' | 'custom' | 'mock-stagenet';
  host: string;
  port: number;
  ssl: boolean;
  network: MoneroNetwork;
}

export interface MoneroDaemonStatus {
  ok: boolean;
  reachable: boolean;
  corsOk: boolean;
  network: MoneroNetwork | null;
  height: number | null;
  synchronized: boolean | null;
  restricted: boolean | null;
  message: string;
}

export interface MoneroLibraryProbe {
  ok: boolean;
  packageName: 'monero-ts';
  exports: string[];
  hasCreateWalletFull: boolean;
  hasDaemonRpc: boolean;
  message: string;
}

export interface MoneroMockWalletMetadata {
  id: string;
  network: 'stagenet';
  restoreHeight: number;
  primaryAddress: string;
  creatorSubaddress: string;
  createdAt: string;
}

export interface MoneroMockWalletSecret {
  version: 1;
  network: 'stagenet';
  seed: string;
  privateSpendKey: string;
  privateViewKey: string;
  metadata: MoneroMockWalletMetadata;
}

export interface MoneroPhase1Report {
  generatedAt: string;
  library: MoneroLibraryProbe;
  defaultNode: MoneroDaemonStatus;
  mockWallet: MoneroMockWalletMetadata;
  conclusion: 'pass-with-blockers' | 'pass' | 'fail';
  blockers: string[];
  nextStep: string;
}

export interface MoneroWalletMetadata {
  version: 1;
  id: string;
  scope: 'monero.hot-wallet';
  network: MoneroNetwork;
  node: MoneroNodeConfig;
  restoreHeight: number;
  primaryAddress: string;
  creatorSubaddress: string;
  creatorSubaddressIndex: number;
  createdAt: string;
  updatedAt: string;
  source: 'created' | 'restored' | 'mock-stagenet';
}

export interface MoneroWalletBalance {
  atomicBalance: string;
  atomicUnlockedBalance: string;
}

export interface MoneroWalletSyncState {
  height: number | null;
  daemonHeight: number | null;
  synchronized: boolean;
  updatedAt: string;
}

export interface MoneroWalletSecretBundle {
  version: 1;
  metadata: MoneroWalletMetadata;
  seed: string;
  privateSpendKey?: string;
  privateViewKey?: string;
  keysDataBase64?: string;
  cacheDataBase64?: string;
  lastBalance?: MoneroWalletBalance;
  lastSync?: MoneroWalletSyncState;
}

export interface MoneroWalletSnapshot {
  metadata: MoneroWalletMetadata;
  balance: MoneroWalletBalance | null;
  sync: MoneroWalletSyncState | null;
}

export interface MoneroWalletBackupInfo {
  seed: string;
  restoreHeight: number;
}

export interface MoneroWalletUiState {
  status: 'unknown' | 'checking' | 'missing' | 'stored' | 'locked' | 'ready' | 'creating' | 'restoring' | 'opening' | 'syncing' | 'error';
  snapshot?: MoneroWalletSnapshot | null;
  backup?: MoneroWalletBackupInfo | null;
  message?: string;
  messageKind?: 'ok' | 'bad';
}

export interface MoneroWalletCreateRequest {
  node?: Partial<MoneroNodeConfig> | null;
  restoreHeight?: number;
  now?: Date;
}

export interface MoneroWalletRestoreRequest extends MoneroWalletCreateRequest {
  seed: string;
}

export interface MoneroWalletRuntimeWallet {
  getSeed(): Promise<string>;
  getPrivateSpendKey?(): Promise<string>;
  getPrivateViewKey?(): Promise<string>;
  getPrimaryAddress(): Promise<string>;
  createSubaddress(accountIdx: number, label?: string): Promise<{ getAddress?: () => string; getIndex?: () => number; address?: string; index?: number }>;
  getBalance(accountIdx?: number, subaddressIdx?: number): Promise<bigint>;
  getUnlockedBalance(accountIdx?: number, subaddressIdx?: number): Promise<bigint>;
  getHeight(): Promise<number>;
  getDaemonHeight(): Promise<number>;
  sync(listenerOrStartHeight?: unknown, startHeight?: number, allowConcurrentCalls?: boolean): Promise<unknown>;
  save(): Promise<void>;
  getPath?(): string | Promise<string>;
  close(save?: boolean): Promise<void>;
}

export interface MoneroWalletRuntime {
  createWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet>;
}
