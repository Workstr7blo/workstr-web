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
import { programActions } from '../src/features/sheets/program-actions';
import { creatorProgramFingerprint } from '../src/nostr/program-publish';

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
  it('shows the level inline and the goal as text, with no badges or pills', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState);
    expect(card).toContain('<span class="card-level level-advanced">Advanced</span>');
    // The goal the sheet carries, then the muscle inferred from its one exercise.
    expect(card).toMatch(/<div class="workout-card-summary">Hypertrophy · [A-Z][a-z]+<\/div>/);
    for (const retired of ['diff-badge', 'program-tag-grid', 'tag-pill', 'program-status', 'workout-card-author', 'workout-card-media']) expect(card).not.toContain(retired);
  });
  it('keeps collapsed program card metadata concise', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState);
    expect(card).toContain('exercise');
    expect(card).not.toContain('chest &amp; tris');
    expect(card).not.toContain('~');
  });
  it('adds a local program Publish action that stays available for locked users', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [baseSheet], finishedSessions: [], pubkey: null, profilePicture: null } as unknown as AppState);
    expect(card).toContain('data-publish-program="local:7"');
    expect(card).toContain('>Publish</button>');
    // Available, but not the lead action while Beast Mode is locked.
    expect(/<button class="([^"]*)"[^>]*data-publish-program="local:7"/.exec(card)?.[1]).toBe('button small');
  });
  it('marks the local Publish action primary when Beast Mode is unlocked', () => {
    const completed = [1, 2, 3, 4, 5].map((id) => ({ id, sheetName: `S${id}`, startedAt: `2026-08-0${Math.min(id, 3)}T10:00:00`, finishedAt: `2026-08-0${Math.min(id, 3)}T10:30:00`, exercises: [], sets: [] }));
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [baseSheet], finishedSessions: completed, pubkey: 'f'.repeat(64), profilePicture: 'https://example.com/avatar.png' } as unknown as AppState);
    expect(card).toContain('button primary small');
    expect(card).toContain('data-publish-program="local:7"');
  });
  it('labels the source by whether the sheet is published', () => {
    expect(sheetToProgram(baseSheet).sourceLabel).toBe('local');
    expect(sheetToProgram({ ...baseSheet, nostr_address: 'workstr:program:push-day' }).sourceLabel).toBe('in library');
  });
  it('keeps the imported program author pubkey', () => {
    const pubkey = 'f'.repeat(64);
    const imported = { ...baseSheet, nostr_address: `33402:${pubkey}:workstr:program:push-day`, nostr_pubkey: pubkey };
    const program = sheetToProgram(imported);
    const card = programCard(program, { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: program.address, sheets: [imported] } as unknown as AppState);
    expect(program.pubkey).toBe(pubkey);
    // With Monero tips off a card carries no payment action at all.
    expect(card).not.toContain('program-zap-cta');
    expect(card).not.toContain('monero-tip-cta');
  });
});

