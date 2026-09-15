// Turns a device code into a key-encryption key. Argon2id, because a nine-digit code has only
// a billion values: the cost per guess is the only thing standing between a copied vault and
// the secrets in it, and memory-hard cost is what makes those guesses expensive on a GPU.
//
// Be honest about the ceiling. A billion guesses at a second each is still only a few decades
// on one core, and an attacker with the database is not limited to one core. The code
// protects secrets at rest against casual and opportunistic access; it does not make a
// stolen vault safe forever.
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { normalizeDevicePin } from './device-pin';
import { DeviceVaultError, type DeviceVaultKdfParameters } from './device-vault-types';

export const KEY_ENCRYPTION_KEY_BYTES = 32;

// OWASP Password Storage Cheat Sheet, Argon2id: any one of these rows is an acceptable floor,
// trading memory for iterations. All at parallelism 1.
export const OWASP_ARGON2ID_MINIMUMS: readonly { memoryCost: number; iterations: number }[] = [
  { memoryCost: 47104, iterations: 1 },
  { memoryCost: 19456, iterations: 2 },
  { memoryCost: 12288, iterations: 3 },
  { memoryCost: 9216, iterations: 4 },
  { memoryCost: 7168, iterations: 5 }
];

// The 19 MiB row. Takes about a second on a desktop core and a few on a phone, which is the
// noticeable-but-tolerable cost of a once-per-launch unlock. Stored with every vault, so a
// later release can raise it for new vaults without stranding old ones.
export const DEVICE_VAULT_KDF_PARAMETERS: DeviceVaultKdfParameters = { memoryCost: 19456, iterations: 2, parallelism: 1 };

export function meetsKdfMinimum(parameters: DeviceVaultKdfParameters): boolean {
  const { memoryCost, iterations, parallelism } = parameters;
  if (![memoryCost, iterations, parallelism].every((value) => Number.isSafeInteger(value) && value > 0)) return false;
  return OWASP_ARGON2ID_MINIMUMS.some((row) => memoryCost >= row.memoryCost && iterations >= row.iterations);
}

// Unchecked Argon2id. Exported for tests, which cannot afford the real cost on every case;
// application code goes through `deriveKeyEncryptionKey`, which refuses weak parameters.
export async function argon2idKey(pin: string, salt: Uint8Array, parameters: DeviceVaultKdfParameters): Promise<Uint8Array> {
  const password = new TextEncoder().encode(pin);
  try {
    return await argon2idAsync(password, salt, {
      m: parameters.memoryCost,
      t: parameters.iterations,
      p: parameters.parallelism,
      dkLen: KEY_ENCRYPTION_KEY_BYTES,
      // Yields to the event loop so the unlock screen can say it is working.
      asyncTick: 16
    });
  } catch {
    throw new DeviceVaultError('kdf-failed');
  } finally {
    password.fill(0);
  }
}

// Never silently cheaper. Parameters below the floor are refused whether they come from the
// defaults above or from a stored vault, because the alternative is a fast hash nobody chose.
export async function deriveKeyEncryptionKey(pin: string, salt: Uint8Array, parameters: DeviceVaultKdfParameters): Promise<Uint8Array> {
  normalizeDevicePin(pin);
  if (!meetsKdfMinimum(parameters)) throw new DeviceVaultError('unsupported-crypto');
  return argon2idKey(pin, salt, parameters);
}
