import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { SheetWithExercises } from '../src/db/store';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import { CREATOR_PROGRAM_D_PREFIX } from '../src/nostr/creator-programs';
import type { Event } from 'nostr-tools';
import { programFromEvent } from '../src/nostr/canon';
import { planProgramImport } from '../src/nostr/programImport';
import { programTaxonomy } from '../src/features/sheets/program-labels';
import { buildCreatorProgramEvent, creatorProgramDTag, creatorProgramFingerprint, normalizeProgramPublishRelays, publishCreatorProgram, summarizeProgramPublishResults, type ProgramPublishPool } from '../src/nostr/program-publish';

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const NWC_WALLET_PUBKEY = 'a'.repeat(64);
const NWC_HEX_SECRET = 'b'.repeat(64);
const NWC_URI = `nostr+walletconnect://${NWC_WALLET_PUBKEY}?relay=wss%3A%2F%2Fwallet.example.test&secret=${NWC_HEX_SECRET}`;

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

  it('rejects wallet connection strings and secret keys before public event serialization', () => {
    const unsafeSheets = [
      sheet({ notes: `Do not publish ${NWC_URI}` }),
      sheet({ tags: ['hypertrophy', `secret=${NWC_HEX_SECRET}`] }),
      sheet({ exercises: [{ ...sheet().exercises[0], notes: `walletconnect ${NWC_HEX_SECRET}` }] })
    ];

    for (const unsafeSheet of unsafeSheets) {
      expect(() => buildCreatorProgramEvent(unsafeSheet)).toThrow('Creator program publish blocked');
      try {
        buildCreatorProgramEvent(unsafeSheet);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(NWC_URI);
        expect(message).not.toContain(NWC_HEX_SECRET);
        expect(message).not.toContain('secret=');
      }
    }
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

  it('rejects wallet connection strings and secret keys before signing or publishing', async () => {
    const activeSigner = signer();
    const poolFactory = vi.fn<() => ProgramPublishPool>(() => ({
      publish: vi.fn(() => [Promise.resolve('success')]),
      close: vi.fn()
    }));

    await expect(publishCreatorProgram(activeSigner, sheet({ notes: NWC_URI }), ['wss://nos.lol'], { poolFactory }))
      .rejects.toThrow('Creator program publish blocked');
    expect(activeSigner.signEvent).not.toHaveBeenCalled();
    expect(poolFactory).not.toHaveBeenCalled();
  });
});

describe('creatorProgramDTag', () => {
  it('keeps the d tag a program was already published under when the local slug differs', () => {
    const address = `33402:${pubkey}:${CREATOR_PROGRAM_D_PREFIX}push-day`;
    expect(creatorProgramDTag(sheet({ slug: 'push-day-2', nostr_address: address }))).toBe(`${CREATOR_PROGRAM_D_PREFIX}push-day`);
    expect(buildCreatorProgramEvent(sheet({ slug: 'push-day-2', nostr_address: address })).tags).toContainEqual(['d', `${CREATOR_PROGRAM_D_PREFIX}push-day`]);
  });

  it('uses the slug when the stored address is not a creator program', () => {
    expect(creatorProgramDTag(sheet({ nostr_address: '33402:op:workstr:program:legs' }))).toBe(`${CREATOR_PROGRAM_D_PREFIX}push-day`);
  });
});

describe('creatorProgramFingerprint', () => {
  it('ignores what the event does not carry', () => {
    const base = sheet();
    const resaved: SheetWithExercises = { ...base, updated_at: '2026-09-01T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z' };
    expect(creatorProgramFingerprint(resaved)).toBe(creatorProgramFingerprint(base));
    expect(creatorProgramFingerprint({ ...base, exercises: base.exercises.map((row) => ({ ...row, id: 500, sheet_id: 900 })) })).toBe(creatorProgramFingerprint(base));
  });

  it('changes with public content', () => {
    const base = sheet();
    expect(creatorProgramFingerprint({ ...base, name: 'Pull Day' })).not.toBe(creatorProgramFingerprint(base));
    expect(creatorProgramFingerprint({ ...base, notes: 'Different.' })).not.toBe(creatorProgramFingerprint(base));
    expect(creatorProgramFingerprint({ ...base, exercises: base.exercises.map((row) => ({ ...row, sets: 9 })) })).not.toBe(creatorProgramFingerprint(base));
  });

  it('matches the import snapshot of its own published event', () => {
    const base = sheet();
    const event = { ...buildCreatorProgramEvent(base), pubkey, id: 'e'.repeat(64), sig: '' } as Event;
    const program = programFromEvent(event);
    expect(program).toBeTruthy();
    const snapshot = planProgramImport(program!, [], []).sheet;
    expect(creatorProgramFingerprint(snapshot)).toBe(creatorProgramFingerprint(base));
  });
});

describe('program taxonomy through publish and parse', () => {
  it('publishes goals as t tags and in workstr_meta, and parses unknown tags without making them goals', () => {
    const event = { ...buildCreatorProgramEvent(sheet({ tags: ['endurance', 'kettlebell-flow'], difficulty: 'Beginner' })), pubkey, id: 'e'.repeat(64), sig: '' } as Event;
    expect(event.tags).toEqual(expect.arrayContaining([['t', 'endurance'], ['t', 'kettlebell-flow']]));
    expect(JSON.parse(event.tags.find((tag) => tag[0] === 'workstr_meta')![1]).tags).toEqual(['endurance', 'kettlebell-flow']);
    const program = programFromEvent(event)!;
    expect(program.tags).toEqual(['endurance', 'kettlebell-flow']);
    expect(program.difficulty).toBe('Beginner');
    const taxonomy = programTaxonomy(program, []);
    expect(taxonomy.goals).toEqual(['endurance']);
    expect(taxonomy.level).toBe('beginner');
  });
});

describe('EMOM section length through publish and parse', () => {
  it('keeps totalDurationSec on the block and leaves a legacy block without it', () => {
    const timed = [{ type: 'emom' as const, rounds: 5, totalDurationSec: 600, intervals: [
      { durationSec: 60, steps: [{ exerciseSlug: 'bench-press' }] },
      { durationSec: 60, steps: [{ exerciseSlug: 'row' }] }
    ] }];
    const parsed = programFromEvent({ ...buildCreatorProgramEvent(sheet({ blocks: timed })), pubkey, id: 'e'.repeat(64), sig: '' } as Event);
    expect(parsed?.blocks).toEqual(timed);
    const legacy = [{ type: 'emom' as const, rounds: 10, intervals: timed[0].intervals }];
    const parsedLegacy = programFromEvent({ ...buildCreatorProgramEvent(sheet({ blocks: legacy })), pubkey, id: 'f'.repeat(64), sig: '' } as Event);
    expect(parsedLegacy?.blocks?.[0]).not.toHaveProperty('totalDurationSec');
    expect(parsedLegacy?.blocks?.[0]).toMatchObject({ rounds: 10 });
  });
});
