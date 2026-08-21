import type { RecordCipher } from '../src/nostr/codecs30078';

export const TEST_PUBKEY = 'ab'.repeat(32);

// Fixed key bytes: a failure reproduces instead of depending on a fresh random key.
const RAW = new Uint8Array(32).map((_, index) => (index * 5 + 1) & 0xff);

export async function testCipher(pubkey = TEST_PUBKEY): Promise<RecordCipher> {
  const key = await crypto.subtle.importKey('raw', RAW, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, pubkey };
}

export async function otherCipher(pubkey = TEST_PUBKEY): Promise<RecordCipher> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(0xee), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, pubkey };
}
