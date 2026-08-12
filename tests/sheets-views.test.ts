import { describe, expect, it } from 'vitest';
import {
  estimateProgramMin, resolveProgramExercise, programExerciseName, inferProgramMuscle,
  programGroups, programMuscleSets, programAuthor, isLocalProgram, localSheetId, sheetToProgram, programCard, emomBlockFromBuilder, emomBlocksFromBuilder
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
    id: 7, slug: 'push-day', name: 'Push Day', notes: 'chest & tris', difficulty: 'Beast Mode', tags: ['hypertrophy', 'push'], is_temporary: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    exercises: [{ sheet_id: 7, exercise_slug: 'bench', exercise_name: 'Bench Press', position: 0, sets: 4, reps: 8, rest: 120, weight: 60 }]
  };
  it('maps a local sheet into a RelayProgram with a local: address', () => {
    const program = sheetToProgram(baseSheet);
    expect(program.address).toBe('local:7');
    expect(program.name).toBe('Push Day');
    expect(program.description).toBe('chest & tris');
    expect(program.difficulty).toBe('Beast Mode');
    expect(program.tags).toEqual(['hypertrophy', 'push']);
    expect(program.exercises[0]).toMatchObject({ name: 'Bench Press', sets: 4, reps: '8', restSec: 120, weight: '60' });
  });
  it('renders difficulty and tag pills on program cards', () => {
    const card = programCard(sheetToProgram(baseSheet), { exercises: [], settings: { unit: 'kg' }, expandedProgramAddress: null, sheets: [] } as unknown as AppState);
    expect(card).toContain('Beast Mode');
    expect(card).toContain('diff-beast');
    expect(card).toContain('hypertrophy');
  });
  it('labels the source by whether the sheet is published', () => {
    expect(sheetToProgram(baseSheet).sourceLabel).toBe('local');
    expect(sheetToProgram({ ...baseSheet, nostr_address: 'workstr:program:push-day' }).sourceLabel).toBe('in library');
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
    expect(estimateProgramMin([], blocks)).toBe(35);
  });
});
