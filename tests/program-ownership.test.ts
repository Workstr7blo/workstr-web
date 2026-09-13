import { describe, expect, it } from 'vitest';
import { WorkstrStore, type SheetWithExercises } from '../src/db/store';
import type { RelayProgram } from '../src/nostr/canon';
import { CREATOR_PROGRAM_D_PREFIX } from '../src/nostr/creator-programs';
import { editablePublicationIdentity, expectedCreatorProgramAddress, findOwnedProgramSource, ownsPublishedSheet, planOwnedDuplicateRepairs, publicationIdentity, relayProgramIdentity, repairOwnedProgramDuplicates, sheetDraftWithIdentity, sheetPublicationState } from '../src/nostr/program-ownership';
import { programImportState } from '../src/nostr/programImport';
import { creatorProgramDTag, creatorProgramFingerprint } from '../src/nostr/program-publish';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const addressOf = (pubkey: string, slug: string) => `33402:${pubkey}:${CREATOR_PROGRAM_D_PREFIX}${slug}`;

function sheet(id: number, slug: string, extra: Partial<SheetWithExercises> = {}): SheetWithExercises {
  return {
    id,
    slug,
    name: 'Cardio Carnage #2',
    notes: 'Edited locally.',
    difficulty: 'beginner',
    tags: ['endurance'],
    is_temporary: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    exercises: [{
      id: 30 + id,
      sheet_id: id,
      exercise_slug: 'burpee',
      exercise_name: 'Burpee',
      muscle_group: 'Core',
      image_url: '',
      position: 0,
      sets: 10,
      reps: '10',
      rest: 60,
      weight: 0,
      notes: ''
    }],
    ...extra
  };
}

function published(id: number, slug: string, pubkey: string, extra: Partial<SheetWithExercises> = {}): SheetWithExercises {
  return sheet(id, slug, {
    nostr_pubkey: pubkey,
    nostr_address: addressOf(pubkey, slug),
    nostr_event_id: `event-${id}`,
    origin_created_at: 1780000000,
    ...extra
  });
}

function relayProgram(pubkey: string, slug: string, extra: Partial<RelayProgram> = {}): RelayProgram {
  return {
    slug,
    name: 'Cardio Carnage #2',
    description: '',
    difficulty: 'beginner',
    tags: [],
    exercises: [],
    sourceLabel: 'Creator',
    eventId: 'relay-event',
    pubkey,
    address: addressOf(pubkey, slug),
    createdAt: 1780000500,
    ...extra
  };
}

describe('ownsPublishedSheet', () => {
  it('is true for a creator program published by the active account', () => {
    expect(ownsPublishedSheet(published(1, 'cardio-carnage-2', ME), ME)).toBe(true);
  });

  it('is false for another author, a signed-out reader, or a sheet with no address', () => {
    expect(ownsPublishedSheet(published(1, 'cardio-carnage-2', OTHER), ME)).toBe(false);
    expect(ownsPublishedSheet(published(1, 'cardio-carnage-2', ME), null)).toBe(false);
    expect(ownsPublishedSheet(sheet(1, 'cardio-carnage-2', { nostr_pubkey: ME }), ME)).toBe(false);
  });
});

describe('findOwnedProgramSource', () => {
  it('finds the sheet carrying the program address', () => {
    const source = published(2, 'cardio-carnage-2', ME);
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [sheet(1, 'leg-day'), source], ME)).toBe(source);
  });

  it('finds the sheet carrying the event id when the address differs', () => {
    const source = published(2, 'old-slug', ME, { nostr_event_id: 'relay-event' });
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [source], ME)).toBe(source);
  });

  it('finds an addressless sheet whose stable slug publishes to the program address', () => {
    const source = sheet(1, 'cardio-carnage-2');
    expect(expectedCreatorProgramAddress(source, ME)).toBe(addressOf(ME, 'cardio-carnage-2'));
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [source], ME)).toBe(source);
  });

  it('prefers the linked sheet over an addressless one with the same slug address', () => {
    const linked = published(2, 'cardio-carnage-2-2', ME, { nostr_address: addressOf(ME, 'cardio-carnage-2') });
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [sheet(1, 'cardio-carnage-2'), linked], ME)).toBe(linked);
  });

  it('never claims another author program, even when a local slug matches', () => {
    expect(findOwnedProgramSource(relayProgram(OTHER, 'cardio-carnage-2'), [sheet(1, 'cardio-carnage-2')], ME)).toBeUndefined();
  });

  it('does not match on title alone', () => {
    // Same name, different slug: a separate program that happens to share a title.
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [sheet(1, 'cardio-carnage-2-2')], ME)).toBeUndefined();
  });

  it('matches nothing while signed out', () => {
    expect(findOwnedProgramSource(relayProgram(ME, 'cardio-carnage-2'), [published(1, 'cardio-carnage-2', ME)], null)).toBeUndefined();
  });
});

