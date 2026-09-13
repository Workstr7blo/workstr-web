// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { AppState } from '../src/app/state';
import { createProgramPublishController } from '../src/app/program-publish-controller';
import type { SheetWithExercises, WorkstrStore } from '../src/db/store';
import type { Signer } from '../src/signer/types';

const { publishCreatorProgramMock } = vi.hoisted(() => ({
  publishCreatorProgramMock: vi.fn()
}));

vi.mock('../src/nostr/program-publish', () => ({
  creatorProgramDTag: (sheet: SheetWithExercises) => `workstr:beastmode:program:${sheet.slug}`,
  creatorProgramFingerprint: (sheet: SheetWithExercises) => `fingerprint:${sheet.name}`,
  publishCreatorProgram: publishCreatorProgramMock
}));

function session(id: number, finishedAt: string): AppState['finishedSessions'][number] {
  return { id, sheetName: `Session ${id}`, startedAt: finishedAt, finishedAt, exercises: [], sets: [] };
}

function sheet(partial: Partial<SheetWithExercises> = {}): SheetWithExercises {
  return {
    id: 7,
    slug: 'push-day',
    name: 'Push Day',
    notes: 'Chest and shoulders.',
    difficulty: 'Beast Mode',
    tags: ['push'],
    is_temporary: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    exercises: [{
      id: 9,
      sheet_id: 7,
      exercise_slug: 'bench-press',
      exercise_name: 'Bench Press',
      muscle_group: 'Chest',
      image_url: '',
      position: 0,
      sets: 4,
      reps: '8',
      rest: 120,
      weight: 60,
      notes: 'pause reps'
    }],
    ...partial
  };
}

function state(partial: Partial<AppState> = {}): AppState {
  return {
    pubkey: null,
    npub: null,
    profileName: null,
    profilePicture: null,
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg', publicRelays: ['wss://nos.lol'] },
    monero: { status: 'idle', address: '' },
    signerType: null,
    view: 'workouts',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
    activeSession: null,
    finishedSessions: [],
    publishingSessionId: null,
    publishingStatus: null,
    editingId: null,
    filter: '',
    programFilter: '',
    expandedProgramAddress: null,
    exerciseStatus: '',
    programStatus: '',
    signInStatus: null,
    backup: { state: 'off', pending: 0 },
    expandedSessionId: null,
    history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [],
    sheets: [],
    library: [],
    librarySelect: { active: false, slugs: new Set() },
    discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [],
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    ...partial
  } as AppState;
}

describe('createProgramPublishController', () => {
  it('opens the locked checklist instead of signing when Beast Mode is locked', async () => {
    const appState = state({ sheets: [sheet()] });
    const openModal = vi.fn();
    const controller = createProgramPublishController({
      root: document.createElement('div'),
      state: appState,
      render: vi.fn(),
      toast: vi.fn(),
      openModal,
      getSigner: vi.fn(async () => ({}) as Signer)
    });

    await controller.publishProgram('local:7');

    expect(openModal).toHaveBeenCalledWith(expect.stringContaining('Beast Mode is locked'));
    expect(publishCreatorProgramMock).not.toHaveBeenCalled();
  });

  it('uses the active signer, public relay settings, and stores published program identity after a relay acknowledgement', async () => {
    const program = sheet();
    const savedSheets = [sheet({ nostr_address: '33402:pubkey:workstr:beastmode:program:push-day' })];
    const store = {
      saveSheet: vi.fn(async () => 7),
      listSheets: vi.fn(async () => savedSheets)
    } as unknown as WorkstrStore;
    const appState = state({
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.test/avatar.png',
      sheets: [program],
      store,
      finishedSessions: [
        session(1, '2026-08-01T10:00:00'),
        session(2, '2026-08-01T11:00:00'),
        session(3, '2026-08-02T10:00:00'),
        session(4, '2026-08-03T10:00:00'),
        session(5, '2026-08-03T11:00:00')
      ],
      settings: { unit: 'kg', publicRelays: ['wss://nos.lol', 'wss://relay.workstr.fit'] }
    });
    const signer = { type: 'local' } as Signer;
    publishCreatorProgramMock.mockResolvedValueOnce({
      event: { id: 'event123', pubkey: 'pubkey', created_at: 1780000000, kind: 33402, tags: [], content: '', sig: '' },
      okRelays: ['wss://nos.lol'],
      failedRelays: [],
      confirmed: true
    });
    const toast = vi.fn();
    const render = vi.fn();
    const controller = createProgramPublishController({
      root: document.createElement('div'),
      state: appState,
      render,
      toast,
      openModal: vi.fn(),
      getSigner: vi.fn(async () => signer)
    });

    await controller.publishProgram('local:7');

    expect(publishCreatorProgramMock).toHaveBeenCalledWith(signer, program, ['wss://nos.lol', 'wss://relay.workstr.fit'], expect.any(Object));
    expect(store.saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      nostr_pubkey: 'pubkey',
      nostr_address: '33402:pubkey:workstr:beastmode:program:push-day',
      nostr_event_id: 'event123',
      nostr_published_content_hash: 'fingerprint:Push Day',
      origin_created_at: 1780000000
    }), 7);
    expect(appState.sheets).toBe(savedSheets);
    expect(render).toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Published Push Day to 1 public relay and confirmed.', 'ok');
  });

  it('lets browser smoke inject a publisher and use no configured public relays', async () => {
    publishCreatorProgramMock.mockClear();
    const appState = state({
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.test/avatar.png',
      sheets: [sheet()],
      finishedSessions: [
        session(1, '2026-08-01T10:00:00'), session(2, '2026-08-01T11:00:00'),
        session(3, '2026-08-02T10:00:00'), session(4, '2026-08-03T10:00:00'),
        session(5, '2026-08-03T11:00:00')
      ],
      settings: { unit: 'kg', publicRelays: [] }
    });
    const injectedPublisher = vi.fn(async () => ({
      event: { id: 'smoke-event', pubkey: 'smoke-pubkey', created_at: 1780000000, kind: 33402, tags: [], content: '', sig: '' },
      okRelays: [], failedRelays: [], confirmed: false
    }));
    const controller = createProgramPublishController({
      root: document.createElement('div'), state: appState, render: vi.fn(), toast: vi.fn(), openModal: vi.fn(),
      getSigner: vi.fn(async () => ({ type: 'local' }) as Signer), publishCreatorProgram: injectedPublisher
    });

    await controller.publishProgram('local:7');

    expect(injectedPublisher).toHaveBeenCalledWith(expect.anything(), appState.sheets[0], [], expect.any(Object));
    expect(publishCreatorProgramMock).not.toHaveBeenCalled();
  });
});

