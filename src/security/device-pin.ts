// The device code: exactly nine ASCII digits. It is shown in three groups of three, but it
// is one value, and everything past the input boxes handles it as nine uninterrupted digits.
import { DeviceVaultError } from './device-vault-types';

export const DEVICE_PIN_LENGTH = 9;
export const DEVICE_PIN_GROUP = 3;

// Strict rather than forgiving. Stripping spaces or accepting full-width digits would make two
// different key strokes unlock the same vault on one keyboard and not on another.
export function isDevicePin(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{9}$/.test(value);
}

export function normalizeDevicePin(value: unknown): string {
  if (!isDevicePin(value)) throw new DeviceVaultError('invalid-pin');
  return value;
}

export function joinDevicePinGroups(groups: readonly string[]): string {
  return groups.join('');
}
