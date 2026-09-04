import { describe, expect, it } from 'vitest';
import {
  estimateProgramMin, resolveProgramExercise, programExerciseName, inferProgramMuscle,
  programGroups, programMuscleSets, programAuthor, isLocalProgram, localSheetId, sheetToProgram, programCard, programBody, emomBlockFromBuilder, emomBlocksFromBuilder, straightBlocksFromBuilder, standardProgramExercises, inferProgramLabels, programDisplayTags
} from '../src/features/sheets/views';
import type { Exercise } from '../src/core/types';
import type { RelayProgram, RelayProgramExercise } from '../src/nostr/canon';
import type { SheetWithExercises } from '../src/db/store';
import type { AppState } from '../src/app/state';
import { displayPubkey } from '../src/app/format';

function ex(partial: Partial<Exercise>): Exercise {
  return {
    slug: 'x', name: 'X', muscles: [], equipment: [], tags: [], instructions: [],
    favourite: false, source_type: 'manual', status: 'active', ...partial
  } as Exercise;
}

function member(partial: Partial<RelayProgramExercise>): RelayProgramExercise {
  return { address: '', ...partial };
}

function prog(partial: Partial<RelayProgram>): RelayProgram {
  return {
    slug: 's', name: 'P', description: '', tags: [], sourceLabel: '', eventId: '',
    pubkey: '', address: 'local:1', createdAt: 0, exercises: [], ...partial
  };
}

describe('estimateProgramMin', () => {
  it('sums per-set work plus inter-set rest, with defaults', () => {
    // 3 sets * 45s work + 2 rests * 90s = 135 + 180 = 315
    expect(estimateProgramMin([member({})])).toBe(315);
    // 2 sets * 45 + 1 rest * 60 = 90 + 60 = 150
    expect(estimateProgramMin([member({ sets: 2, restSec: 60 })])).toBe(150);
  });
  it('honours the rest alias field', () => {
    expect(estimateProgramMin([member({ sets: 2, rest: 30 })])).toBe(120);
  });
  it('counts EMOM sections alone when every member is EMOM work', () => {
    const blocks: RelayProgram['blocks'] = [
      { type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'sit-up', exerciseName: 'Sit Up' }] }] }
    ];
    expect(estimateProgramMin([member({ name: 'Sit Up' })], blocks)).toBe(180);
    expect(estimateProgramMin([member({ address: '33401:pk:workstr:exercise:sit-up' })], blocks)).toBe(180);
  });
  it('adds the strength half to the EMOM sections for a mixed program', () => {
    const blocks: RelayProgram['blocks'] = [
      { type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'sit-up', exerciseName: 'Sit Up' }] }] }
    ];
    // 180s of EMOM + one 2-set member (2 * 45 + 1 * 60 = 150)
    expect(estimateProgramMin([member({ name: 'Sit Up' }), member({ name: 'Bench', sets: 2, restSec: 60 })], blocks)).toBe(330);
  });
});

describe('standardProgramExercises', () => {
  const blocks: RelayProgram['blocks'] = [
    { type: 'emom', rounds: 3, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'sit-up', exerciseName: 'Sit Up' }] }] },
    { type: 'straight', rounds: 3, steps: [{ exerciseSlug: 'bench', exerciseName: 'Bench' }, { exerciseSlug: 'row', exerciseName: 'Row' }], restAfterRoundSec: 90 }
  ];
  it('drops EMOM-only members and keeps superset members', () => {
    const members = [member({ name: 'Sit Up' }), member({ name: 'Bench' }), member({ name: 'Row' })];
    expect(standardProgramExercises(members, blocks).map((entry) => entry.name)).toEqual(['Bench', 'Row']);
  });
  it('returns every member when the program has no EMOM section', () => {
    const members = [member({ name: 'Bench' })];
    expect(standardProgramExercises(members, [])).toEqual(members);
  });
});

