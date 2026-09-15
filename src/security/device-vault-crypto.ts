// The vault's cryptography, with no storage attached. Two layers:
//
//   device code -> Argon2id -> key-encryption key -> AES-GCM wraps the random root key
//   root key    -> HKDF(scope, version)           -> AES-GCM key for that scope's record
//
// The code never encrypts a secret directly, so changing it rewraps 32 bytes instead of
// re-encrypting every record, and each scope gets its own key so one module's ciphertext is
// meaningless under another's.
import { DeviceVaultError } from './device-vault-types';

export const ROOT_KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
export const WRAPPED_ROOT_KEY_BYTES = ROOT_KEY_BYTES + GCM_TAG_BYTES;

const DOMAIN = 'workstr-device-vault';
const ROOT_WRAP_AAD = `${DOMAIN}|root|v1`;
const HKDF_SALT = `${DOMAIN}|hkdf|v1`;

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

// The string every scope key is derived from and every record is authenticated against:
// domain, scope and version together, so a record cannot be replayed under another scope or
// read as a different version.
export function scopeLabel(scope: string, version: number): string {
  return `${DOMAIN}|${scope}|v${version}`;
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch {
    throw new DeviceVaultError('unsupported-crypto');
  }
}

export async function wrapRootKey(keyEncryptionKey: Uint8Array<ArrayBuffer>, rootKey: Uint8Array<ArrayBuffer>, nonce = randomBytes(GCM_NONCE_BYTES)): Promise<{ nonce: Uint8Array<ArrayBuffer>; wrapped: Uint8Array<ArrayBuffer> }> {
  const key = await importAesKey(keyEncryptionKey);
  try {
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encode(ROOT_WRAP_AAD) }, key, rootKey));
    return { nonce, wrapped };
  } catch {
    throw new DeviceVaultError('encryption-failed');
  }
}

// An authentication failure here is reported as a wrong code, because that is what it almost
// always is - and a wrapped key that was tampered with is indistinguishable from one.
export async function unwrapRootKey(keyEncryptionKey: Uint8Array<ArrayBuffer>, nonce: Uint8Array<ArrayBuffer>, wrapped: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importAesKey(keyEncryptionKey);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: encode(ROOT_WRAP_AAD) }, key, wrapped));
  } catch {
    throw new DeviceVaultError('incorrect-pin');
  }
}

// Non-extractable: once imported, the unlocked session can derive scope keys but nothing on
// the page can read the root key back out of it.
export async function importRootKey(rootKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', rootKey, 'HKDF', false, ['deriveKey']);
  } catch {
    throw new DeviceVaultError('unsupported-crypto');
  }
}

async function scopeKey(root: CryptoKey, scope: string, version: number): Promise<CryptoKey> {
  try {
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: encode(HKDF_SALT), info: encode(scopeLabel(scope, version)) },
      root,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch {
    throw new DeviceVaultError('unsupported-crypto');
  }
}

export async function sealSecret(root: CryptoKey, scope: string, version: number, plaintext: Uint8Array<ArrayBuffer>, nonce = randomBytes(GCM_NONCE_BYTES)): Promise<{ nonce: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const key = await scopeKey(root, scope, version);
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encode(scopeLabel(scope, version)) }, key, plaintext));
    return { nonce, ciphertext };
  } catch {
    throw new DeviceVaultError('encryption-failed');
  }
}

export async function openSecret(root: CryptoKey, scope: string, version: number, nonce: Uint8Array<ArrayBuffer>, ciphertext: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const key = await scopeKey(root, scope, version);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: encode(scopeLabel(scope, version)) }, key, ciphertext));
  } catch {
    throw new DeviceVaultError('decryption-failed');
  }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
