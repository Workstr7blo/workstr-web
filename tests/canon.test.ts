import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { EXERCISE_D_PREFIX, exerciseFromEvent, programFromEvent, selectCanonEvents } from '../src/nostr/canon';

const operatorSecret = generateSecretKey();
const operatorPubkey = getPublicKey(operatorSecret);
const strangerSecret = generateSecretKey();

// Round-trip through JSON like a real relay message: finalizeEvent tags the
// object with nostr-tools' verifiedSymbol, which spread copies and verifyEvent
// short-circuits on — wire events never carry it.
function wire<T>(event: T): T {
  return JSON.parse(JSON.stringify(event));
}

function exerciseEvent(secret: Uint8Array, slug: string, createdAt: number, title = 'Bench Press') {
  return finalizeEvent({
    kind: 33401,
    created_at: createdAt,
    content: 'Press the bar.',
    tags: [
      ['d', `${EXERCISE_D_PREFIX}${slug}`],
      ['title', title],
      ['t', 'workstr'],
      ['workstr_muscle', 'Chest', 'primary']
    ]
  }, secret);
}

describe('selectCanonEvents', () => {
  it('keeps only operator-authored events', () => {
    const ours = exerciseEvent(operatorSecret, 'bench-press', 100);
    const theirs = exerciseEvent(strangerSecret, 'bench-press-fake', 200);
    const selected = selectCanonEvents([ours, theirs], operatorPubkey);
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(ours.id);
  });

  it('rejects events with a forged signature even if the pubkey matches', () => {
    const real = wire(exerciseEvent(operatorSecret, 'bench-press', 100));
    const forged = { ...wire(exerciseEvent(strangerSecret, 'squat', 200)), pubkey: operatorPubkey };
    const selected = selectCanonEvents([real, forged], operatorPubkey);
    expect(selected.map((event) => event.id)).toEqual([real.id]);
  });

  it('dedupes by full address keeping the newest created_at', () => {
    const old = exerciseEvent(operatorSecret, 'bench-press', 100, 'Bench Press');
    const newer = exerciseEvent(operatorSecret, 'bench-press', 300, 'Bench Press v2');
    const other = exerciseEvent(operatorSecret, 'squat', 200, 'Squat');
    const selected = selectCanonEvents([old, newer, other], operatorPubkey);
    expect(selected).toHaveLength(2);
    const bench = selected.find((event) => event.tags.some((tag) => tag[1] === `${EXERCISE_D_PREFIX}bench-press`));
    expect(bench?.created_at).toBe(300);
  });

  it('drops events without a d tag', () => {
    const noD = finalizeEvent({ kind: 33401, created_at: 100, content: '', tags: [['title', 'Nameless']] }, operatorSecret);
    expect(selectCanonEvents([noD], operatorPubkey)).toHaveLength(0);
  });
});

describe('exerciseFromEvent', () => {
  it('maps a canon 33401 event to an importable exercise', () => {
    const event = exerciseEvent(operatorSecret, 'bench-press', 100);
    const exercise = exerciseFromEvent(event);
    expect(exercise?.slug).toBe('bench-press');
    expect(exercise?.name).toBe('Bench Press');
    expect(exercise?.muscle_group).toBe('Chest');
    expect(exercise?.nostr_address).toBe(`33401:${operatorPubkey}:${EXERCISE_D_PREFIX}bench-press`);
    expect(exercise?.source_type).toBe('imported');
  });
});

describe('programFromEvent', () => {
  it('extracts Workstr muscle-map media from 33402 metadata', () => {
    const event = finalizeEvent({
      kind: 33402,
      created_at: 100,
      content: 'Chest and shoulders.',
      tags: [
        ['d', 'workstr:program:push-day'],
        ['title', 'Push Day'],
        ['t', 'workstr'],
        ['exercise', `33401:${operatorPubkey}:workstr:exercise:bench`, 'wss://relay.test', '60', '5', '', 'normal'],
        ['imeta', 'url https://nostr.build/i/push-map.svg', 'm image/svg+xml', 'alt Muscle map for Push Day'],
        ['workstr_muscle_map', 'https://nostr.build/i/push-map.svg'],
        ['workstr_meta', JSON.stringify({ v: 1, description: 'Chest and shoulders.', muscleMapUrl: 'https://nostr.build/i/push-map.svg', exercises: [{ address: `33401:${operatorPubkey}:workstr:exercise:bench`, name: 'Bench Press', sets: 1, reps: '5' }] })]
      ]
    }, operatorSecret);

    const program = programFromEvent(event);
    expect(program?.muscleMapUrl).toBe('https://nostr.build/i/push-map.svg');
  });
});