describe('straightBlocksFromBuilder', () => {
  it('turns linked normal rows into a reusable superset block', () => {
    const base = { muscleGroup: 'Chest', imageUrl: '', sets: 3, reps: '10', restSec: 75, weight: null, notes: '', sectionIndex: 0, intervalIndex: 0, durationSec: 0 };
    const blocks = straightBlocksFromBuilder([
      { ...base, exerciseSlug: 'bench', exerciseName: 'Bench Press' },
      { ...base, exerciseSlug: 'row', exerciseName: 'Row', reps: '12', supersetWithPrevious: true },
      { ...base, exerciseSlug: 'squat', exerciseName: 'Squat' }
    ]);
    expect(blocks).toEqual([expect.objectContaining({
      type: 'straight', rounds: 3, restAfterRoundSec: 75,
      steps: [expect.objectContaining({ exerciseSlug: 'bench', targetReps: '10' }), expect.objectContaining({ exerciseSlug: 'row', targetReps: '12' })]
    })]);
  });
});

describe('resolveProgramExercise', () => {
  const lib = [
    ex({ slug: 'bench', name: 'Bench Press', nostr_address: 'addr:bench' }),
    ex({ slug: 'squat', name: 'Back Squat' })
  ];
  it('matches by nostr_address first', () => {
    expect(resolveProgramExercise(member({ address: 'addr:bench' }), lib)?.slug).toBe('bench');
  });
  it('falls back to the slug tail of the address', () => {
    expect(resolveProgramExercise(member({ address: 'workstr:exercise:squat' }), lib)?.slug).toBe('squat');
  });
  it('falls back to a case-insensitive name match', () => {
    expect(resolveProgramExercise(member({ name: 'bench press' }), lib)?.slug).toBe('bench');
  });
  it('returns null when nothing matches', () => {
    expect(resolveProgramExercise(member({ name: 'Nonexistent' }), lib)).toBeNull();
  });
});

describe('programExerciseName', () => {
  it('prefers the member name, then the resolved exercise name', () => {
    expect(programExerciseName(member({ name: 'Curl' }), null)).toBe('Curl');
    expect(programExerciseName(member({}), ex({ name: 'Deadlift' }))).toBe('Deadlift');
  });
  it('humanizes the address slug when no name is available', () => {
    expect(programExerciseName(member({ address: 'workstr:exercise:bench-press' }), null)).toBe('bench press');
  });
  it('defaults to "Exercise"', () => {
    expect(programExerciseName(member({}), null)).toBe('Exercise');
  });
});

describe('inferProgramMuscle', () => {
  it('maps movement keywords to muscle groups', () => {
    expect(inferProgramMuscle('Back Squat')).toBe('Quadriceps');
    expect(inferProgramMuscle('Barbell Row')).toBe('Back');
    expect(inferProgramMuscle('Romanian Deadlift')).toBe('Hamstrings');
    expect(inferProgramMuscle('Bicep Curl')).toBe('Biceps');
    expect(inferProgramMuscle('Tricep Dip')).toBe('Triceps');
    expect(inferProgramMuscle('Calf Raise')).toBe('Calves');
    expect(inferProgramMuscle('Plank')).toBe('Core');
    expect(inferProgramMuscle('Push Up')).toBe('Chest');
    expect(inferProgramMuscle('Hip Thrust')).toBe('Glutes');
  });
  it('pins the "press" -> Shoulders precedence over "bench" -> Chest', () => {
    expect(inferProgramMuscle('Bench Press')).toBe('Shoulders');
  });
  it('returns empty for unrecognized names', () => {
    expect(inferProgramMuscle('Wobble')).toBe('');
  });
});

describe('programGroups / programMuscleSets', () => {
  it('collects unique display groups across members', () => {
    // programMuscleLabel folds arm synonyms (biceps -> Arms) but passes other
    // values through verbatim, so 'chest' stays lowercase.
    const program = prog({ exercises: [member({ muscleGroup: 'chest' }), member({ muscleGroup: 'biceps' })] });
    expect(programGroups(program, []).sort()).toEqual(['Arms', 'chest']);
  });
  it('separates canonical primary and secondary, excluding primaries from secondary', () => {
    const lib = [ex({ name: 'Bench Press', muscle_group: 'chest', muscles: ['triceps', 'chest'] })];
    const program = prog({ exercises: [member({ name: 'Bench Press' })] });
    const { primary, secondary } = programMuscleSets(program, lib);
    expect([...primary]).toEqual(['Chest']);
    expect([...secondary]).toEqual(['Triceps']);
  });
});

