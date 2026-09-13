import { slugify } from '../core/ids';
import type { Exercise, Sheet } from '../core/types';
import type { SheetDraft } from '../db/store';
import { EXERCISE_D_PREFIX, type RelayProgram, type RelayProgramExercise } from './canon';
import { findOwnedProgramSource } from './program-ownership';

export type ProgramImportState = 'new' | 'in-library' | 'update';

// Same identity rule as exercises: a sheet still carrying the program's nostr
// address is an unmodified import (builder edits fork someone else's import by
// clearing the nostr fields on save), so a newer remote created_at means an update.
// The active account's own publication is different: its local sheet is the copy
// being edited, so the relay version is never offered as an import or an update.
export function programImportState(program: RelayProgram, sheets: Sheet[], activePubkey?: string | null): ProgramImportState {
  if (findOwnedProgramSource(program, sheets, activePubkey)) return 'in-library';
  const local = program.address ? sheets.find((sheet) => sheet.nostr_address === program.address) : undefined;
  if (!local) return 'new';
  return (program.createdAt || 0) > (local.origin_created_at || 0) ? 'update' : 'in-library';
}

export interface ProgramImportPlan {
  // Canon exercises referenced by the program that are not in the library yet.
  exercisesToImport: Exercise[];
  // Referenced addresses found neither in the library nor in the canon
  // catalog; their sheet rows fall back to the names carried by the event.
  unresolved: string[];
  sheet: SheetDraft;
}

// Match order mirrors resolveProgramExercise: full address, then the slug
// part of the address (covers forked/seed rows that lost their address, and
// avoids upsertExercise clobbering them on slug collision), then exact name.
function findInLibrary(member: RelayProgramExercise, library: Exercise[]): Exercise | undefined {
  if (member.address) {
    const byAddress = library.find((exercise) => exercise.nostr_address === member.address);
    if (byAddress) return byAddress;
    const slug = member.address.split(':').pop();
    const bySlug = library.find((exercise) => exercise.slug === slug);
    if (bySlug) return bySlug;
  }
  if (member.name) {
    const name = member.name.toLowerCase();
    return library.find((exercise) => exercise.name.toLowerCase() === name);
  }
  return undefined;
}

// Creator programs published from Workstr Web reference an exercise by its bare d tag
// (`workstr:exercise:<slug>`) rather than the full `33401:<operator>:...` address, and the
// copies already on relays will never change. The catalog is operator-only, so a bare d tag
// names exactly one catalog exercise; a full address from another author is never matched by
// slug, or someone else's exercise would import as the operator's.
function findInCanon(address: string, canon: Exercise[]): Exercise | undefined {
  const exact = canon.find((exercise) => exercise.nostr_address === address);
  if (exact || !address.startsWith(EXERCISE_D_PREFIX)) return exact;
  const slug = address.slice(EXERCISE_D_PREFIX.length);
  return canon.find((exercise) => exercise.slug === slug);
}

export function planProgramImport(program: RelayProgram, library: Exercise[], canon: Exercise[]): ProgramImportPlan {
  const exercisesToImport: Exercise[] = [];
  const unresolved: string[] = [];
  const rows = program.exercises.map((member, index) => {
    let full = findInLibrary(member, library);
    if (!full && member.address) {
      const fromCanon = findInCanon(member.address, canon);
      if (fromCanon) {
        full = fromCanon;
        if (!exercisesToImport.some((exercise) => exercise.nostr_address === fromCanon.nostr_address)) exercisesToImport.push(fromCanon);
      } else {
        unresolved.push(member.address);
      }
    }
    const slugName = member.address ? member.address.split(':').pop()?.replace(/[-_]+/g, ' ') : '';
    const name = member.name || full?.name || slugName || 'Exercise';
    const weight = member.weight != null && member.weight !== '' && Number.isFinite(Number(member.weight)) ? Number(member.weight) : undefined;
    return {
      exercise_slug: full?.slug || slugify(name),
      exercise_name: name,
      muscle_group: member.muscleGroup || full?.muscle_group,
      image_url: member.imageUrl || full?.image_url,
      sets: Number(member.sets) || Number(full?.default_sets) || 3,
      reps: String(member.reps || full?.default_reps || '8-12'),
      rest: Number(member.restSec || member.rest || full?.default_rest) || 90,
      weight,
      notes: member.notes,
      position: index
    };
  });
  return {
    exercisesToImport,
    unresolved,
    sheet: {
      name: program.name,
      notes: program.description,
      difficulty: program.difficulty || '',
      tags: program.tags,
      blocks: program.blocks,
      nostr_pubkey: program.pubkey,
      nostr_address: program.address,
      nostr_event_id: program.eventId,
      origin_created_at: program.createdAt,
      exercises: rows
    }
  };
}