describe('sheetDraftWithIdentity', () => {
  it('keeps the sheet content and rows and applies only the identity', () => {
    const draft = sheetDraftWithIdentity(sheet(4, 'cardio-carnage-2'), relayProgramIdentity(relayProgram(ME, 'cardio-carnage-2')));
    expect(draft).toMatchObject({
      name: 'Cardio Carnage #2',
      notes: 'Edited locally.',
      tags: ['endurance'],
      nostr_pubkey: ME,
      nostr_address: addressOf(ME, 'cardio-carnage-2'),
      nostr_event_id: 'relay-event',
      nostr_published_at: new Date(1780000500 * 1000).toISOString(),
      origin_created_at: 1780000500
    });
    expect(draft.exercises).toEqual([expect.objectContaining({ exercise_slug: 'burpee', sets: 10, reps: '10' })]);
    expect(draft.exercises[0]).not.toHaveProperty('id');
    expect(draft.exercises[0]).not.toHaveProperty('sheet_id');
  });
});

// The #221 path end to end through IndexedDB: publish, edit in the builder, publish again.
describe('an owned program through the store', () => {
  it('stays one sheet at one address through publish, edit, and republish', async () => {
    const store = await WorkstrStore.open('program-ownership-roundtrip');
    const { id: _id, slug: _slug, created_at: _created, updated_at: _updated, ...content } = sheet(0, 'unused');
    const id = await store.saveSheet({ ...content, exercises: content.exercises.map(({ id: _rowId, sheet_id: _sheetId, ...row }) => row) });
    const [created] = await store.listSheets();

    // Publish: the controller writes the event identity onto the same sheet.
    const address = expectedCreatorProgramAddress(created, ME);
    await store.saveSheet(sheetDraftWithIdentity(created, { nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'ev1', origin_created_at: 100 }), id);
    const [published] = await store.listSheets();
    expect(ownsPublishedSheet(published, ME)).toBe(true);

    // Edit: the builder renames it and carries the identity through.
    await store.saveSheet({ ...sheetDraftWithIdentity(published, {}), name: 'Cardio Carnage Heavy', ...publicationIdentity(published) }, id);
    const sheets = await store.listSheets();

    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ id, slug: created.slug, name: 'Cardio Carnage Heavy', nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'ev1' });
    // Republishing after the rename targets the same replaceable event.
    expect(expectedCreatorProgramAddress(sheets[0], ME)).toBe(address);
    expect(creatorProgramDTag(sheets[0])).toBe(creatorProgramDTag(published));
    // A newer relay copy of it (another device published) is still not offered over the edit.
    expect(programImportState(relayProgram(ME, created.slug, { address, createdAt: 200 }), sheets, ME)).toBe('in-library');
  });
});

function tracked(source: SheetWithExercises): SheetWithExercises {
  return { ...source, nostr_published_content_hash: creatorProgramFingerprint(source) };
}

describe('sheetPublicationState', () => {
  it('is local for a sheet that is not the active account publication', () => {
    expect(sheetPublicationState(sheet(1, 'cardio-carnage-2'), ME)).toBe('local');
    expect(sheetPublicationState(tracked(published(1, 'cardio-carnage-2', OTHER)), ME)).toBe('local');
    expect(sheetPublicationState(tracked(published(1, 'cardio-carnage-2', ME)), null)).toBe('local');
  });

  it('is published while the content matches what went out', () => {
    const source = tracked(published(1, 'cardio-carnage-2', ME));
    expect(sheetPublicationState(source, ME)).toBe('published');
    // Sync and migrations move timestamps and row ids; none of that is public content.
    expect(sheetPublicationState({ ...source, updated_at: '2026-09-10T00:00:00.000Z', exercises: source.exercises.map((row) => ({ ...row, id: 99 })) }, ME)).toBe('published');
  });

  it('is changed once public content differs', () => {
    const source = tracked(published(1, 'cardio-carnage-2', ME));
    expect(sheetPublicationState({ ...source, name: 'Cardio Carnage Heavy' }, ME)).toBe('changed');
    expect(sheetPublicationState({ ...source, exercises: source.exercises.map((row) => ({ ...row, reps: '12' })) }, ME)).toBe('changed');
  });

  it('reads an untracked publication as published rather than inventing changes', () => {
    expect(sheetPublicationState(published(1, 'cardio-carnage-2', ME), ME)).toBe('published');
  });
});

