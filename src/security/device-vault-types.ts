// Vocabulary of the device vault: what it stores, the states it can be in, and the errors it
// raises. No behaviour lives here, so the vault, the key derivation and the screens can all
// share it without importing each other.

export const DEVICE_VAULT_DATABASE = 'workstr-device-vault-v1';
export const DEVICE_VAULT_VERSION = 1;
export const DEVICE_VAULT_RECORD_VERSION = 1;

export interface DeviceVaultKdfParameters {
  /** Kibibytes. */
  memoryCost: number;
  iterations: number;
  parallelism: number;
}

// Nothing in here can open the vault on its own: the root key is only present wrapped under
// a key derived from the device code, and the code itself is never written anywhere.
export interface DeviceVaultMetadata {
  id: 'active';
  version: 1;
  kdf: 'argon2id';
  salt: string;
  kdfParameters: DeviceVaultKdfParameters;
  wrappingNonce: string;
  wrappedRootKey: string;
  createdAt: number;
  updatedAt: number;
}

// One record per scope. The scope is the key path, so records for unrelated modules - the
// Nostr identity today, a Monero wallet later - are stored, replaced and deleted independently.
export interface DeviceVaultSecretRecord {
  scope: string;
  version: number;
  nonce: string;
  ciphertext: string;
  savedAt: number;
}

export type DeviceVaultStatus =
  | 'absent'
  | 'setup-required'
  | 'locked'
  | 'unlocking'
  | 'unlocked'
  | 'error';

export type DeviceVaultErrorCode =
  | 'unavailable'
  | 'unsupported-crypto'
  | 'invalid-pin'
  | 'incorrect-pin'
  | 'corrupt-metadata'
  | 'corrupt-record'
  | 'unsupported-version'
  | 'kdf-failed'
  | 'encryption-failed'
  | 'decryption-failed'
  | 'migration-failed'
  | 'scope-not-found'
  | 'vault-exists'
  | 'locked';

// Fixed strings on purpose. A message built from the failing value is how a PIN, a key or a
// decrypted payload ends up in a toast, a log or a bug report.
const MESSAGES: Record<DeviceVaultErrorCode, string> = {
  unavailable: 'Secure storage is unavailable on this device.',
  'unsupported-crypto': 'This browser cannot protect secrets with a device code.',
  'invalid-pin': 'Enter exactly nine digits.',
  'incorrect-pin': 'That device code is incorrect.',
  'corrupt-metadata': 'The device vault on this device could not be read.',
  'corrupt-record': 'A protected secret on this device could not be read.',
  'unsupported-version': 'The device vault was written by a newer version of Workstr.',
  'kdf-failed': 'The device code could not be processed.',
  'encryption-failed': 'The secret could not be protected.',
  'decryption-failed': 'A protected secret on this device could not be opened.',
  'migration-failed': 'Protection could not be enabled.',
  'scope-not-found': 'That secret is not stored on this device.',
  'vault-exists': 'A device vault already exists on this device.',
  locked: 'Unlock Workstr first.'
};

export class DeviceVaultError extends Error {
  readonly code: DeviceVaultErrorCode;
  constructor(code: DeviceVaultErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'DeviceVaultError';
    this.code = code;
  }
}

export function isDeviceVaultError(error: unknown, code?: DeviceVaultErrorCode): error is DeviceVaultError {
  return error instanceof DeviceVaultError && (!code || error.code === code);
}
