// The Tip Jar's portable backup: everything needed to rebuild this wallet on another device,
// sealed under a password the user chooses.
//
// It is deliberately a separate artifact from the Workstr JSON export. The JSON file holds
// training data and is handed around freely; this file holds spend authority. Putting the seed
// in the training export would mean every copy of a workout log is also a copy of the money,
// and nobody would expect that from a file called "export".
//
// Nothing here talks to the network, the vault or the DOM. It takes a stored wallet bundle and
// a password, and gives back a file - which is what makes it testable and what keeps the seed
// out of every other module.
import { base64ToBytes, bytesToBase64 } from '../../nostr/envelope';
import { argon2idKey, meetsKdfMinimum, DEVICE_VAULT_KDF_PARAMETERS } from '../../security/device-vault-kdf';
import type { DeviceVaultKdfParameters } from '../../security/device-vault-types';
import { parseActivityRecords } from './tip-jar-history';
import type { MoneroNetwork, MoneroWalletSecretBundle, TipJarOutgoingRecord } from './types';

export const TIP_JAR_BACKUP_TYPE = 'workstr-tipjar-backup';
export const TIP_JAR_BACKUP_VERSION = 1;
// Its own extension rather than `.txt` or `.json`, so a phone does not offer to open it in a
// text editor and a user does not "fix" the ciphertext by hand.
export const TIP_JAR_BACKUP_EXTENSION = 'wstrwallet';
// Longer than the device code on purpose. The code guards storage on one device; this password
// guards a file that may be emailed, synced to a cloud drive or kept on a USB stick for years,
// and whoever holds the file can guess against it offline without Workstr ever seeing a try.
// Length is the whole rule: no character classes, which mostly produce predictable passwords.
// Only restoring is exempt, so a backup made under the old eight-character floor still opens.
export const TIP_JAR_BACKUP_MIN_PASSWORD = 12;

// The few twelve-character passwords that would be guessed first. Not a strength meter; just
// the obvious ones a length rule alone would let through.
const WEAK_BACKUP_PASSWORDS = new Set(['password1234', '123456789012', 'qwerty123456', 'passwordpassword', '111111111111', 'qwertyuiopas', 'abcdefghijkl', 'monero123456', 'workstr12345']);

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const NETWORKS: ReadonlyArray<MoneroNetwork> = ['mainnet', 'stagenet', 'testnet'];

// What a restore needs. The restore height is the point of the whole file: without it a
// restored wallet either rescans the entire chain or silently misses earlier payments, and it
// is the one number a user cannot reconstruct from the seed.
export interface TipJarBackupPayload {
  network: MoneroNetwork;
  seed: string;
  restoreHeight: number;
  creatorSubaddressIndex: number;
  creatorSubaddress: string;
  primaryAddress: string;
  createdAt: string;
  // Who each outgoing tip was for, which the chain cannot say. Optional, so files written before
  // Tip Jar activity existed still restore, and files written now still open in those versions.
  activity?: TipJarOutgoingRecord[];
}

export interface TipJarBackupFile {
  type: typeof TIP_JAR_BACKUP_TYPE;
  version: number;
  // Outside the ciphertext so a restore can refuse a stagenet file before asking for a
  // password. It is also authenticated, so it cannot be edited to mean something else.
  network: MoneroNetwork;
  kdf: { name: 'argon2id'; memoryCost: number; iterations: number; parallelism: number; salt: string };
  cipher: 'AES-GCM';
  nonce: string;
  payload: string;
  exportedAt: string;
}

export class TipJarBackupError extends Error {}

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

// Domain, version and network together. A file cannot be replayed as a different version or
// passed off as another network's wallet: either edit breaks the authentication tag.
function additionalData(version: number, network: MoneroNetwork): Uint8Array<ArrayBuffer> {
  return encode(`${TIP_JAR_BACKUP_TYPE}|v${version}|${network}`);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function tipJarBackupFilename(date = new Date()): string {
  return `workstr-tipjar-backup-${date.toISOString().slice(0, 10)}.${TIP_JAR_BACKUP_EXTENSION}`;
}

// Only the fields a restore uses. The stored bundle also carries the private spend and view
// keys, the node configuration and the vault scope of the device it was made on; none of them
// belong in a file that is meant to open on a different device.
export function tipJarBackupPayload(bundle: MoneroWalletSecretBundle): TipJarBackupPayload {
  const { metadata } = bundle;
  return {
    network: metadata.network,
    seed: bundle.seed,
    restoreHeight: metadata.restoreHeight,
    creatorSubaddressIndex: metadata.creatorSubaddressIndex,
    creatorSubaddress: metadata.creatorSubaddress,
    primaryAddress: metadata.primaryAddress,
    createdAt: metadata.createdAt
  };
}

async function backupKey(password: string, salt: Uint8Array<ArrayBuffer>, parameters: DeviceVaultKdfParameters): Promise<CryptoKey> {
  // Never silently cheaper, whether the parameters are this module's defaults or came in on a
  // file someone else wrote. A fast KDF here is a seed recoverable by dictionary attack.
  if (!meetsKdfMinimum(parameters)) throw new TipJarBackupError('This backup uses password settings Workstr will not accept.');
  const raw = await argon2idKey(password, salt, parameters);
  try {
    return await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

export function assertBackupPassword(password: string, confirmation?: string): void {
  if (password.length < TIP_JAR_BACKUP_MIN_PASSWORD) throw new TipJarBackupError(`Use a backup password of at least ${TIP_JAR_BACKUP_MIN_PASSWORD} characters.`);
  if (WEAK_BACKUP_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) throw new TipJarBackupError('That password is too easy to guess. A few unrelated words work well.');
  if (confirmation !== undefined && password !== confirmation) throw new TipJarBackupError('The two passwords do not match.');
}

export async function encryptTipJarBackup(payload: TipJarBackupPayload, password: string, now = new Date()): Promise<TipJarBackupFile> {
  assertBackupPassword(password);
  const parameters = DEVICE_VAULT_KDF_PARAMETERS;
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = await backupKey(password, salt, parameters);
  const plaintext = encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(TIP_JAR_BACKUP_VERSION, payload.network) },
    key,
    plaintext
  ));
  plaintext.fill(0);
  return {
    type: TIP_JAR_BACKUP_TYPE,
    version: TIP_JAR_BACKUP_VERSION,
    network: payload.network,
    kdf: { name: 'argon2id', memoryCost: parameters.memoryCost, iterations: parameters.iterations, parallelism: parameters.parallelism, salt: bytesToBase64(salt) },
    cipher: 'AES-GCM',
    nonce: bytesToBase64(nonce),
    payload: bytesToBase64(ciphertext),
    exportedAt: now.toISOString()
  };
}

