// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityController, type IdentityControllerContext } from '../src/app/identity-controller';
import { createLocalAccount } from '../src/signer/local-key';
import { WorkstrStore, type ExerciseDraft } from '../src/db/store';
import { namespaceHasUserData, deleteNamespace } from '../src/db/adopt';
import type { AppState } from '../src/app/state';

vi.mock('../src/signer/nip07', () => ({ hasNip07: () => false, createNip07Signer: vi.fn() }));
vi.mock('../src/signer/nip46', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/signer/nip46')>();
  return { ...actual, createNostrConnectSignerRequest: vi.fn(), createBunkerSigner: vi.fn(), createCachedNip46Signer: vi.fn(() => null) };
});

const PUBKEY = 'a'.repeat(64);

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: null,
    npub: null,
    profileName: null,
    profileNames: {},
    store: null,
    settings: { unit: 'kg', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    signerType: null,
    view: 'settings',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
    expandedSessionId: null,
    history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [],
    sheets: [],
    library: [],
    librarySelect: { active: false, slugs: new Set<string>() },
    discoverSelect: { active: false, addresses: new Set<string>() },
    discoverExercises: [],
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    activeSession: null,
    finishedSessions: [],
    publishingSessionId: null,
    publishingStatus: null,
    editingId: 7,
    filter: '',
    programFilter: '',
    expandedProgramAddress: null,
    exerciseStatus: '',
    programStatus: '',
    signInStatus: null,
    backup: { state: 'off', pending: 0 },
    ...overrides
  } as AppState;
}

interface Harness {
  ctx: IdentityControllerContext;
  state: AppState;
  root: HTMLElement;
  openIdentity: ReturnType<typeof vi.fn>;
  openLocal: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  modal(): HTMLElement;
}

function harness(stateOverrides: Partial<AppState> = {}): Harness {
  document.body.innerHTML = '<div id="app"><div id="modal"><div id="modal-content"></div></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const state = baseState(stateOverrides);
  const openIdentity = vi.fn(async (pubkey: string) => { state.pubkey = pubkey; });
  const openLocal = vi.fn(async () => { state.pubkey = null; });
  const render = vi.fn();
  const ctx: IdentityControllerContext = {
    root,
    state,
    render,
    openModal(content: string) {
      (root.querySelector('#modal-content') as HTMLElement).innerHTML = content;
      root.querySelector('#modal')!.classList.add('open');
    },
    closeModal() {
      root.querySelector('#modal')!.classList.remove('open');
      (root.querySelector('#modal-content') as HTMLElement).innerHTML = '';
    },
    openLocal,
    openIdentity
  };
  return { ctx, state, root, openIdentity, openLocal, render, modal: () => root.querySelector('#modal') as HTMLElement };
}

async function seedLocalUserData(namespace: string): Promise<void> {
  const store = await WorkstrStore.open(namespace);
  await store.createSession({ started_at: new Date().toISOString(), sheet_name: 'Push day' });
  store.close();
}

beforeEach(async () => {
  localStorage.clear();
  // fake-indexeddb is global per file: drop namespaces the adoption tests touched.
  await deleteNamespace('local');
});

describe('identity controller adoption branching', () => {
  it('adopts local data into a fresh identity without asking', async () => {
    const h = harness();
    await seedLocalUserData('local');

    const controller = createIdentityController(h.ctx);
    const account = createLocalAccount();
    controller.startRestoreLocalAccount();
    const modal = h.modal();
    modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value = account.nsec;
    modal.querySelector<HTMLElement>('#restore-local-key')!.click();
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true, 'local'));

    expect(await namespaceHasUserData(account.pubkey)).toBe(true);
    expect(await namespaceHasUserData('local')).toBe(false);
  });

  it('asks once when the identity already has data on this device', async () => {
    await seedLocalUserData('local');
    const h = harness();
    const controller = createIdentityController(h.ctx);
    const account = createLocalAccount();
    // Pre-seed under the account pubkey so the already-has-data branch fires.
    const store = await WorkstrStore.open(account.pubkey);
    await store.createSession({ started_at: new Date().toISOString(), sheet_name: 'Old' });
    store.close();

    controller.startRestoreLocalAccount();
    const modal = h.modal();
    modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value = account.nsec;
    modal.querySelector<HTMLElement>('#restore-local-key')!.click();
    await vi.waitFor(() => {
      expect(h.root.querySelector('#adopt-keep-device')).toBeTruthy();
    });
    // Identity not opened until the user picks a side.
    expect(h.openIdentity).not.toHaveBeenCalled();

    h.root.querySelector<HTMLElement>('#adopt-use-account')!.click();
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true, 'local'));
    // "Use the account's data" keeps the identity namespace, local untouched.
    expect(await namespaceHasUserData('local')).toBe(true);
  });

  it('skips adoption entirely for a seed-only local namespace', async () => {
    // Fresh local namespace: only bundled seed rows (nothing user-made).
    const store = await WorkstrStore.open('local');
    const draft: ExerciseDraft = { slug: 'bench-press', name: 'Bench', muscles: ['chest'], equipment: [], tags: [], instructions: [] };
    await store.upsertExercise({ ...draft, source_type: 'bundle' });
    store.close();

    const h = harness();
    const controller = createIdentityController(h.ctx);
    const account = createLocalAccount();
    controller.startRestoreLocalAccount();
    const modal = h.modal();
    modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value = account.nsec;
    modal.querySelector<HTMLElement>('#restore-local-key')!.click();
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true, 'local'));
    // Seed-only local namespace is left alone — no copy, no prompt.
    expect(await namespaceHasUserData(account.pubkey)).toBe(false);
  });
});

describe('identity controller sign-out', () => {
  it('wipes every signer trace from localStorage', async () => {
    localStorage.setItem('workstr.nip46.clientSecret', 'deadbeef');
    localStorage.setItem('workstr.nip46.connection', '{}');
    localStorage.setItem('workstr.localNsec.hex', 'ab'.repeat(32));
    localStorage.setItem('workstr.currentPubkey', PUBKEY);
    localStorage.setItem('workstr.signerType', 'local');
    const h = harness({ pubkey: PUBKEY, signerType: 'local' });
    const controller = createIdentityController(h.ctx);

    await controller.signOut();

    expect(localStorage.getItem('workstr.nip46.clientSecret')).toBeNull();
    expect(localStorage.getItem('workstr.nip46.connection')).toBeNull();
    expect(localStorage.getItem('workstr.localNsec.hex')).toBeNull();
    expect(localStorage.getItem('workstr.currentPubkey')).toBeNull();
    expect(localStorage.getItem('workstr.signerType')).toBeNull();
    expect(h.openLocal).toHaveBeenCalled();
    expect(h.render).toHaveBeenCalled();
    expect(h.state.editingId).toBeNull();
  });
});

describe('restore modal', () => {
  it('keeps the pasted key and shows the error inline after a bad paste', async () => {
    const h = harness();
    const controller = createIdentityController(h.ctx);
    controller.startRestoreLocalAccount();
    let modal = h.modal();
    modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value = 'nsec1notarealkey';
    modal.querySelector<HTMLElement>('#restore-local-key')!.click();
    await vi.waitFor(() => {
      modal = h.modal();
      expect(modal.querySelector('.auth-error')?.textContent).toContain('Recovery key error');
    });
    expect(modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value).toBe('nsec1notarealkey');
  });
});
