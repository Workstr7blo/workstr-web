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