// Everything a file claims about itself is checked before a password is asked for, so an
// unsupported or damaged file fails with a reason rather than as "wrong password".
export function parseTipJarBackupFile(text: string): TipJarBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TipJarBackupError('That file is not a Workstr Tip Jar backup.');
  }
  const file = parsed as Partial<TipJarBackupFile> | null;
  if (!file || typeof file !== 'object' || file.type !== TIP_JAR_BACKUP_TYPE) throw new TipJarBackupError('That file is not a Workstr Tip Jar backup.');
  if (file.version !== TIP_JAR_BACKUP_VERSION) throw new TipJarBackupError('That backup was made by a newer version of Workstr.');
  if (file.cipher !== 'AES-GCM' || file.kdf?.name !== 'argon2id') throw new TipJarBackupError('That backup uses an unsupported format.');
  if (!NETWORKS.includes(file.network as MoneroNetwork)) throw new TipJarBackupError('That backup is for an unsupported Monero network.');
  if (typeof file.nonce !== 'string' || typeof file.payload !== 'string' || typeof file.kdf.salt !== 'string') throw new TipJarBackupError('That backup file is damaged.');
  return file as TipJarBackupFile;
}

export async function decryptTipJarBackup(text: string, password: string): Promise<TipJarBackupPayload> {
  const file = parseTipJarBackupFile(text);
  const salt = base64ToBytes(file.kdf.salt);
  const nonce = base64ToBytes(file.nonce);
  const ciphertext = base64ToBytes(file.payload);
  if (!salt || !nonce || !ciphertext) throw new TipJarBackupError('That backup file is damaged.');
  const key = await backupKey(password, salt, { memoryCost: file.kdf.memoryCost, iterations: file.kdf.iterations, parallelism: file.kdf.parallelism });
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: additionalData(file.version, file.network) }, key, ciphertext);
  } catch {
    // A tampered file and a wrong password are indistinguishable here, and a wrong password is
    // what it nearly always is.
    throw new TipJarBackupError('That backup password is not right.');
  }
  // Best effort only. The decoded JSON is a JavaScript string, which cannot be overwritten, so
  // the recovery phrase stays in memory until it is collected; the byte copy at least does not.
  const bytes = new Uint8Array(plaintext);
  try {
    return assertBackupPayload(new TextDecoder().decode(bytes), file.network);
  } finally {
    bytes.fill(0);
  }
}

function assertBackupPayload(json: string, network: MoneroNetwork): TipJarBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TipJarBackupError('That backup file is damaged.');
  }
  const payload = parsed as Partial<TipJarBackupPayload> | null;
  if (!payload || typeof payload.seed !== 'string' || !payload.seed.trim()) throw new TipJarBackupError('That backup has no recovery phrase in it.');
  if (payload.network !== network) throw new TipJarBackupError('That backup file is damaged.');
  if (typeof payload.restoreHeight !== 'number' || !Number.isInteger(payload.restoreHeight) || payload.restoreHeight < 0) throw new TipJarBackupError('That backup has no usable restore height.');
  return {
    network,
    seed: payload.seed.trim(),
    restoreHeight: payload.restoreHeight,
    creatorSubaddressIndex: typeof payload.creatorSubaddressIndex === 'number' ? payload.creatorSubaddressIndex : 1,
    creatorSubaddress: typeof payload.creatorSubaddress === 'string' ? payload.creatorSubaddress : '',
    primaryAddress: typeof payload.primaryAddress === 'string' ? payload.primaryAddress : '',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : '',
    activity: parseActivityRecords(payload.activity).filter((record): record is TipJarOutgoingRecord => record.direction === 'out')
  };
}