describe('program labels', () => {
  it('infers split, format, equipment, and keeps chosen goals first', () => {
    const lib = [
      ex({ slug: 'bench', name: 'Bench Press', muscle_group: 'Chest', equipment: ['Dumbbell'] }),
      ex({ slug: 'row', name: 'Row', muscle_group: 'Back', equipment: ['Dumbbell'] })
    ];
    const program = prog({
      tags: ['hypertrophy', 'random-note'],
      exercises: [member({ name: 'Bench Press' }), member({ name: 'Row' })],
      blocks: [{ type: 'straight', rounds: 3, steps: [{ exerciseSlug: 'bench' }, { exerciseSlug: 'row' }], restAfterRoundSec: 90 }]
    });
    expect(inferProgramLabels(program, lib)).toEqual(expect.arrayContaining(['normal', 'superset', 'upper-body', 'push', 'pull', 'dumbbell', 'minimal-equipment', 'quick']));
    expect(programDisplayTags(program, lib)).toEqual(['hypertrophy', 'superset', 'upper-body', 'dumbbell']);
  });
});

describe('programAuthor', () => {
  const state = { profileNames: { pk1: 'Alice' } } as unknown as AppState;
  it('uses a known profile name, else a short pubkey, else unknown', () => {
    expect(programAuthor(prog({ pubkey: 'pk1' }), state)).toBe('Alice');
    expect(programAuthor(prog({ pubkey: 'ffff' }), state)).toBe(displayPubkey('ffff'));
    expect(programAuthor(prog({ pubkey: '' }), state)).toBe('unknown');
  });
});

describe('isLocalProgram / localSheetId', () => {
  it('detects local addresses and extracts the sheet id', () => {
    expect(isLocalProgram(prog({ address: 'local:42' }))).toBe(true);
    expect(isLocalProgram(prog({ address: 'workstr:program:x' }))).toBe(false);
    expect(localSheetId(prog({ address: 'local:42' }))).toBe(42);
    expect(localSheetId(prog({ address: 'local:' }))).toBe(0);
  });
});

