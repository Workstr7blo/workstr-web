import type { Sheet } from '../core/types';
import type { SheetDraft, SheetWithExercises } from '../db/store';
import type { RelayProgram } from './canon';
import { CREATOR_PROGRAM_KIND } from './creator-programs';
import { creatorProgramDTag, creatorProgramFingerprint, type PublishableProgram } from './program-publish';

export type PublicationIdentity = Pick<Sheet, 'nostr_pubkey' | 'nostr_address' | 'nostr_event_id' | 'nostr_published_at' | 'nostr_published_content_hash' | 'origin_created_at'>;

// 'local' is anything that is not the active account's own publication, including someone
// else's import. 'changed' is the user's own publication edited since it last went out.
export type ProgramPublicationState = 'local' | 'published' | 'changed';

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
    nostr_published_content_hash: sheet.nostr_published_content_hash,
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

// A publication with no stored fingerprint predates tracking it. Nothing records what went
// out, so it reads as published rather than inventing changes the user never made.
export function sheetPublicationState(sheet: SheetWithExercises, activePubkey: string | null | undefined): ProgramPublicationState {
  if (!ownsPublishedSheet(sheet, activePubkey)) return 'local';
  if (!sheet.nostr_published_content_hash) return 'published';
  return creatorProgramFingerprint(sheet) === sheet.nostr_published_content_hash ? 'published' : 'changed';
}

// The identity the builder carries onto a save. An untracked publication is stamped with its
// content as the builder opened it, so the edit being made is the first one it can see.
export function editablePublicationIdentity(sheet: SheetWithExercises, activePubkey: string | null | undefined): PublicationIdentity {
  if (!ownsPublishedSheet(sheet, activePubkey)) return {};
  return { ...publicationIdentity(sheet), nostr_published_content_hash: sheet.nostr_published_content_hash || creatorProgramFingerprint(sheet) };
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

// Relinking a source to a relay copy it has no record of: the import snapshot of that copy is
// the best available account of what went out, so it is the baseline. A lossy round trip can
// only err towards offering Publish update, which is harmless.
export function relayBaselineIdentity(program: RelayProgram, snapshot: PublishableProgram): PublicationIdentity {
  return { ...relayProgramIdentity(program), nostr_published_content_hash: creatorProgramFingerprint(snapshot) };
}

export interface OwnedDuplicateRepair {
  keep: SheetWithExercises;
  remove: SheetWithExercises;
}

// Duplicates the #221 bug left behind: the user's own program imported back from Discover
// beside the sheet it was published from. Only the exact relationship is repaired - one
// source whose stable slug publishes to the address, one other sheet carrying that address.
// The source may already carry the address too, which is what an interrupted repair leaves.
// Any other count on either side is ambiguous and left alone.
export function planOwnedDuplicateRepairs(sheets: SheetWithExercises[], activePubkey: string | null | undefined): OwnedDuplicateRepair[] {
  if (!activePubkey) return [];
  const addresses = new Set(sheets.filter((sheet) => ownsPublishedSheet(sheet, activePubkey)).map((sheet) => sheet.nostr_address!));
  const repairs: OwnedDuplicateRepair[] = [];
  for (const address of addresses) {
    const sources = sheets.filter((sheet) => (!sheet.nostr_address || sheet.nostr_address === address)
      && sheet.slug && expectedCreatorProgramAddress({ ...sheet, nostr_address: undefined }, activePubkey) === address);
    if (sources.length !== 1) continue;
    const copies = sheets.filter((sheet) => sheet !== sources[0] && sheet.nostr_address === address);
    if (copies.length !== 1 || !ownsPublishedSheet(copies[0], activePubkey)) continue;
    repairs.push({ keep: sources[0], remove: copies[0] });
  }
  return repairs;
}

export interface OwnedDuplicateStore {
  listSheets(): Promise<SheetWithExercises[]>;
  saveSheet(draft: SheetDraft, id?: number): Promise<number>;
  deleteSheet(id: number): Promise<void>;
}

// The source keeps its id, slug and content and takes the copy's identity; then the copy goes.
// Linking first means an interruption leaves two linked sheets, which the plan still repairs.
export async function repairOwnedProgramDuplicates(store: OwnedDuplicateStore, activePubkey: string | null | undefined): Promise<number> {
  const repairs = planOwnedDuplicateRepairs(await store.listSheets(), activePubkey);
  for (const { keep, remove } of repairs) {
    if (!keep.id || !remove.id) continue;
    const baseline = keep.nostr_published_content_hash || remove.nostr_published_content_hash || creatorProgramFingerprint(remove);
    await store.saveSheet(sheetDraftWithIdentity(keep, { ...publicationIdentity(remove), nostr_published_content_hash: baseline }), keep.id);
    await store.deleteSheet(remove.id);
  }
  return repairs.length;
}
