// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentityController, type IdentityControllerContext } from '../src/app/identity-controller';
import { generateLocalAccount, type LocalAccountKey } from '../src/signer/local-key';
import { hasLocalSecret } from '../src/signer/local-key-storage';
import { WorkstrStore, type ExerciseDraft } from '../src/db/store';
import { namespaceHasUserData, deleteNamespace } from '../src/db/adopt';
import type { AppState } from '../src/app/state';
import type { Signer } from '../src/signer/types';

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
  protectLocalAccount: ReturnType<typeof vi.fn>;
  refreshStatus: ReturnType<typeof vi.fn>;
  modal(): HTMLElement;
}

const fakeSigner = (account: LocalAccountKey): Signer => ({
  type: 'local',
  getPublicKey: async () => account.pubkey,
  signEvent: vi.fn(),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn()
});

// The vault is faked here: its screens and storage have their own suites. What this file
// checks is that the identity flows go through it, and sign in only when it says a key is
// stored.
function harness(stateOverrides: Partial<AppState> = {}, protect: (account: LocalAccountKey) => Promise<Signer | null> = async (account) => fakeSigner(account)): Harness {
  document.body.innerHTML = '<div id="app"><div id="modal"><div id="modal-content"></div></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const state = baseState(stateOverrides);
  const openIdentity = vi.fn(async (pubkey: string) => { state.pubkey = pubkey; });
  const openLocal = vi.fn(async () => { state.pubkey = null; });
  const render = vi.fn();
  const protectLocalAccount = vi.fn(protect);
  const refreshStatus = vi.fn(async () => undefined);
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
    openIdentity,
    vault: { protectLocalAccount, refreshStatus }
  };
  return { ctx, state, root, openIdentity, openLocal, render, protectLocalAccount, refreshStatus, modal: () => root.querySelector('#modal') as HTMLElement };
}

function restoreWith(h: Harness, nsec: string): void {
  const modal = h.modal();
  modal.querySelector<HTMLTextAreaElement>('#local-key-input')!.value = nsec;
  modal.querySelector<HTMLElement>('#restore-local-key')!.click();
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
    const account = generateLocalAccount();
    controller.startRestoreLocalAccount();
    restoreWith(h, account.nsec);
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true));

    expect(await namespaceHasUserData(account.pubkey)).toBe(true);
    expect(await namespaceHasUserData('local')).toBe(false);
  });

  it('asks once when the identity already has data on this device', async () => {
    await seedLocalUserData('local');
    const h = harness();
    const controller = createIdentityController(h.ctx);
    const account = generateLocalAccount();
    // Pre-seed under the account pubkey so the already-has-data branch fires.
    const store = await WorkstrStore.open(account.pubkey);
    await store.createSession({ started_at: new Date().toISOString(), sheet_name: 'Old' });
    store.close();

    controller.startRestoreLocalAccount();
    restoreWith(h, account.nsec);
    await vi.waitFor(() => {
      expect(h.root.querySelector('#adopt-keep-device')).toBeTruthy();
    });
    // Identity not opened until the user picks a side.
    expect(h.openIdentity).not.toHaveBeenCalled();

    h.root.querySelector<HTMLElement>('#adopt-use-account')!.click();
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true));
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
    const account = generateLocalAccount();
    controller.startRestoreLocalAccount();
    restoreWith(h, account.nsec);
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true));
    // Seed-only local namespace is left alone — no copy, no prompt.
    expect(await namespaceHasUserData(account.pubkey)).toBe(false);
  });
});

describe('local keys go through the device vault', () => {
  it('protects a restored key before signing in with it', async () => {
    const h = harness();
    const controller = createIdentityController(h.ctx);
    const account = generateLocalAccount();
    controller.startRestoreLocalAccount();
    restoreWith(h, account.nsec);
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalled());
    expect(h.protectLocalAccount).toHaveBeenCalledWith(account);
    expect(h.protectLocalAccount.mock.invocationCallOrder[0]).toBeLessThan(h.openIdentity.mock.invocationCallOrder[0]);
  });

  it('does not sign in or store anything when setting the device code is abandoned', async () => {
    const h = harness({}, async () => null);
    const controller = createIdentityController(h.ctx);
    controller.startRestoreLocalAccount();
    restoreWith(h, generateLocalAccount().nsec);
    await vi.waitFor(() => expect(h.protectLocalAccount).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.openIdentity).not.toHaveBeenCalled();
    expect(await hasLocalSecret()).toBe(false);
  });

  it('stores nothing for a new account until its recovery key is saved and protected', async () => {
    const h = harness();
    const controller = createIdentityController(h.ctx);
    controller.startLocalAccount();
    const nsec = h.modal().querySelector('.recovery-key-box')?.textContent?.trim() || '';
    expect(nsec).toMatch(/^nsec1/);
    expect(h.protectLocalAccount).not.toHaveBeenCalled();
    expect(await hasLocalSecret()).toBe(false);

    h.modal().querySelector<HTMLElement>('#continue-local-account')!.click();
    await vi.waitFor(() => expect(h.openIdentity).toHaveBeenCalled());
    const [account] = h.protectLocalAccount.mock.calls[0] as [LocalAccountKey];
    expect(account.nsec).toBe(nsec);
    expect(h.openIdentity).toHaveBeenCalledWith(account.pubkey, true);
  });
});

describe('identity controller sign-out', () => {
  it('wipes every signer trace from localStorage', async () => {
    localStorage.setItem('workstr.nip46.clientSecret', 'deadbeef');
    localStorage.setItem('workstr.nip46.connection', '{}');
    localStorage.setItem('workstr.localNsec.hex', 'ab'.repeat(32));
    localStorage.setItem('workstr.currentPubkey', PUBKEY);
    localStorage.setItem('workstr.signerType', 'local');
    const h = harness({ pubkey: PUBKEY });
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
    // Settings stops offering Change device code once the vault it belonged to is gone.
    expect(h.refreshStatus).toHaveBeenCalled();
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
    expect(h.protectLocalAccount).not.toHaveBeenCalled();
  });
});