describe('deleting a program from relays', () => {
  const ME = 'f'.repeat(64);
  const address = `33402:${ME}:workstr:beastmode:program:cardio-carnage-2`;
  const relayCopy = {
    slug: 'cardio-carnage-2', name: 'Cardio Carnage #2', description: '', tags: [], exercises: [], sourceLabel: 'creator',
    eventId: 'e'.repeat(64), pubkey: ME, address, createdAt: 1
  };
  const deletion = { event: { id: 'd'.repeat(64), pubkey: ME, created_at: 2, kind: 5, tags: [], content: '', sig: '' }, okRelays: ['wss://nos.lol'], failedRelays: [] };

  function setup(partial: Partial<AppState>, confirmed = true) {
    vi.spyOn(window, 'confirm').mockReturnValue(confirmed);
    const deleteCreatorProgram = vi.fn(async (..._args: unknown[]) => deletion);
    const persistCanonCache = vi.fn(async () => {});
    const toast = vi.fn();
    const appState = state({ pubkey: ME, settings: { unit: 'kg', publicRelays: ['wss://nos.lol'] }, ...partial });
    const controller = createProgramPublishController({
      root: document.createElement('div'), state: appState, render: vi.fn(), toast, openModal: vi.fn(),
      getSigner: vi.fn(async () => ({ type: 'local' }) as Signer), deleteCreatorProgram, persistCanonCache
    });
    return { controller, appState, deleteCreatorProgram, persistCanonCache, toast };
  }

  it('retracts a relay copy with no local program and drops it from Discover', async () => {
    const app = setup({ programs: [relayCopy] as unknown as AppState['programs'] });

    await app.controller.deleteFromRelays(address);

    expect(app.deleteCreatorProgram).toHaveBeenCalledWith(expect.anything(), { address, eventId: 'e'.repeat(64) }, expect.arrayContaining(['wss://nos.lol', 'wss://relay.damus.io']), expect.any(Object));
    expect(app.appState.programs).toEqual([]);
    expect(app.persistCanonCache).toHaveBeenCalled();
    expect(app.toast).toHaveBeenLastCalledWith('Deleted Cardio Carnage #2 from 1 public relay.', 'ok');
  });

  it('keeps a linked local program but makes it local-only', async () => {
    const linked = sheet({ nostr_pubkey: ME, nostr_address: address, nostr_event_id: 'e'.repeat(64) });
    const store = { saveSheet: vi.fn(async () => 7), listSheets: vi.fn(async () => [sheet()]) } as unknown as WorkstrStore;
    const app = setup({ sheets: [linked], programs: [relayCopy] as unknown as AppState['programs'], store });

    await app.controller.deleteFromRelays('local:7');

    expect(app.deleteCreatorProgram).toHaveBeenCalledWith(expect.anything(), { address, eventId: 'e'.repeat(64) }, expect.any(Array), expect.any(Object));
    expect(store.saveSheet).toHaveBeenCalledWith(expect.objectContaining({ name: 'Push Day', nostr_address: undefined, nostr_event_id: undefined }), 7);
    expect(app.appState.programs).toEqual([]);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('It stays in Programs on this device.'));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const app = setup({ programs: [relayCopy] as unknown as AppState['programs'] }, false);
    await app.controller.deleteFromRelays(address);
    expect(app.deleteCreatorProgram).not.toHaveBeenCalled();
    expect(app.appState.programs).toHaveLength(1);
  });

  it('changes nothing when no relay accepts the deletion', async () => {
    const app = setup({ programs: [relayCopy] as unknown as AppState['programs'] });
    app.deleteCreatorProgram.mockRejectedValueOnce(new Error('no public relay accepted the deletion'));
    await app.controller.deleteFromRelays(address);
    expect(app.appState.programs).toHaveLength(1);
    expect(app.persistCanonCache).not.toHaveBeenCalled();
    expect(app.toast).toHaveBeenLastCalledWith('no public relay accepted the deletion', 'bad');
  });
});
