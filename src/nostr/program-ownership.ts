import type { Sheet } from '../core/types';
import type { SheetDraft, SheetWithExercises } from '../db/store';
import type { RelayProgram } from './canon';
import { CREATOR_PROGRAM_KIND } from './creator-programs';
import { creatorProgramDTag } from './program-publish';

export type PublicationIdentity = Pick<Sheet, 'nostr_pubkey' | 'nostr_address' | 'nostr_event_id' | 'nostr_published_at' | 'origin_created_at'>;

// The active account published this sheet, or imported its own publication. Editing such a
// sheet keeps its address so Publish replaces the same event; editing anyone else's import
// forks it.
export function ownsPublishedSheet(sheet: PublicationIdentity, activePubkey: string | null | undefined): boolean {
  return Boolean(activePubkey
    && sheet.nostr_pubkey === activePubkey
    && sheet.nostr_address?.startsWith(`${CREATOR_PROGRAM_KIND}:${activePubkey}:`));
}

export function publicationIdentity(sheet: PublicationIdentity): PublicationIdentity {
  return {
    nostr_pubkey: sheet.nostr_pubkey,
    nostr_address: sheet.nostr_address,
    nostr_event_id: sheet.nostr_event_id,
    nostr_published_at: sheet.nostr_published_at,
    origin_created_at: sheet.origin_created_at
  };
}

export function relayProgramIdentity(program: RelayProgram): PublicationIdentity {
  return {
    nostr_pubkey: program.pubkey,
    nostr_address: program.address,
    nostr_event_id: program.eventId || undefined,
    nostr_published_at: program.createdAt ? new Date(program.createdAt * 1000).toISOString() : undefined,
    origin_created_at: program.createdAt || undefined
  };
}

export function expectedCreatorProgramAddress(sheet: Pick<SheetWithExercises, 'id' | 'slug' | 'name' | 'nostr_address'>, pubkey: string): string {
  return `${CREATOR_PROGRAM_KIND}:${pubkey}:${creatorProgramDTag(sheet)}`;
}

// The local sheet a relay program authored by the active account came from: the full
// address first, then the event id, then - for a sheet whose address an edit cleared before
// edits kept it - the address its stable slug publishes to. A title alone never matches, and
// another author's program is never claimed.
export function findOwnedProgramSource<T extends Sheet>(program: RelayProgram, sheets: T[], activePubkey: string | null | undefined): T | undefined {
  if (!activePubkey || !program.address || program.pubkey !== activePubkey) return undefined;
  const mine = (sheet: T) => sheet.nostr_pubkey === activePubkey;
  return sheets.find((sheet) => mine(sheet) && sheet.nostr_address === program.address)
    || (program.eventId ? sheets.find((sheet) => mine(sheet) && sheet.nostr_event_id === program.eventId) : undefined)
    || sheets.find((sheet) => !sheet.nostr_address && expectedCreatorProgramAddress(sheet, activePubkey) === program.address);
}

// The same sheet, content untouched, carrying the given publication identity.
export function sheetDraftWithIdentity(sheet: SheetWithExercises, identity: PublicationIdentity): SheetDraft {
  return {
    name: sheet.name,
    notes: sheet.notes,
    difficulty: sheet.difficulty,
    tags: sheet.tags,
    blocks: sheet.blocks,
    is_temporary: sheet.is_temporary,
    source_type: sheet.source_type,
    ...publicationIdentity(identity),
    exercises: sheet.exercises.map(({ id: _id, sheet_id: _sheetId, ...row }) => row)
  };
}