describe('editablePublicationIdentity', () => {
  it('carries nothing for someone else program, so the builder forks it', () => {
    expect(editablePublicationIdentity(published(1, 'cardio-carnage-2', OTHER), ME)).toEqual({});
  });

  it('stamps an untracked publication with its content as opened', () => {
    const source = published(1, 'cardio-carnage-2', ME);
    const identity = editablePublicationIdentity(source, ME);
    expect(identity).toMatchObject({ nostr_address: source.nostr_address, nostr_event_id: source.nostr_event_id, nostr_published_content_hash: creatorProgramFingerprint(source) });
    // The edit the builder is about to save is therefore visible.
    expect(sheetPublicationState({ ...source, ...identity, notes: 'Changed in the builder.' }, ME)).toBe('changed');
  });

  it('keeps a stored fingerprint instead of re-stamping over an earlier edit', () => {
    const source = { ...published(1, 'cardio-carnage-2', ME), nostr_published_content_hash: 'as-published' };
    expect(editablePublicationIdentity(source, ME).nostr_published_content_hash).toBe('as-published');
  });
});

describe('planOwnedDuplicateRepairs', () => {
  // The #221 shape: the source lost its address to an edit, then Discover imported it back.
  const source = () => sheet(1, 'cardio-carnage-2');
  const copy = (id = 2, extra: Partial<SheetWithExercises> = {}) => published(id, `cardio-carnage-2-${id}`, ME, { nostr_address: addressOf(ME, 'cardio-carnage-2'), notes: 'As published.', ...extra });

  it('keeps the source and removes the imported copy for the exact relationship', () => {
    const keep = source();
    const remove = copy();
    expect(planOwnedDuplicateRepairs([keep, remove, sheet(3, 'leg-day')], ME)).toEqual([{ keep, remove }]);
  });

  it('still repairs when an interrupted repair already linked the source', () => {
    const keep = { ...source(), nostr_pubkey: ME, nostr_address: addressOf(ME, 'cardio-carnage-2') };
    const remove = copy();
    expect(planOwnedDuplicateRepairs([keep, remove], ME)).toEqual([{ keep, remove }]);
  });

  it('leaves ambiguous candidates alone', () => {
    expect(planOwnedDuplicateRepairs([source(), copy(2), copy(3)], ME)).toEqual([]);
  });

  it('never repairs another author program or a title-only match', () => {
    expect(planOwnedDuplicateRepairs([source(), published(2, 'cardio-carnage-2-2', OTHER, { nostr_address: addressOf(OTHER, 'cardio-carnage-2') })], ME)).toEqual([]);
    // Same title, but no sheet whose slug publishes to the copy's address.
    expect(planOwnedDuplicateRepairs([sheet(1, 'cardio-carnage-3'), copy()], ME)).toEqual([]);
  });

  it('does nothing for a lone publication or while signed out', () => {
    expect(planOwnedDuplicateRepairs([published(1, 'cardio-carnage-2', ME)], ME)).toEqual([]);
    expect(planOwnedDuplicateRepairs([source(), copy()], null)).toEqual([]);
  });
});

describe('repairing an existing duplicate through the store', () => {
  it('keeps the original sheet, attaches the publication, and removes the copy', async () => {
    const store = await WorkstrStore.open('program-ownership-repair');
    const rows = sheet(0, 'unused').exercises.map(({ id: _rowId, sheet_id: _sheetId, ...row }) => row);
    const sourceId = await store.saveSheet({ name: 'Cardio Carnage #2', notes: 'Edited locally.', tags: ['endurance'], exercises: rows });
    const [original] = await store.listSheets();
    const address = expectedCreatorProgramAddress(original, ME);
    const copyId = await store.saveSheet({ name: 'Cardio Carnage #2', notes: 'As published.', exercises: rows, nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'relay-event', origin_created_at: 1780000500 });
    const copyRow = (await store.listSheets()).find((row) => row.id === copyId)!;
    expect(copyRow.slug).not.toBe(original.slug);

    expect(await repairOwnedProgramDuplicates(store, ME)).toBe(1);
    const sheets = await store.listSheets();

    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ id: sourceId, slug: original.slug, notes: 'Edited locally.', tags: ['endurance'], nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'relay-event', origin_created_at: 1780000500 });
    expect(sheets[0].exercises).toEqual([expect.objectContaining({ exercise_slug: 'burpee', sets: 10, reps: '10' })]);
    // The copy is the account of what went out, so the local edit shows as unpublished.
    expect(sheets[0].nostr_published_content_hash).toBe(creatorProgramFingerprint(copyRow));
    expect(sheetPublicationState(sheets[0], ME)).toBe('changed');
    // Idempotent: the next launch finds nothing to do.
    expect(await repairOwnedProgramDuplicates(store, ME)).toBe(0);
  });
});
