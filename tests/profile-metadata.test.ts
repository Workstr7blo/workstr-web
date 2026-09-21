import { describe, expect, it, vi } from 'vitest';
import {
  buildProfileMetadataEvent,
  editableProfileFields,
  fetchProfileMetadataEvent,
  profileMetadataContent,
  publishProfileMetadata
} from '../src/nostr/profile-metadata';
import type { ReplaceablePool } from '../src/nostr/replaceable-event';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';

const PUBKEY = 'a'.repeat(64);

// Everything another client may have written, including a field nobody standardised.
const FULL = {
  name: 'settebello',
  display_name: 'Settebello',
  about: 'Lifts things.',
  nip05: '_@workstr.fit',
  banner: 'https://example.invalid/banner.png',
  website: 'https://example.invalid',
  lud16: 'me@example.invalid',
  lud06: 'lnurl1xyz',
  picture: 'https://example.invalid/old.png',
  x_client_field: { nested: [1, 2] }
};

function kind0(content: Record<string, unknown> | string, tags: string[][] = []): SignedNostrEvent {
  return { id: 'e0', pubkey: PUBKEY, kind: 0, created_at: 10, tags, content: typeof content === 'string' ? content : JSON.stringify(content), sig: 's' };
}

function signer(): Signer & { signEvent: ReturnType<typeof vi.fn> } {
  return {
    type: 'local',
    getPublicKey: async () => PUBKEY,
    signEvent: vi.fn(async (event: UnsignedNostrEvent) => ({ ...event, id: 'new', pubkey: PUBKEY, sig: 'sig' }) as SignedNostrEvent),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  } as unknown as Signer & { signEvent: ReturnType<typeof vi.fn> };
}

function pool(results: Array<Promise<string>> = [Promise.resolve('ok')]): ReplaceablePool & { publish: ReturnType<typeof vi.fn> } {
  return { get: vi.fn(), publish: vi.fn(() => results), close: vi.fn() } as unknown as ReplaceablePool & { publish: ReturnType<typeof vi.fn> };
}

describe('kind:0 profile metadata', () => {
  it('changes only display_name and picture, preserving every other field', () => {
    const event = buildProfileMetadataEvent(kind0(FULL, [['alt', 'profile']]), { displayName: '  Coach  ', picture: 'https://example.invalid/new.png' });
    const content = JSON.parse(event.content);
    expect(event.kind).toBe(0);
    expect(content).toEqual({ ...FULL, display_name: 'Coach', picture: 'https://example.invalid/new.png' });
    // `name` is the username; a new display name is never mirrored into it.
    expect(content.name).toBe('settebello');
    expect(event.tags).toEqual([['alt', 'profile']]);
  });

  it('leaves the field it was not asked to change exactly as it was', () => {
    const content = JSON.parse(buildProfileMetadataEvent(kind0(FULL), { picture: 'https://example.invalid/new.png' }).content);
    expect(content.display_name).toBe('Settebello');
    expect(content.picture).toBe('https://example.invalid/new.png');
  });

  it('creates a profile with only the supported fields for an account that has none', () => {
    const content = JSON.parse(buildProfileMetadataEvent(null, { displayName: 'New' }).content);
    expect(content).toEqual({ display_name: 'New' });
  });

  it('refuses to rebuild content it cannot parse, rather than erase it', () => {
    expect(() => profileMetadataContent(kind0('not json'))).toThrow();
    expect(() => profileMetadataContent(kind0('[1,2]'))).toThrow();
    expect(() => buildProfileMetadataEvent(kind0('not json'), { displayName: 'X' })).toThrow();
  });

  it('shows display_name, falling back to name, in the editor', () => {
    expect(editableProfileFields(kind0(FULL))).toEqual({ displayName: 'Settebello', picture: 'https://example.invalid/old.png' });
    expect(editableProfileFields(kind0({ name: 'only-name' }))).toEqual({ displayName: 'only-name', picture: '' });
    expect(editableProfileFields(kind0({ display_name: '   ', name: 'fallback' })).displayName).toBe('fallback');
    expect(editableProfileFields(null)).toEqual({ displayName: '', picture: '' });
  });

  it('never publishes against a profile nobody managed to read', async () => {
    const sign = signer();
    await expect(publishProfileMetadata(sign, { displayName: 'X' }, { existing: undefined, poolFactory: () => pool() })).rejects.toThrow('not been loaded');
    expect(sign.signEvent).not.toHaveBeenCalled();
  });

  it('signs the merged event and reports which relays accepted it', async () => {
    const sign = signer();
    const relays = pool([Promise.resolve('ok'), Promise.reject(new Error('blocked'))]);
    const result = await publishProfileMetadata(sign, { displayName: 'Coach' }, { existing: kind0(FULL), relays: ['wss://a.example', 'wss://b.example'], poolFactory: () => relays });
    expect(JSON.parse(sign.signEvent.mock.calls[0][0].content)).toEqual({ ...FULL, display_name: 'Coach' });
    expect(result.event.id).toBe('new');
    expect(result.okRelays).toHaveLength(1);
    expect(result.failedRelays.length).toBeGreaterThan(0);
  });

  it('throws when no relay accepted the profile', async () => {
    const relays = pool([Promise.reject(new Error('blocked'))]);
    await expect(publishProfileMetadata(signer(), { displayName: 'Coach' }, { existing: null, relays: ['wss://a.example'], poolFactory: () => relays })).rejects.toThrow('no relay accepted the profile');
  });

  it('passes an unreachable-relay failure through instead of reporting no profile', async () => {
    const query = vi.fn(async (_relays: string[], _pubkey: string, _timeoutMs: number): Promise<null> => { throw new Error("no relay could be reached for the profile lookup"); });
    await expect(fetchProfileMetadataEvent(PUBKEY, ['wss://a.example'], { query })).rejects.toThrow('no relay could be reached');
    expect(query.mock.calls[0][0]).toContain('wss://a.example');
  });
});
