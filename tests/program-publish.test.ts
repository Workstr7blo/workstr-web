import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { SheetWithExercises } from '../src/db/store';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import { CREATOR_PROGRAM_D_PREFIX } from '../src/nostr/creator-programs';
import { buildCreatorProgramEvent, creatorProgramDTag, normalizeProgramPublishRelays, publishCreatorProgram, summarizeProgramPublishResults, type ProgramPublishPool } from '../src/nostr/program-publish';

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);

function sheet(overrides: Partial<SheetWithExercises> = {}): SheetWithExercises {
  return {
    id: 7,
    slug: 'push-day',
    name: 'Push Day',
    notes: 'Chest and shoulders.',
    difficulty: 'Beast Mode',
    tags: ['hypertrophy', 'push'],
    is_temporary: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    exercises: [
      {
        id: 1,
        sheet_id: 7,
        exercise_slug: 'bench-press',
        exercise_name: 'Bench Press',
        muscle_group: 'Chest',
        image_url: 'https://example.test/bench.png',
        position: 0,
        sets: 4,
        reps: '8',
        rest: 120,
        weight: 60,
        notes: 'pause reps'
      }
    ],
    ...overrides
  };
}

function signer(): Signer {
  return {
    type: 'local',
    getPublicKey: vi.fn(async () => pubkey),
    signEvent: vi.fn(async (event: UnsignedNostrEvent) => finalizeEvent(event, secret)),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  };
}

describe('buildCreatorProgramEvent', () => {
  it('builds a kind:33402 Beast Mode program event with required indexing tags', () => {
    const event = buildCreatorProgramEvent(sheet());
    expect(event.kind).toBe(33402);
    expect(creatorProgramDTag(sheet())).toBe(`${CREATOR_PROGRAM_D_PREFIX}push-day`);
    expect(event.tags).toContainEqual(['d', `${CREATOR_PROGRAM_D_PREFIX}push-day`]);
    expect(event.tags).toContainEqual(['title', 'Push Day']);
    expect(event.tags).toContainEqual(['t', 'workstr']);
    expect(event.tags).toContainEqual(['t', 'beastmode']);
    expect(event.tags).toContainEqual(['t', 'workstr-program']);
    expect(event.tags).toContainEqual(['client', 'Workstr']);
    expect(event.tags).toContainEqual(['difficulty', 'Beast Mode']);
    expect(event.tags).toContainEqual(['t', 'beast-mode']);
    expect(event.tags).toContainEqual(['t', 'hypertrophy']);
    expect(event.tags).toContainEqual(['exercise', 'workstr:exercise:bench-press', 'Bench Press', '60', '8', '120', 'normal']);
    expect(event.content).toBe('Chest and shoulders.');
    expect(JSON.stringify(event)).not.toMatch(/nwc|nostr\+walletconnect|walletconnect/i);
  });

  it('preserves Workstr metadata for Discover/import parsing', () => {
    const metaTag = buildCreatorProgramEvent(sheet()).tags.find((tag) => tag[0] === 'workstr_meta');
    const meta = JSON.parse(metaTag?.[1] || '{}');
    expect(meta).toMatchObject({
      v: 1,
      description: 'Chest and shoulders.',
      difficulty: 'Beast Mode',
      tags: ['hypertrophy', 'push'],
      exercises: [{ address: 'workstr:exercise:bench-press', name: 'Bench Press', sets: 4, reps: '8', restSec: 120 }]
    });
  });
});

describe('normalizeProgramPublishRelays', () => {
  it('dedupes configured public relays and excludes the private sync relay', () => {
    expect(normalizeProgramPublishRelays([
      'wss://nos.lol',
      'wss://relay.workstr.fit',
      'wss://nos.lol',
      'https://example.test/not-a-relay',
      'wss://relay.damus.io'
    ])).toEqual(['wss://nos.lol', 'wss://relay.damus.io']);
  });
});

describe('summarizeProgramPublishResults', () => {
  it('treats nostr-tools connection failure strings as failed publishes', () => {
    expect(summarizeProgramPublishResults(['wss://nos.lol', 'wss://bad.relay'], [
      { status: 'fulfilled', value: 'success' },
      { status: 'fulfilled', value: 'connection failure: Error: websocket failed' }
    ])).toEqual([
      { relay: 'wss://nos.lol', accepted: true, reason: 'success' },
      { relay: 'wss://bad.relay', accepted: false, reason: 'connection failure: Error: websocket failed' }
    ]);
  });
});

describe('publishCreatorProgram', () => {
  it('signs with the active signer, publishes only to public relays, and succeeds with one relay acknowledgement', async () => {
    const activeSigner = signer();
    const published: string[] = [];
    const pool: ProgramPublishPool = {
      publish: (relays) => {
        published.push(...relays);
        return [Promise.resolve('success'), Promise.resolve('connection failure: nope')];
      },
      get: vi.fn(async () => ({ id: 'event' })),
      close: vi.fn()
    };

    const result = await publishCreatorProgram(activeSigner, sheet(), ['wss://nos.lol', 'wss://relay.workstr.fit', 'wss://bad.relay'], { poolFactory: () => pool });

    expect(activeSigner.signEvent).toHaveBeenCalledOnce();
    expect(published).toEqual(['wss://nos.lol', 'wss://bad.relay']);
    expect(result.event.pubkey).toBe(pubkey);
    expect(result.okRelays).toEqual(['wss://nos.lol']);
    expect(result.failedRelays).toEqual(['wss://bad.relay']);
    expect(result.confirmed).toBe(true);
    expect(pool.close).toHaveBeenCalledWith(['wss://nos.lol', 'wss://bad.relay']);
  });

  it('fails when no public relay acknowledges the program', async () => {
    const activeSigner = signer();
    const pool: ProgramPublishPool = {
      publish: () => [Promise.resolve('connection failure: nope')],
      close: vi.fn()
    };
    await expect(publishCreatorProgram(activeSigner, sheet(), ['wss://bad.relay'], { poolFactory: () => pool }))
      .rejects.toThrow('no public relay accepted the program');
  });
});
