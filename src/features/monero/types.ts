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
  // `monero.hot-wallet.<account pubkey>`; plain `monero.hot-wallet` only on a legacy bundle.
  scope: string;
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
  // Written only by wallets saved before the data record existed.
  lastBalance?: MoneroWalletBalance;
  lastSync?: MoneroWalletSyncState;
}

// The runtime's keys and scan cache, so an open resumes where the last sync stopped instead
// of rescanning from the restore height. Tied to one wallet id; any other id is ignored.
export interface MoneroWalletDataRecord {
  version: 1;
  walletId: string;
  keysDataBase64?: string;
  cacheDataBase64?: string;
  lastBalance?: MoneroWalletBalance;
  lastSync?: MoneroWalletSyncState;
  savedAt: string;
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
  status: 'unknown' | 'checking' | 'missing' | 'stored' | 'locked' | 'ready' | 'creating' | 'restoring' | 'opening' | 'syncing' | 'claiming' | 'error';
  // Whether this account has a wallet in the vault. Create and restore are offered only when
  // it does not, so a failed open can never lead to overwriting a stored seed.
  stored?: boolean;
  // A wallet saved under the old device-wide scope that this account has not adopted.
  legacyAvailable?: boolean;
  // The stored wallet's public addresses, to tell whether the published tip address is its own.
  addresses?: string[];
  // 0..1 while a sync runs, from the runtime's own progress reports.
  syncProgress?: number;
  snapshot?: MoneroWalletSnapshot | null;
  backup?: MoneroWalletBackupInfo | null;
  message?: string;
  messageKind?: 'ok' | 'bad';
}

// The Tip Jar backup controls inside Data & Sync. Which panel is open, and whether Advanced
// recovery is expanded, are kept here rather than read back off the DOM: the section is
// rewritten in place whenever the wallet moves, and a reader halfway through typing a backup
// password should not lose the form to a sync tick.
export interface TipJarBackupUiState {
  panel: 'idle' | 'export' | 'restore';
  advanced: boolean;
  busy: boolean;
  // The chosen file's name and contents, held only until the restore runs.
  fileName?: string;
  fileText?: string;
  message?: string;
  messageKind?: 'ok' | 'bad';
  // When this device last wrote a backup file. Device-local: Workstr cannot know whether the
  // user still has the file, so the copy says when, never "protected".
  exportedAt?: string;
}

export interface MoneroWalletCreateRequest {
  node?: Partial<MoneroNodeConfig> | null;
  restoreHeight?: number;
  now?: Date;
}

export interface MoneroWalletRestoreRequest extends MoneroWalletCreateRequest {
  seed: string;
  // Replaces the wallet already stored for this account. Off by default: a restore that
  // silently overwrote a stored seed would destroy the only copy of someone's money.
  replace?: boolean;
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
  getData?(): Promise<ArrayLike<number>[]>;
  getRestoreHeight?(): Promise<number>;
  close(save?: boolean): Promise<void>;
}

export interface MoneroWalletRuntime {
  createWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet>;
  openWallet?(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet>;
  syncListener?(onProgress: (fraction: number, remainingBlocks: number) => void): object;
}
