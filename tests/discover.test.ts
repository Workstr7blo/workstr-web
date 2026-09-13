import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../src/core/types';
import { discoverImportState } from '../src/features/discover/views';
import { createCatalogController } from '../src/app/catalog-controller';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';

const { fetchAuthorMoneroPaymentTargetsMock, fetchCanonExercisesMock } = vi.hoisted(() => ({
  fetchAuthorMoneroPaymentTargetsMock: vi.fn(),
  // Offline unless a test answers, which is what the network guard made every refresh before.
  fetchCanonExercisesMock: vi.fn<() => Promise<Exercise[]>>(async () => { throw new Error('offline'); })
}));

vi.mock('../src/nostr/canon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/canon')>(),
  fetchCanonExercises: fetchCanonExercisesMock
}));

vi.mock('../src/nostr/payment-targets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/payment-targets')>(),
  fetchAuthorMoneroPaymentTargets: fetchAuthorMoneroPaymentTargetsMock
}));

const base: Omit<Exercise, 'slug'> = {
  name: 'Bench Press',
  muscles: ['Chest'],
  equipment: [],
  tags: [],
  instructions: [],
  favourite: false,
  source_type: 'imported',
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const remote = (slug: string, address: string, originCreatedAt: number): Exercise =>
  ({ ...base, slug, nostr_address: address, origin_created_at: originCreatedAt });

const local = (slug: string, address?: string, originCreatedAt?: number): Exercise =>
  ({ ...base, slug, nostr_address: address, origin_created_at: originCreatedAt });

describe('discoverImportState', () => {
  it('is new when nothing local matches', () => {
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 100), [])).toBe('new');
  });

  it('is in-library when the same address exists at the same version', () => {
    const library = [local('bench', '33401:op:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 100), library)).toBe('in-library');
  });

  it('is update when the remote created_at is newer on the same address', () => {
    const library = [local('bench', '33401:op:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('update');
  });

  it('is in-library (not update) when the local row was forked by editing', () => {
    // Editing cleared the nostr address; the slug still collides, so no
    // update is offered — canon updates never clobber local edits.
    const library = [local('bench', undefined, undefined)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('in-library');
  });

  it('matches by full address, not by slug alone', () => {
    const library = [local('bench', '33401:someone-else:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('in-library');
  });
});

// Whose Monero address Discover asks the relays for. The Monero tips switch decides whether the question
// is worth asking at all, and an author is only ever asked about once.
describe('Discover author payment targets', () => {
  const AUTHOR = 'f'.repeat(64);
  const OTHER = 'a'.repeat(64);
  const ADDRESS = `8${'B'.repeat(94)}`;

  const program = (pubkey: string, slug: string): RelayProgram => ({
    slug, name: slug, description: '', difficulty: '', tags: [], exercises: [],
    sourceLabel: 'Workstr', eventId: 'e'.repeat(64), pubkey,
    address: `33402:${pubkey}:workstr:program:${slug}`, createdAt: 1
  } as RelayProgram);

  // Whether the reader is on Workouts at all: `appView` renders one page, so a mounted
  // program list is the same question as a visible one.
  function harness(paymentMode: string, programs: RelayProgram[], programListMounted = true) {
    const state = {
      settings: { unit: 'kg', paymentMode, publicRelays: ['wss://relay.example'] },
      programs,
      authorPaymentTargets: {},
      library: [],
      exercises: [],
      discoverExercises: [],
      sheets: []
    } as unknown as AppState;
    const root = {
      querySelector: (selector: string) => (selector === '.program-list' && programListMounted ? {} : null),
      querySelectorAll: () => []
    } as unknown as HTMLElement;
    const render = vi.fn();
    // Program cards are written into their lists rather than rendered with the page, so
    // "the answer reached the surface" is this call, not a render.
    const renderProgramLists = vi.fn();
    const controller = createCatalogController({
      root, state, render, toast: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), fetchProfile: vi.fn(), renderProgramLists
    });
    return { state, render, renderProgramLists, controller };
  }

  it('asks nothing while Monero tips are off, when no card would use the answer', async () => {
    fetchAuthorMoneroPaymentTargetsMock.mockReset();
    const app = harness('off', [program(AUTHOR, 'push')]);

    await app.controller.refreshAuthorPaymentTargets();

    expect(fetchAuthorMoneroPaymentTargetsMock).not.toHaveBeenCalled();
  });

  it('asks once per author and repaints with the answer', async () => {
    fetchAuthorMoneroPaymentTargetsMock.mockReset();
    fetchAuthorMoneroPaymentTargetsMock.mockResolvedValueOnce({ [AUTHOR]: ADDRESS, [OTHER]: null });
    const app = harness('monero', [program(AUTHOR, 'push'), program(AUTHOR, 'pull'), program(OTHER, 'legs')]);

    await app.controller.refreshAuthorPaymentTargets();

    // One query, both authors, no duplicate for the author of two programs.
    expect(fetchAuthorMoneroPaymentTargetsMock).toHaveBeenCalledTimes(1);
    expect(fetchAuthorMoneroPaymentTargetsMock.mock.calls[0][0]).toEqual([AUTHOR, OTHER]);
    expect(app.state.authorPaymentTargets).toEqual({ [AUTHOR]: ADDRESS, [OTHER]: null });
    expect(app.renderProgramLists).toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();

    // A known absence is an answer, so a rerender or a refresh does not ask again.
    await app.controller.refreshAuthorPaymentTargets();
    expect(fetchAuthorMoneroPaymentTargetsMock).toHaveBeenCalledTimes(1);
  });

  // The answer decorates program cards. A reader on Settings or Statistics has none on
  // screen, and rebuilding the page they are actually reading to change nothing on it is
  // what #178 is about.
  it('keeps the answer without rendering when no program card is on screen', async () => {
    fetchAuthorMoneroPaymentTargetsMock.mockReset();
    fetchAuthorMoneroPaymentTargetsMock.mockResolvedValueOnce({ [AUTHOR]: ADDRESS });
    const app = harness('monero', [program(AUTHOR, 'push')], false);

    await app.controller.refreshAuthorPaymentTargets();

    expect(app.state.authorPaymentTargets).toEqual({ [AUTHOR]: ADDRESS });
    expect(app.renderProgramLists).not.toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();
  });

  it('keeps Discover rendering when the lookup fails', async () => {
    fetchAuthorMoneroPaymentTargetsMock.mockReset();
    fetchAuthorMoneroPaymentTargetsMock.mockRejectedValueOnce(new Error('every relay refused'));
    const app = harness('monero', [program(AUTHOR, 'push')]);

    await expect(app.controller.refreshAuthorPaymentTargets()).resolves.toBeUndefined();
    expect(app.state.authorPaymentTargets).toEqual({});
  });
});

// Import is the last line of defence against a second copy of your own program: a card drawn
// before a publish or an edit landed can still offer it.
describe('importing your own published program', () => {
  const ME = 'a'.repeat(64);
  const relay = {
    slug: 'cardio-carnage-2', name: 'Cardio Carnage #2', description: '', difficulty: 'beginner', tags: [], exercises: [],
    sourceLabel: 'Creator', eventId: 'e'.repeat(64), pubkey: ME,
    address: `33402:${ME}:workstr:beastmode:program:cardio-carnage-2`, createdAt: 1780000000
  } as RelayProgram;

  const localSheet = (extra: Record<string, unknown> = {}) => ({
    id: 4, slug: 'cardio-carnage-2', name: 'Cardio Carnage #2', notes: 'edited locally', difficulty: 'beginner', tags: ['endurance'],
    is_temporary: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
    exercises: [{ id: 9, sheet_id: 4, exercise_slug: 'burpee', exercise_name: 'Burpee', position: 0, sets: 10, reps: '10', rest: 60 }],
    ...extra
  });

  function harness(sheets: unknown[]) {
    const saveSheet = vi.fn(async () => 4);
    const store = { listSheets: vi.fn(async () => sheets), saveSheet, upsertExercise: vi.fn() };
    // Rendered state is deliberately empty: the guard must read the database.
    const state = {
      pubkey: ME, store, settings: { unit: 'kg', publicRelays: [] }, programs: [relay], authorPaymentTargets: {},
      library: [], exercises: [], discoverExercises: [], sheets: []
    } as unknown as AppState;
    const toast = vi.fn();
    const root = { querySelector: () => null, querySelectorAll: () => [] } as unknown as HTMLElement;
    const controller = createCatalogController({
      root, state, render: vi.fn(), toast, openModal: vi.fn(), closeModal: vi.fn(), fetchProfile: vi.fn(), renderProgramLists: vi.fn()
    });
    return { controller, saveSheet, toast, store };
  }

  it('links the local sheet an edit unlinked instead of importing a second copy', async () => {
    const app = harness([localSheet()]);

    await app.controller.importProgram(relay, null);

    expect(app.saveSheet).toHaveBeenCalledTimes(1);
    expect(app.saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      notes: 'edited locally',
      nostr_pubkey: ME,
      nostr_address: relay.address,
      nostr_event_id: relay.eventId,
      // The relay copy is the baseline, so the local edit reads as unpublished changes.
      nostr_published_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      origin_created_at: relay.createdAt,
      exercises: [expect.objectContaining({ exercise_slug: 'burpee', sets: 10 })]
    }), 4);
    expect(app.store.upsertExercise).not.toHaveBeenCalled();
    expect(app.toast).toHaveBeenCalledWith('This is your published program. It is already in Programs.');
  });

  it('writes nothing when the local sheet already carries the address', async () => {
    const app = harness([localSheet({ nostr_pubkey: ME, nostr_address: relay.address, origin_created_at: 1 })]);

    await app.controller.importProgram(relay, null);

    expect(app.saveSheet).not.toHaveBeenCalled();
    expect(app.toast).toHaveBeenCalledWith('This is your published program. It is already in Programs.');
  });
});

describe('the library following the catalog', () => {
  const address = '33401:op:workstr:exercise:mountain-climbers';

  function harness(library: Exercise[]) {
    const rows = library.map((row) => ({ ...row }));
    const store = {
      listExercises: vi.fn(async () => rows.map((row) => ({ ...row }))),
      upsertExercise: vi.fn(async (exercise: Exercise) => {
        const index = rows.findIndex((row) => row.slug === exercise.slug);
        rows[index >= 0 ? index : rows.length] = { ...exercise };
        return exercise.id || 1;
      }),
      saveSettings: vi.fn(async () => {})
    };
    const state = {
      store, settings: { unit: 'kg', publicRelays: [] }, view: 'exercises',
      subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
      library: [], exercises: [], discoverExercises: [], programs: [], sheets: [],
      authorProfiles: {}, profileNames: {}, authorPaymentTargets: {}, exerciseStatus: ''
    } as unknown as AppState;
    const render = vi.fn();
    const root = { querySelector: () => null, querySelectorAll: () => [] } as unknown as HTMLElement;
    const controller = createCatalogController({
      root, state, render, toast: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), fetchProfile: vi.fn(async () => null), renderProgramLists: vi.fn()
    });
    return { controller, state, store, render };
  }

  it('replaces an older library copy on refresh, keeps the favourite, and draws the page again', async () => {
    const app = harness([{ ...base, id: 3, slug: 'mountain-climbers', nostr_address: address, origin_created_at: 100, image_url: 'old.png', favourite: true }]);
    fetchCanonExercisesMock.mockResolvedValueOnce([{ ...base, slug: 'mountain-climbers', nostr_address: address, origin_created_at: 200, image_url: 'new.png' }]);

    await app.controller.refreshExercises();

    expect(app.store.upsertExercise).toHaveBeenCalledWith(expect.objectContaining({ id: 3, image_url: 'new.png', favourite: true, origin_created_at: 200 }));
    expect(app.state.library[0]).toMatchObject({ image_url: 'new.png', favourite: true });
    expect(app.state.exercises.find((exercise) => exercise.slug === 'mountain-climbers')?.image_url).toBe('new.png');
    expect(app.render).toHaveBeenCalledWith({ reason: 'exercise-catalog-loaded' });
  });

  it('writes and draws nothing when the library is already current', async () => {
    const current = { ...base, id: 3, slug: 'mountain-climbers', nostr_address: address, origin_created_at: 200, image_url: 'new.png' };
    const app = harness([current]);
    fetchCanonExercisesMock.mockResolvedValueOnce([{ ...current, id: undefined }]);

    await app.controller.refreshExercises();

    expect(app.store.upsertExercise).not.toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();
  });
});