describe('emomBlockFromBuilder', () => {
  it('makes one interval per move in list order and keeps the section length', () => {
    const base = { muscleGroup: 'Core', imageUrl: '', sets: 1, restSec: 60, weight: null, notes: '', sectionIndex: 0 };
    const block = emomBlockFromBuilder([
      { ...base, exerciseSlug: 'a', exerciseName: 'A', reps: '12', intervalIndex: 0, durationSec: 20 },
      { ...base, exerciseSlug: 'b', exerciseName: 'B', reps: '10', intervalIndex: 0, durationSec: 20 },
      { ...base, exerciseSlug: 'c', exerciseName: 'C', reps: '8', intervalIndex: 1, durationSec: 0 }
    ], 10, 60);
    expect(block.totalDurationSec).toBe(600);
    expect(block.intervals.map((interval) => interval.steps.map((step) => step.exerciseSlug))).toEqual([['a'], ['b'], ['c']]);
    expect(block.intervals[0].steps[0]).toMatchObject({ targetReps: '12', targetDurationSec: 20 });
    expect(block.intervals[2].steps[0]).toMatchObject({ exerciseSlug: 'c', targetReps: '8' });
    // Full passes through the moves, for a client that predates the section length.
    expect(block.rounds).toBe(3);
    expect(estimateProgramMin([], [block])).toBe(600);
    expect(programCard(prog({ blocks: [block] }), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState)).toContain('10 min · EMOM');
  });

  it('creates sequential sections whose lengths add up, whatever their move counts', () => {
    const base = { muscleGroup: 'Core', imageUrl: '', sets: 1, restSec: 60, weight: null, notes: '', intervalIndex: 0, durationSec: 0 };
    const blocks = emomBlocksFromBuilder([
      { ...base, exerciseSlug: 'burpees', exerciseName: 'Burpees', reps: '5', sectionIndex: 0 },
      { ...base, exerciseSlug: 'squat', exerciseName: 'Squat', reps: '10', sectionIndex: 0 },
      { ...base, exerciseSlug: 'sit-up', exerciseName: 'Sit-Up', reps: '8', sectionIndex: 1 },
      { ...base, exerciseSlug: 'jumping-jack', exerciseName: 'Jumping Jack', reps: '', sectionIndex: 2, durationSec: 40 }
    ], [{ durationMin: 10, intervalSec: 60 }, { durationMin: 15, intervalSec: 60 }, { durationMin: 10, intervalSec: 60 }]);
    expect(blocks.map((block) => block.totalDurationSec)).toEqual([600, 900, 600]);
    expect(estimateProgramMin([], blocks)).toBe(2100);
    expect(programCard(prog({ blocks }), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState)).toContain('35 min · 3-section EMOM');
    const body = programBody(prog({ blocks }), { exercises: [], settings: { unit: 'kg' }, sheets: [] } as unknown as AppState);
    expect(body).toContain('Section 1: 10 min · 2 moves');
    expect(body).toContain('Section 2: 15 min · 1 move');
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

  it('describes timed members by section minutes and interval rather than sets and rest', () => {
    const body = programBody(mixed(), state);
    expect(body).toContain('10 min · 60s interval');
    expect(body).toContain('>Min</div>');
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
    expect(body).toContain('10 min · 60s interval');
    expect(body).toContain('23 min · 90s interval · 40s work');
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

describe('publication status on program cards', () => {
  const ME = 'a'.repeat(64);
  const address = `33402:${ME}:workstr:beastmode:program:push-day`;
  const source: SheetWithExercises = {
    id: 7, slug: 'push-day', name: 'Push Day', notes: '', difficulty: 'advanced', tags: [], is_temporary: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    exercises: [{ sheet_id: 7, exercise_slug: 'bench', exercise_name: 'Bench Press', position: 0, sets: 4, reps: 8, rest: 120, weight: 60 }]
  };
  const publishedSheet = (): SheetWithExercises => {
    const linked = { ...source, nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'e'.repeat(64) };
    return { ...linked, nostr_published_content_hash: creatorProgramFingerprint(linked) };
  };
  const appState = (sheet: SheetWithExercises) => ({
    exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [sheet], finishedSessions: [], pubkey: ME, profilePicture: null
  } as unknown as AppState);
  const relay = (pubkey = ME): RelayProgram => ({
    slug: 'push-day', name: 'Push Day', description: '', tags: [], exercises: [], sourceLabel: 'creator',
    eventId: 'f'.repeat(64), pubkey, address: `33402:${pubkey}:workstr:beastmode:program:push-day`, createdAt: 1
  });

  it('shows a never-published program as local with Publish', () => {
    const card = programCard(sheetToProgram(source), appState(source));
    expect(card).not.toContain('workout-card-status');
    expect(card).toContain('>Publish</button>');
  });

  it('shows an unchanged publication as published with no publish action', () => {
    const sheet = publishedSheet();
    const card = programCard(sheetToProgram(sheet), appState(sheet));
    expect(card).not.toContain('workout-card-status');
    expect(card).toContain('disabled>Published</button>');
    expect(card).not.toContain('data-publish-program');
    expect(card).toContain('data-edit-sheet="7"');
    expect(card).toContain('data-del-sheet="7"');
  });

  it('shows an edited publication as unpublished changes with Publish update', () => {
    const sheet = { ...publishedSheet(), name: 'Push Day Heavy' };
    const card = programCard(sheetToProgram(sheet), appState(sheet));
    expect(card).toContain('<div class="workout-card-status">Unpublished changes</div>');
    expect(card).toContain('data-publish-program="local:7"');
    expect(card).toContain('>Publish update</button>');
  });

  it('keeps someone else import labelled in library', () => {
    const other = 'b'.repeat(64);
    const sheet = { ...source, nostr_pubkey: other, nostr_address: `33402:${other}:workstr:beastmode:program:push-day` };
    const card = programCard(sheetToProgram(sheet), appState(sheet));
    expect(card).not.toContain('in library');
    expect(card).not.toContain('workout-card-status');
  });

  it('marks the user own relay program as Yours in Discover, never Import', () => {
    const actions = programActions(relay(), appState(publishedSheet()));
    expect(actions).toContain('disabled>Yours</button>');
    expect(actions).not.toContain('Import');
    expect(programActions(relay(), appState({ ...publishedSheet(), notes: 'edited' }))).toContain('disabled>Yours · Unpublished changes</button>');
  });

  it('still offers Import for another author program', () => {
    expect(programActions(relay('b'.repeat(64)), appState(publishedSheet()))).toContain('>Import</button>');
  });
});

describe('Delete from relays action', () => {
  const ME = 'a'.repeat(64);
  const address = `33402:${ME}:workstr:beastmode:program:push-day`;
  const base: SheetWithExercises = {
    id: 7, slug: 'push-day', name: 'Push Day', notes: '', difficulty: 'advanced', tags: [], is_temporary: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', exercises: []
  };
  const appState = (sheets: SheetWithExercises[], pubkey: string | null = ME) =>
    ({ exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets, finishedSessions: [], pubkey, profilePicture: null } as unknown as AppState);
  const relayCopy = (pubkey = ME): RelayProgram => ({
    slug: 'push-day', name: 'Push Day', description: '', tags: [], exercises: [], sourceLabel: 'creator',
    eventId: 'f'.repeat(64), pubkey, address: `33402:${pubkey}:workstr:beastmode:program:push-day`, createdAt: 1
  });

  it('is offered on a published Programs card and never on a local-only one', () => {
    const published = { ...base, nostr_pubkey: ME, nostr_address: address };
    expect(programActions(sheetToProgram(published), appState([published]))).toContain('data-delete-program="local:7">Delete from relays</button>');
    expect(programActions(sheetToProgram(base), appState([base]))).not.toContain('data-delete-program');
  });

  it('is offered on your own relay copy in Discover, linked or not', () => {
    const orphan = programActions(relayCopy(), appState([]));
    expect(orphan).toContain(`data-delete-program="${address}"`);
    expect(orphan).toContain('>Import</button>');
    const linked = { ...base, nostr_pubkey: ME, nostr_address: address };
    expect(programActions(relayCopy(), appState([linked]))).toContain(`data-delete-program="${address}"`);
  });

  it('is never offered for another author or while signed out', () => {
    expect(programActions(relayCopy('b'.repeat(64)), appState([]))).not.toContain('data-delete-program');
    expect(programActions(relayCopy(), appState([], null))).not.toContain('data-delete-program');
  });
});

describe('program card exercise pictures', () => {
  const saved: SheetWithExercises = {
    id: 7, slug: 'cardio', name: 'Cardio', notes: '', difficulty: 'beginner', tags: [], is_temporary: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    exercises: [
      { sheet_id: 7, exercise_slug: 'mountain-climbers', exercise_name: 'Mountain Climbers', image_url: 'https://x/old.png', position: 0, sets: 3, reps: '20', rest: 30 },
      { sheet_id: 7, exercise_slug: 'ghost-move', exercise_name: 'Ghost Move', image_url: 'https://x/ghost.png', position: 1, sets: 3, reps: '10', rest: 30 }
    ]
  };
  const state = (exercises: Exercise[]) => ({ exercises, settings: { unit: 'kg' }, expandedProgramAddress: 'local:7', sheets: [saved], finishedSessions: [], pubkey: null, profilePicture: null } as unknown as AppState);

  it('shows the exercise current picture over the one the program saved', () => {
    const card = programCard(sheetToProgram(saved), state([ex({ slug: 'mountain-climbers', name: 'Mountain Climbers', image_url: 'https://x/new.png' })]));
    expect(card).toContain('src="https://x/new.png"');
    expect(card).not.toContain('src="https://x/old.png"');
    // An exercise the library does not have keeps the picture the program saved.
    expect(card).toContain('src="https://x/ghost.png"');
  });
});

describe('collapsed program card', () => {
  const OPERATOR = 'ef24246321e47dd16cec960d4d374703af78505d0e59c532b054b5060e372bd6';
  const CREATOR = 'c'.repeat(64);
  const relayProgram = (partial: Partial<RelayProgram>): RelayProgram => ({
    slug: 'p', name: 'Cardio Carnage #2', description: '', tags: [], exercises: [], sourceLabel: 'creator', eventId: '', pubkey: CREATOR,
    address: `33402:${CREATOR}:workstr:beastmode:program:p`, createdAt: 1, ...partial
  });
  const members = (...muscles: string[]) => muscles.map((muscle, index) => ({ address: '', name: `Move ${index}`, muscleGroup: muscle, sets: 3, reps: '10' }));
  const view = (partial: Partial<AppState> = {}) => ({ exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [], authorProfiles: {}, profileNames: {}, ...partial } as unknown as AppState);
  const byline = (card: string) => /<div class="workout-card-byline">([^]*?)<\/div>\s*<div class="workout-card-meta">/.exec(card)?.[1] || '';

  it('names Workstr as the creator of an official program, with its level, and no source badge', () => {
    const card = programCard(relayProgram({ pubkey: OPERATOR, name: 'Upper Body', difficulty: 'intermediate', sourceLabel: 'Workstr' }), view());
    expect(byline(card)).toContain('workstr-author');
    expect(byline(card)).toContain('<span>Workstr</span></span><span class="card-level level-intermediate">Intermediate</span>');
    expect(card).not.toContain('program-status');
  });

  it('names a creator by profile, falling back to a short npub', () => {
    const named = programCard(relayProgram({ difficulty: 'beginner' }), view({ authorProfiles: { [CREATOR]: { name: 'Settebello' } } as AppState['authorProfiles'] }));
    expect(byline(named)).toContain('<span>Settebello</span></span><span class="card-level level-beginner">Beginner</span>');
    expect(byline(programCard(relayProgram({ difficulty: 'beginner' }), view()))).toContain('npub1');
  });

  it('omits the creator of a program nobody has published, and the byline when nothing is left', () => {
    const local = relayProgram({ pubkey: '', address: 'local:3', difficulty: 'beginner' });
    expect(byline(programCard(local, view()))).toBe('<span class="card-level level-beginner">Beginner</span>');
    expect(programCard({ ...local, difficulty: '' }, view())).not.toContain('workout-card-byline');
  });

  it('summarises goal and focus in one line without repeating the format', () => {
    const summary = (program: RelayProgram) => /<div class="workout-card-summary">([^<]*)<\/div>/.exec(programCard(program, view()))?.[1];
    expect(summary(relayProgram({ tags: ['endurance'], exercises: members('Core', 'Calves') }))).toBe('Endurance · Core + Calves');
    expect(summary(relayProgram({ exercises: members('Chest', 'Quadriceps', 'Back') }))).toBe('Full Body');
    expect(summary(relayProgram({ exercises: members('Chest', 'Back', 'Shoulders') }))).toBe('Upper Body · Chest + Back');
    expect(summary(relayProgram({ tags: ['strength'], exercises: members('Chest', 'Back', 'Shoulders') }))).toBe('Strength · Upper Body');
    expect(summary(relayProgram({ tags: ['emom'], exercises: members('Core') }))).toBe('Core');
  });

  it('keeps the map beside the text and a real disclosure button in the corner', () => {
    const collapsed = programCard(relayProgram({}), view());
    expect(collapsed).not.toContain('workout-card-media');
    expect(collapsed).toContain('<button class="workout-card-toggle" type="button" aria-expanded="false" aria-label="Expand Cardio Carnage #2">');
    const expanded = programCard(relayProgram({}), view({ expandedProgramAddress: `33402:${CREATOR}:workstr:beastmode:program:p`, finishedSessions: [], pubkey: null } as Partial<AppState>));
    expect(expanded).toContain('aria-expanded="true" aria-label="Collapse Cardio Carnage #2"');
  });
});
