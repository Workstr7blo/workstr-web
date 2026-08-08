import type { Event } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools';
import { exerciseFromEvent, programFromEvent, OPERATOR_PUBKEY, type RelayProgram } from '../nostr/canon';
import { planProgramImport } from '../nostr/programImport';
import type { Exercise } from '../core/types';
import type { WorkstrStore } from './store';
import seedEvents from '../data/seed-events.json';

// Bump only when the seed content changes in a way existing installs should
// receive. Each namespace applies a given version at most once, which is what
// makes seeding safe against deletion: a user who removes a starter program
// never sees it come back.
export const SEED_VERSION = 1;

interface SeedContent {
  exercises: Exercise[];
  programs: RelayProgram[];
}

let cached: SeedContent | null = null;

// Parsed through the same codecs as a Discover import, so a seeded row is
// indistinguishable from an imported one — same address, same origin
// timestamp, so Discover says "In library" rather than offering a duplicate.
export function seedContent(): SeedContent {
  if (cached) return cached;
  const events = seedEvents as { programs: Event[]; exercises: Event[] };
  const exercises: Exercise[] = [];
  for (const event of events.exercises) {
    if (event.pubkey !== OPERATOR_PUBKEY || !verifyEvent(event)) continue;
    const exercise = exerciseFromEvent(event);
    if (exercise) exercises.push({ ...exercise, source_type: 'bundle' });
  }
  const programs: RelayProgram[] = [];
  for (const event of events.programs) {
    if (event.pubkey !== OPERATOR_PUBKEY || !verifyEvent(event)) continue;
    const program = programFromEvent(event);
    if (program) programs.push(program);
  }
  cached = { exercises, programs };
  return cached;
}

export interface SeedResult {
  applied: boolean;
  exercises: number;
  programs: number;
}

// Fill empty slots in a fresh namespace so the app is useful offline, with no
// identity and before Discover has ever been opened.
//
// Backfill only, and once per namespace per version:
//   - an existing slug is never touched, whatever its status. A row the user
//     deleted stays deleted; a row they favourited keeps its flag.
//   - a program whose slug or catalog address is already present is skipped.
//   - after a version is applied it is recorded in settings, so a later boot
//     cannot resurrect anything the user removed in the meantime.
export async function applyStarterSeed(store: WorkstrStore): Promise<SeedResult> {
  const settings = await store.getSettings();
  if ((settings.seedVersion ?? 0) >= SEED_VERSION) return { applied: false, exercises: 0, programs: 0 };

  // Installs predating the seed's removal (2026-07) still carry untouched rows
  // from the old bundled library. Clear those once, before the new seed lands,
  // so the two eras cannot leave a half-stale library behind. Favourited rows
  // survive — removeStarterExercises leaves them alone.
  if (settings.seedVersion === undefined) await store.removeStarterExercises();

  const { exercises, programs } = seedContent();
  // Deleted rows count as taken: listExercises hides them, and re-adding a
  // slug the user removed is exactly the resurrection this must not do.
  const existingSlugs = new Set((await store.listExercisesIncludingDeleted()).map((exercise) => exercise.slug));

  let seededExercises = 0;
  for (const exercise of exercises) {
    if (existingSlugs.has(exercise.slug)) continue;
    await store.upsertExercise(exercise);
    existingSlugs.add(exercise.slug);
    seededExercises++;
  }

  // Resolve rows against what the library now holds, exactly as an import
  // would: seeded exercises are already in place, so every reference lands on
  // a real row rather than a name-only fallback.
  const library = await store.listExercises();
  const sheets = await store.listSheets();
  // A sheet's identity is its catalog address, not its slug — saveSheet mints
  // slugs from the name, so the same rule programImportState uses applies here.
  const takenAddresses = new Set(sheets.map((sheet) => sheet.nostr_address).filter(Boolean));

  let seededPrograms = 0;
  for (const program of programs) {
    if (takenAddresses.has(program.address)) continue;
    const plan = planProgramImport(program, library, exercises);
    await store.saveSheet({ ...plan.sheet, source_type: 'bundle' });
    takenAddresses.add(program.address);
    seededPrograms++;
  }

  await store.saveSettings({ ...settings, seedVersion: SEED_VERSION });
  return { applied: true, exercises: seededExercises, programs: seededPrograms };
}