describe('sheetToProgram', () => {
  const baseSheet: SheetWithExercises = {
    id: 7, slug: 'push-day', name: 'Push Day', notes: 'chest & tris', difficulty: 'advanced', tags: ['hypertrophy', 'push'], is_temporary: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    exercises: [{ sheet_id: 7, exercise_slug: 'bench', exercise_name: 'Bench Press', position: 0, sets: 4, reps: 8, rest: 120, weight: 60 }]
  };
  it('maps a local sheet into a RelayProgram with a local: address', () => {
    const program = sheetToProgram(baseSheet);
    expect(program.address).toBe('local:7');
    expect(program.name).toBe('Push Day');
    expect(program.description).toBe('chest & tris');
    expect(program.difficulty).toBe('advanced');
    expect(program.tags).toEqual(['hypertrophy', 'push']);
    expect(program.exercises[0]).toMatchObject({ name: 'Bench Press', sets: 4, reps: '8', restSec: 120, weight: '60' });
  });
  it('renders difficulty and tag pills on program cards', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState);
    expect(card).toContain('advanced');
    expect(card).toContain('diff-advanced');
    expect(card).toContain('program-tag-grid');
    expect(card).toContain('hypertrophy');
    expect(card).toContain('upper-body');
  });
  it('keeps collapsed program card metadata concise', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState);
    expect(card).toContain('exercise');
    expect(card).not.toContain('chest &amp; tris');
    expect(card).not.toContain('~');
  });
  it('adds a local program Publish action that stays available for locked users', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [baseSheet], finishedSessions: [], pubkey: null, profilePicture: null, programZapAttempts: [] } as unknown as AppState);
    expect(card).toContain('data-publish-program="local:7"');
    expect(card).toContain('>Publish</button>');
    // Available, but not the lead action while Beast Mode is locked.
    expect(/<button class="([^"]*)"[^>]*data-publish-program="local:7"/.exec(card)?.[1]).toBe('button small');
  });
  it('marks the local Publish action primary when Beast Mode is unlocked', () => {
    const completed = [1, 2, 3, 4, 5].map((id) => ({ id, sheetName: `S${id}`, startedAt: `2026-08-0${Math.min(id, 3)}T10:00:00`, finishedAt: `2026-08-0${Math.min(id, 3)}T10:30:00`, exercises: [], sets: [] }));
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [baseSheet], finishedSessions: completed, pubkey: 'f'.repeat(64), profilePicture: 'https://example.com/avatar.png', programZapAttempts: [] } as unknown as AppState);
    expect(card).toContain('button primary small');
    expect(card).toContain('data-publish-program="local:7"');
  });
  it('labels the source by whether the sheet is published', () => {
    expect(sheetToProgram(baseSheet).sourceLabel).toBe('local');
    expect(sheetToProgram({ ...baseSheet, nostr_address: 'workstr:program:push-day' }).sourceLabel).toBe('in library');
  });
  it('keeps the imported program author pubkey so creator zaps are discoverable locally', () => {
    const pubkey = 'f'.repeat(64);
    const imported = { ...baseSheet, nostr_address: `33402:${pubkey}:workstr:program:push-day`, nostr_pubkey: pubkey };
    const program = sheetToProgram(imported);
    const card = programCard(program, { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: program.address, sheets: [imported], programZapAttempts: [] } as unknown as AppState);
    expect(program.pubkey).toBe(pubkey);
    expect(card).toContain('program-zap-cta');
    expect(card).toContain('program-zap-icon');
    expect(card).toContain('program-zap-label');
    expect(card).toContain('>Zap</span>');
  });
});

describe('emomBlockFromBuilder', () => {
  it('groups timed exercises into intervals while preserving rep targets', () => {
    const base = { muscleGroup: 'Core', imageUrl: '', sets: 1, restSec: 60, weight: null, notes: '', sectionIndex: 0 };
    const block = emomBlockFromBuilder([
      { ...base, exerciseSlug: 'a', exerciseName: 'A', reps: '12', intervalIndex: 0, durationSec: 20 },
      { ...base, exerciseSlug: 'b', exerciseName: 'B', reps: '10', intervalIndex: 0, durationSec: 20 },
      { ...base, exerciseSlug: 'c', exerciseName: 'C', reps: '8', intervalIndex: 1, durationSec: 0 }
    ], 5, 60);
    expect(block.rounds).toBe(5);
    expect(block.intervals).toHaveLength(2);
    expect(block.intervals[0].steps).toMatchObject([
      { exerciseSlug: 'a', targetReps: '12', targetDurationSec: 20 },
      { exerciseSlug: 'b', targetReps: '10', targetDurationSec: 20 }
    ]);
    expect(block.intervals[1].steps[0]).toMatchObject({ exerciseSlug: 'c', targetReps: '8' });
  });

  it('creates sequential blocks with independent rounds and interval lengths', () => {
    const base = { muscleGroup: 'Core', imageUrl: '', sets: 1, restSec: 60, weight: null, notes: '', intervalIndex: 0, durationSec: 0 };
    const blocks = emomBlocksFromBuilder([
      { ...base, exerciseSlug: 'burpees', exerciseName: 'Burpees', reps: '5', sectionIndex: 0 },
      { ...base, exerciseSlug: 'sit-up', exerciseName: 'Sit-Up', reps: '8', sectionIndex: 1 },
      { ...base, exerciseSlug: 'jumping-jack', exerciseName: 'Jumping Jack', reps: '', sectionIndex: 2, durationSec: 40 }
    ], [{ rounds: 10, intervalSec: 60 }, { rounds: 15, intervalSec: 60 }, { rounds: 10, intervalSec: 60 }]);
    expect(blocks.map((block) => block.rounds)).toEqual([10, 15, 10]);
    expect(estimateProgramMin([], blocks)).toBe(2100);
    expect(programCard(prog({ blocks }), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState)).toContain('35 min · 3-section EMOM');
    const body = programBody(prog({ blocks }), { exercises: [], settings: { unit: 'kg' }, sheets: [] } as unknown as AppState);
    expect(body).toContain('Section 1: 10 rounds · 10 min');
    expect(body).toContain('Section 2: 15 rounds · 15 min');
  });
});

