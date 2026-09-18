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
  getTxs?(): Promise<MoneroWalletRuntimeTx[]>;
  // Builds and signs a transfer without broadcasting it (`relay: false`), so the fee can be
  // shown before anything leaves the wallet.
  createTx?(config: { accountIndex: number; address: string; amount: bigint; relay: false }): Promise<MoneroWalletRuntimeCreatedTx>;
  relayTx?(metadata: string): Promise<string>;
  close(save?: boolean): Promise<void>;
}

export interface MoneroWalletRuntime {
  createWallet(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet>;
  openWallet?(config: Record<string, unknown>): Promise<MoneroWalletRuntimeWallet>;
  syncListener?(onProgress: (fraction: number, remainingBlocks: number) => void): object;
}

// Tip Jar activity (#263). Monero provides the transaction, Workstr remembers who a tip was
// for, and Nostr provides the name and picture shown later. The wallet stays the source of
// truth for amount, confirmation and failure; Workstr's own fields only add context.
export type TipJarTransactionState = 'submitted' | 'confirmed' | 'failed';

interface TipJarActivityBase {
  // The txid. One record per transaction, which is also the join key with the wallet.
  id: string;
  txid: string;
  amountAtomic: string;
  createdAt: string;
  state: TipJarTransactionState;
  confirmations?: number;
}

// A creator tip carries the recipient's Nostr pubkey, the durable identity; the name and
// picture snapshots are only a fallback for when no current profile is at hand. A generic
// send (or an outgoing transfer Workstr did not make) has no pubkey.
export interface TipJarOutgoingRecord extends TipJarActivityBase {
  direction: 'out';
  kind: 'tip' | 'send';
  recipientPubkey?: string;
  recipientAddress?: string;
  feeAtomic?: string;
  programAddress?: string;
  programName?: string;
  nameSnapshot?: string;
  pictureSnapshot?: string;
}

// Monero does not say who sent it, so an incoming record has no sender fields at all.
export interface TipJarIncomingRecord extends TipJarActivityBase {
  direction: 'in';
}

export type TipJarActivity = TipJarOutgoingRecord | TipJarIncomingRecord;

// One transaction as the wallet reports it, before any Workstr metadata is joined to it.
export interface TipJarWalletTx {
  txid: string;
  direction: 'in' | 'out';
  amountAtomic: string;
  feeAtomic?: string;
  // Absent when the wallet gives no time (an unconfirmed transfer from some runtimes).
  timestamp?: string;
  state: TipJarTransactionState;
  confirmations?: number;
}

// The subset of monero-ts `MoneroTxWallet` the activity import reads.
export interface MoneroWalletRuntimeTx {
  getHash(): string | undefined;
  getIsIncoming?(): boolean | undefined;
  getIsOutgoing?(): boolean | undefined;
  getIncomingAmount?(): bigint | undefined;
  getOutgoingAmount?(): bigint | undefined;
  getFee?(): bigint | undefined;
  getIsConfirmed?(): boolean | undefined;
  getIsFailed?(): boolean | undefined;
  getNumConfirmations?(): number | undefined;
  getReceivedTimestamp?(): number | undefined;
  getBlock?(): { getTimestamp?(): number | undefined } | undefined;
}

// What `createTx` returns, as far as a send reads it. The metadata is the signed transaction,
// not a secret: it is what gets relayed.
export interface MoneroWalletRuntimeCreatedTx {
  getHash?(): string | undefined;
  getFee?(): bigint | undefined;
  getMetadata?(): string | undefined;
}

// A transfer signed on this device and not yet broadcast.
export interface MoneroPreparedTransfer {
  address: string;
  amountAtomic: string;
  feeAtomic: string;
  metadata: string;
}

// Who a send is for. A creator tip carries the creator's pubkey and program; a plain send is
// only an address the user typed.
export interface MoneroSendRecipient {
  address: string;
  pubkey?: string;
  name?: string;
  picture?: string;
  programAddress?: string;
  programName?: string;
}

// One send sheet, from amount to result. `uncertain` marks a broadcast whose outcome is not
// known: the node may have accepted it, so the sheet never offers to send it again.
export interface MoneroSendState {
  id: number;
  step: 'amount' | 'preparing' | 'review' | 'sending' | 'sent' | 'failed';
  recipient: MoneroSendRecipient | null;
  amountText: string;
  addressText: string;
  prepared?: MoneroPreparedTransfer;
  txid?: string;
  error?: string;
  uncertain?: boolean;
}
