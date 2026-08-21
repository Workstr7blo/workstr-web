import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_KEY_ADDRESS, BackupKeyUnavailableError, KEY_BYTES, importBackupKey,
  republishBackupKey, resolveBackupKey, type BackupKeyCache, type BackupKeyTransport
} from '../src/nostr/backup-key';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';

const SELF = 'ab'.repeat(32);

// The signer double keeps NIP-44 as an identity function, so a wrapped key is readable in
// the test while still travelling through the real encrypt/decrypt calls.
function fakeSigner(overrides: Partial<Signer> = {}): Signer {
  return {
    type: 'nip07',
    getPublicKey: async () => SELF,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, id: 'id', pubkey: SELF, sig: 'sig' }),
    nip44Encrypt: async (_peer: string, plaintext: string) => plaintext,
    nip44Decrypt: async (_peer: string, ciphertext: string) => ciphertext,
    ...overrides
  };
}

function keyEvent(content: string): SignedNostrEvent {
  return {
    id: 'key-event', pubkey: SELF, sig: 'sig', kind: 30078, created_at: 1,
    tags: [['d', BACKUP_KEY_ADDRESS]], content
  } as SignedNostrEvent;
}

function memoryCache(initial?: string): BackupKeyCache & { value?: string } {
  const cache = {
    value: initial,
    async read() { return cache.value; },
    async write(raw: string) { cache.value = raw; }
  };
  return cache;
}

// A relay that holds at most one key record, exactly like an addressable event.
function memoryTransport(initial: SignedNostrEvent | null = null) {
  const state = {
    event: initial,
    published: [] as string[],
    fetches: 0,
    fetchKeyEvent: async () => { state.fetches += 1; return state.event; },
    publishKeyEvent: async (content: string) => {
      state.published.push(content);
      state.event = keyEvent(content);
      return { accepted: true, reason: 'ok' };
    }
  };
  return state;
}

const rawOf = (base64: string): number => atob(base64).length;

describe('resolving the backup key', () => {
  it('mints one when the relay answers that there is none', async () => {
    const transport = memoryTransport();
    const cache = memoryCache();

    const key = await resolveBackupKey(fakeSigner(), transport, cache);

    expect(key).toBeTruthy();
    expect(transport.published).toHaveLength(1);
    expect(rawOf(transport.published[0])).toBe(KEY_BYTES);
    expect(cache.value).toBe(transport.published[0]);
  });

  it('unwraps the existing key rather than starting a second one', async () => {
    const existing = 'k'.repeat(43) + '=';
    const transport = memoryTransport(keyEvent(existing));
    const cache = memoryCache();

    await resolveBackupKey(fakeSigner(), transport, cache);

    expect(transport.published).toHaveLength(0);
    expect(cache.value).toBe(existing);
  });

  it('costs the signer nothing once the key is cached', async () => {
    const existing = 'k'.repeat(43) + '=';
    const decrypt = vi.fn(async (_peer: string, ciphertext: string) => ciphertext);
    const transport = memoryTransport(keyEvent(existing));

    await resolveBackupKey(fakeSigner({ nip44Decrypt: decrypt }), transport, memoryCache(existing));

    // The whole point of the cache: no unwrap, and no relay round trip either.
    expect(decrypt).not.toHaveBeenCalled();
    expect(transport.fetches).toBe(0);
  });
});

describe('never minting a second key by accident', () => {
  it('refuses to create one when the relay could not be reached', async () => {
    const transport: BackupKeyTransport = {
      fetchKeyEvent: async () => { throw new Error('relay query timed out'); },
      publishKeyEvent: async () => ({ accepted: true, reason: 'ok' })
    };
    const publish = vi.spyOn(transport, 'publishKeyEvent');

    await expect(resolveBackupKey(fakeSigner(), transport, memoryCache()))
      .rejects.toBeInstanceOf(BackupKeyUnavailableError);
    // A key created here would have orphaned whatever the relay already held.
    expect(publish).not.toHaveBeenCalled();
  });

  it('refuses to create one when the signer cannot decrypt the key that exists', async () => {
    const transport = memoryTransport(keyEvent('wrapped'));
    const signer = fakeSigner({ nip44Decrypt: async () => { throw new Error('signer said no'); } });

    await expect(resolveBackupKey(signer, transport, memoryCache()))
      .rejects.toBeInstanceOf(BackupKeyUnavailableError);
    expect(transport.published).toHaveLength(0);
  });

  it('refuses to overwrite a key record it cannot make sense of', async () => {
    const transport = memoryTransport(keyEvent('not-a-key'));

    await expect(resolveBackupKey(fakeSigner(), transport, memoryCache()))
      .rejects.toBeInstanceOf(BackupKeyUnavailableError);
    expect(transport.published).toHaveLength(0);
  });

  it('stops rather than proceeding when the key will not stay on the relay', async () => {
    const transport: BackupKeyTransport = {
      fetchKeyEvent: async () => null,
      publishKeyEvent: async () => ({ accepted: true, reason: 'ok' })
    };

    await expect(resolveBackupKey(fakeSigner(), transport, memoryCache()))
      .rejects.toBeInstanceOf(BackupKeyUnavailableError);
  });

  it('reports a refused publish instead of carrying on with a key nobody else can get', async () => {
    const transport: BackupKeyTransport = {
      fetchKeyEvent: async () => null,
      publishKeyEvent: async () => ({ accepted: false, reason: 'blocked: storage quota reached' })
    };

    await expect(resolveBackupKey(fakeSigner(), transport, memoryCache()))
      .rejects.toThrow(/blocked: storage quota reached/);
  });
});

describe('two fresh devices racing to create a key', () => {
  it('adopts the key the relay kept, not the one it published', async () => {
    const winner = 'w'.repeat(43) + '=';
    let fetches = 0;
    const published: string[] = [];
    const transport: BackupKeyTransport = {
      // Empty when both devices look; by the time this device confirms, the other
      // device's key is the one the relay holds.
      fetchKeyEvent: async () => (fetches++ === 0 ? null : keyEvent(winner)),
      publishKeyEvent: async (content: string) => { published.push(content); return { accepted: true, reason: 'ok' }; }
    };
    const cache = memoryCache();

    await resolveBackupKey(fakeSigner(), transport, cache);

    // The device wrote its own key and then read the relay's answer back over it. Without
    // that second look it would seal every record with a key no other device holds.
    expect(published).toHaveLength(1);
    expect(published[0]).not.toBe(winner);
    expect(cache.value).toBe(winner);
    expect(await importBackupKey(cache.value!)).toBeTruthy();
  });
});

describe('republishing the key', () => {
  it('writes it back so one lost record cannot orphan the backup', async () => {
    const transport = memoryTransport();
    const raw = 'r'.repeat(43) + '=';

    expect(await republishBackupKey(fakeSigner(), transport, raw)).toBe(true);
    expect(transport.published).toEqual([raw]);
  });

  it('is best effort: a device that already has a key keeps backing up', async () => {
    const transport: BackupKeyTransport = {
      fetchKeyEvent: async () => null,
      publishKeyEvent: async () => { throw new Error('relay down'); }
    };

    expect(await republishBackupKey(fakeSigner(), transport, 'r'.repeat(43) + '=')).toBe(false);
  });
});
