import { describe, expect, it } from 'vitest';
import { WorkstrStore } from '../src/db/store';
import { applyStarterSeed, seedContent, SEED_VERSION } from '../src/db/seed';
import { namespaceHasUserData } from '../src/db/adopt';
import { discoverImportState } from '../src/features/discover/views';
import { programImportState } from '../src/nostr/programImport';

let counter = 0;
const freshStore = () => WorkstrStore.open(`seed-${Date.now()}-${counter++}`);

describe('starter seed content', () => {
  it('parses three signed beginner programs and the exercises they reference', () => {
    const { exercises, programs } = seedContent();
    expect(programs).toHaveLength(3);
    expect(programs.map((program) => program.name).sort())
      .toEqual(['Core Stability Starter', 'Foundation Full Body', 'Legs & Glutes']);
    expect(exercises.length).toBeGreaterThanOrEqual(10);
    // Signature and author checks happen at parse time; anything that failed
    // them would simply be absent, so a full set is the assertion.
    for (const exercise of exercises) {
      expect(exercise.source_type).toBe('bundle');
      expect(exercise.nostr_address).toMatch(/^33401:[0-9a-f]{64}:workstr:exercise:/);
      expect(exercise.origin_created_at).toBeGreaterThan(0);
    }
  });

  it('resolves every program reference to a seeded exercise', () => {
    const { exercises, programs } = seedContent();
    const addresses = new Set(exercises.map((exercise) => exercise.nostr_address));
    for (const program of programs) {
      for (const member of program.exercises) {
        expect(addresses.has(member.address)).toBe(true);
      }
    }
  });
});

describe('applyStarterSeed', () => {
  it('fills a fresh namespace and records the version', async () => {
    const store = await freshStore();
    const result = await applyStarterSeed(store);
    expect(result.applied).toBe(true);
    expect(result.programs).toBe(3);
    expect(result.exercises).toBeGreaterThanOrEqual(10);

    const sheets = await store.listSheets();
    expect(sheets).toHaveLength(3);
    // Every program row points at a real library exercise, not a name-only
    // fallback — the seeded library has to be in place first.
    const slugs = new Set((await store.listExercises()).map((exercise) => exercise.slug));
    for (const sheet of sheets) {
      expect(sheet.exercises.length).toBeGreaterThan(0);
      for (const row of sheet.exercises) expect(slugs.has(row.exercise_slug!)).toBe(true);
    }
    expect((await store.getSettings()).seedVersion).toBe(SEED_VERSION);
  });

  it('is a no-op on the second run', async () => {
    const store = await freshStore();
    await applyStarterSeed(store);
    const before = (await store.listExercises()).length;

    const second = await applyStarterSeed(store);
    expect(second.applied).toBe(false);
    expect((await store.listExercises()).length).toBe(before);
    expect(await store.listSheets()).toHaveLength(3);
  });

  it('never resurrects an exercise the user deleted', async () => {
    const store = await freshStore();
    await applyStarterSeed(store);
    const victim = (await store.listExercises())[0];
    await store.deleteExercise(victim.id!);
    expect((await store.listExercises()).some((exercise) => exercise.slug === victim.slug)).toBe(false);

    // Even forced to re-run, the taken slug stays taken.
    await store.saveSettings({ ...(await store.getSettings()), seedVersion: 0 });
    await applyStarterSeed(store);
    expect((await store.listExercises()).some((exercise) => exercise.slug === victim.slug)).toBe(false);
  });

  it('never overwrites a row that already occupies a seeded slug', async () => {
    const store = await freshStore();
    const { exercises } = seedContent();
    const taken = exercises[0];
    await store.upsertExercise({
      slug: taken.slug,
      name: 'My own version',
      muscles: [],
      equipment: [],
      tags: [],
      instructions: [],
      favourite: true,
      source_type: 'manual',
      status: 'active'
    });

    await applyStarterSeed(store);
    const kept = (await store.listExercises()).find((exercise) => exercise.slug === taken.slug);
    expect(kept?.name).toBe('My own version');
    expect(kept?.favourite).toBe(true);
    expect(kept?.source_type).toBe('manual');
  });

  it('does not duplicate a program already imported from the catalog', async () => {
    const store = await freshStore();
    const { programs } = seedContent();
    await store.saveSheet({
      name: 'Already here',
      nostr_address: programs[0].address,
      origin_created_at: programs[0].createdAt,
      exercises: []
    });

    const result = await applyStarterSeed(store);
    expect(result.programs).toBe(2);
    expect(await store.listSheets()).toHaveLength(3);
  });

  it('retires pre-seed bundled rows on first run, keeping favourites', async () => {
    const store = await freshStore();
    await store.upsertExercise({
      slug: 'legacy-untouched', name: 'Legacy', muscles: [], equipment: [], tags: [],
      instructions: [], source_type: 'bundle'
    });
    await store.upsertExercise({
      slug: 'legacy-favourite', name: 'Legacy Favourite', muscles: [], equipment: [], tags: [],
      instructions: [], source_type: 'bundle', favourite: true
    });

    await applyStarterSeed(store);
    const slugs = (await store.listExercises()).map((exercise) => exercise.slug);
    expect(slugs).not.toContain('legacy-untouched');
    expect(slugs).toContain('legacy-favourite');
  });
});