describe('programBody mixed programs', () => {
  const state = { exercises: [], settings: { unit: 'kg' }, sheets: [] } as unknown as AppState;
  const mixed = () => prog({
    exercises: [
      member({ name: 'Bench Press', sets: 3, reps: '8', restSec: 90 }),
      member({ name: 'Row', sets: 3, reps: '8', restSec: 90 }),
      member({ name: 'Burpees', sets: 10, reps: '5' })
    ],
    blocks: [
      { type: 'straight', rounds: 3, steps: [{ exerciseSlug: 'bench-press', exerciseName: 'Bench Press' }] },
      { type: 'emom', rounds: 10, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'burpees', exerciseName: 'Burpees', targetReps: '5' }] }] }
    ]
  });

  it('labels both halves and never contradicts the card total', () => {
    const program = mixed();
    const body = programBody(program, state);
    const card = programCard(program, { ...state, expandedProgramAddress: null } as unknown as AppState);
    // Strength: 2 exercises at 3 sets => 2 * (3*45 + 2*90) = 630s; EMOM: 10 * 60 = 600s.
    expect(body).toContain('Strength · 2 exercises · 11 min');
    expect(body).toContain('EMOM · 1 section · 10 min');
    expect(estimateProgramMin(program.exercises, program.blocks)).toBe(1230);
    expect(card).toContain('21 min');
  });

  it('renders the strength half before the EMOM half', () => {
    const body = programBody(mixed(), state);
    expect(body.indexOf('Strength · 2 exercises')).toBeLessThan(body.indexOf('EMOM · 1 section'));
    expect(body.indexOf('Bench Press')).toBeLessThan(body.indexOf('Burpees'));
  });

  it('describes timed members by rounds and interval rather than sets and rest', () => {
    const body = programBody(mixed(), state);
    expect(body).toContain('10 rounds · 60s');
    expect(body).toContain('>Rounds</div>');
    expect(body).toContain('>Interval</div>');
    // The strength rows keep their own vocabulary.
    expect(body).toContain('3 × 8');
    expect(body).toContain('>Rest</div>');
  });

  it('gives an exercise repeated across sections each section\'s own numbers', () => {
    const body = programBody(prog({
      exercises: [member({ name: 'Burpees', sets: 10 }), member({ name: 'Burpees', sets: 15 })],
      blocks: [
        { type: 'emom', rounds: 10, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'burpees', exerciseName: 'Burpees', targetReps: '5' }] }] },
        { type: 'emom', rounds: 15, intervals: [{ durationSec: 90, steps: [{ exerciseSlug: 'burpees', exerciseName: 'Burpees', targetDurationSec: 40 }] }] }
      ]
    }), state);
    expect(body).toContain('10 rounds · 60s');
    expect(body).toContain('15 rounds · 90s · 40s work');
  });

  it('leaves a pure EMOM program without strength headings', () => {
    const body = programBody(prog({
      exercises: [member({ name: 'Burpees', sets: 10, reps: '5' })],
      blocks: [{ type: 'emom', rounds: 10, intervals: [{ durationSec: 60, steps: [{ exerciseSlug: 'burpees', exerciseName: 'Burpees' }] }] }]
    }), state);
    expect(body).not.toContain('Strength ·');
    expect(body).toContain('1 EMOM section · 10 min');
  });

  it('leaves a pure strength program without EMOM headings', () => {
    const body = programBody(prog({
      exercises: [member({ name: 'Bench Press', sets: 3, reps: '8', restSec: 90 })]
    }), state);
    expect(body).not.toContain('Strength ·');
    expect(body).not.toContain('EMOM');
    expect(body).toContain('3 × 8');
  });
});