describe('seeded rows behave like catalog imports', () => {
  it('reports in-library rather than offering a duplicate', async () => {
    const store = await freshStore();
    await applyStarterSeed(store);
    const library = await store.listExercises();
    const { exercises, programs } = seedContent();

    for (const exercise of exercises) expect(discoverImportState(exercise, library)).toBe('in-library');
    for (const program of programs) expect(programImportState(program, await store.listSheets())).toBe('in-library');
  });

  it('surfaces an update when the catalog republishes a seeded entry', async () => {
    const store = await freshStore();
    await applyStarterSeed(store);
    const { exercises, programs } = seedContent();

    const republished = { ...exercises[0], origin_created_at: exercises[0].origin_created_at! + 1 };
    expect(discoverImportState(republished, await store.listExercises())).toBe('update');

    const newerProgram = { ...programs[0], createdAt: programs[0].createdAt + 1 };
    expect(programImportState(newerProgram, await store.listSheets())).toBe('update');
  });
});

describe('seed and account adoption', () => {
  it('leaves a seed-only namespace looking empty, so sign-in does not prompt', async () => {
    const namespace = `seed-adopt-${Date.now()}`;
    const store = await WorkstrStore.open(namespace);
    await applyStarterSeed(store);
    store.close();
    expect(await namespaceHasUserData(namespace)).toBe(false);
  });

  it('counts a favourited starter exercise as user data', async () => {
    const namespace = `seed-adopt-fav-${Date.now()}`;
    const store = await WorkstrStore.open(namespace);
    await applyStarterSeed(store);
    const first = (await store.listExercises())[0];
    await store.upsertExercise({ ...first, favourite: true });
    store.close();
    expect(await namespaceHasUserData(namespace)).toBe(true);
  });
});

describe('editing a starter program forks it', () => {
  it('clears the seed marker, so an edited starter counts as user data', async () => {
    const namespace = `seed-fork-${Date.now()}`;
    const store = await WorkstrStore.open(namespace);
    await applyStarterSeed(store);
    expect(await namespaceHasUserData(namespace)).toBe(false);

    // A builder save carries no seed marker and no nostr identity.
    const sheet = (await store.listSheets())[0];
    await store.saveSheet({ name: `${sheet.name} (mine)`, exercises: [] }, sheet.id);

    const forked = (await store.listSheets()).find((entry) => entry.id === sheet.id);
    expect(forked?.source_type).toBeUndefined();
    expect(forked?.nostr_address).toBeUndefined();
    store.close();
    expect(await namespaceHasUserData(namespace)).toBe(true);
  });
});
