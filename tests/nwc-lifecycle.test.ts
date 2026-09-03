// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shellMarkup } from '../src/app/layout';
import { parseNwcConnectionString, type NwcConnection } from '../src/nostr/nwc';
import type { AppState } from '../src/app/state';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';
import type { NwcClientTransport, NwcInfo } from '../src/nostr/nwc-client';
import type { StoredNwcConnection } from '../src/nostr/nwc-storage';
import type { RelayProgram } from '../src/nostr/canon';
import { OPERATOR_PUBKEY } from '../src/nostr/canon';

vi.mock('../src/nostr/nwc-client', async () => {
  const actual = await vi.importActual<typeof import('../src/nostr/nwc-client')>('../src/nostr/nwc-client');
  return { ...actual, validateNwcConnection: vi.fn() };
});

vi.mock('../src/nostr/nwc-storage', async () => {
  const actual = await vi.importActual<typeof import('../src/nostr/nwc-storage')>('../src/nostr/nwc-storage');
  return {
    ...actual,
    loadNwcConnection: vi.fn(),
    saveNwcConnection: vi.fn(),
    clearNwcConnection: vi.fn()
  };
});

vi.mock('../src/nostr/support-zap', async () => {
  const actual = await vi.importActual<typeof import('../src/nostr/support-zap')>('../src/nostr/support-zap');
  return { ...actual, executeSupportZap: vi.fn() };
});

vi.mock('../src/nostr/program-zap-status', async () => {
  const actual = await vi.importActual<typeof import('../src/nostr/program-zap-status')>('../src/nostr/program-zap-status');
  return { ...actual, executeWorkoutProgramZapWithStatus: vi.fn() };
});

const { createNwcController } = await import('../src/app/nwc-controller');
const { validateNwcConnection } = await import('../src/nostr/nwc-client');
const { loadNwcConnection, saveNwcConnection, clearNwcConnection, NwcSecureStorageError } = await import('../src/nostr/nwc-storage');
const { executeSupportZap } = await import('../src/nostr/support-zap');
const { executeWorkoutProgramZapWithStatus } = await import('../src/nostr/program-zap-status');

const WALLET_PUBKEY = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const OTHER_SECRET = 'c'.repeat(64);
const VALID = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss%3A%2F%2Frelay.example.com&secret=${SECRET}&lud16=alice%40wallet.example`;
const INVOICE = `lnbc10u1${'q'.repeat(60)}`;
const PREIMAGE = 'p'.repeat(64);
const SENDER_PUBKEY = 'f'.repeat(64);

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: SENDER_PUBKEY,
    npub: null,
    profileName: null,
    profilePicture: null,
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    monero: { status: 'idle', address: '' },
    signerType: 'local',
    view: 'settings',
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
    ...overrides
  } as AppState;
}

function stored(connectionString = VALID): StoredNwcConnection {
  const connection = parseNwcConnectionString(connectionString);
  return {
    connection,
    metadata: {
      walletPubkey: connection.walletPubkey,
      relays: connection.relays,
      lud16: connection.lud16,
      expiresAt: connection.expiresAt,
      savedAt: 1_800_000_000,
      lastUsedAt: 1_800_000_000
    }
  };
}

function signer(): Signer {
  return {
    type: 'local',
    getPublicKey: vi.fn(async () => SENDER_PUBKEY),
    signEvent: vi.fn(async (event: UnsignedNostrEvent) => ({ ...event, pubkey: SENDER_PUBKEY, id: '1'.repeat(64), sig: '2'.repeat(128) })),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  };
}

function harness(overrides: Partial<AppState> = {}, callbacks: { refreshProgramZapTotals?: Parameters<typeof createNwcController>[0]['refreshProgramZapTotals'] } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const appState = state(overrides);
  const toasts: string[] = [];
  let controller: ReturnType<typeof createNwcController>;
  const render = () => {
    root.innerHTML = shellMarkup(appState);
    controller?.bind();
  };
  const openModal = (content: string) => {
    const modal = root.querySelector('#modal') as HTMLElement;
    const modalContent = root.querySelector('#modal-content') as HTMLElement;
    modal.classList.add('open');
    modalContent.innerHTML = content;
  };
  const closeModal = () => root.querySelector('#modal')?.classList.remove('open');
  controller = createNwcController({
    root,
    state: appState,
    render,
    toast: (message) => { toasts.push(message); },
    openModal,
    closeModal,
    getSigner: vi.fn(async () => signer()),
    refreshFunding: vi.fn(async () => {}),
    refreshProgramZapTotals: callbacks.refreshProgramZapTotals
  });
  render();
  return { root, state: appState, controller, toasts };
}

function allVisibleTextAndStorage(root: HTMLElement): string {
  const storage = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n');
  return `${root.innerHTML}\n${storage}`;
}

async function submitConnection(root: HTMLElement, value: string) {
  root.querySelector<HTMLElement>('#nwc-connect')?.click();
  const form = root.querySelector<HTMLFormElement>('#nwc-connect-form')!;
  form.querySelector<HTMLTextAreaElement>('#nwc-connection-string')!.value = value;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('#modal-content')).toBeTruthy());
}

async function submitZap(root: HTMLElement, amount = '1000') {
  root.querySelector<HTMLElement>('#open-nwc-zap')?.click();
  const form = root.querySelector<HTMLFormElement>('#nwc-zap-form')!;
  form.querySelector<HTMLInputElement>('#nwc-zap-amount')!.value = amount;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('#modal-content')).toBeTruthy());
}

describe('NWC connection lifecycle UI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadNwcConnection).mockResolvedValue(null);
    vi.mocked(saveNwcConnection).mockImplementation(async (_namespace, connectionString) => stored(connectionString));
    vi.mocked(validateNwcConnection).mockResolvedValue({ ok: true, value: { alias: 'Test Wallet', methods: ['get_info', 'pay_invoice'], notifications: [] } as NwcInfo });
  });

  it('validates and saves a usable connection without exposing the URI secret', async () => {
    const { root, state: appState, toasts } = harness();

    await submitConnection(root, VALID);

    await vi.waitFor(() => expect(appState.nwc.active).toBe(true));
    expect(validateNwcConnection).toHaveBeenCalledWith(expect.objectContaining({ secret: SECRET }));
    expect(saveNwcConnection).toHaveBeenCalledWith(SENDER_PUBKEY, VALID);
    expect(toasts).toContain('Zap wallet connected');
    const surface = allVisibleTextAndStorage(root);
    expect(surface).toContain('Wallet connected: Test Wallet');
    expect(surface).not.toContain(SECRET);
    expect(surface).not.toContain(VALID);
    expect(surface).not.toContain('secret=');
  });

  it.each([
    ['malformed URI', 'user@wallet.example', 'Lightning address'],
    ['expired URI', `${VALID}&expires_at=1`, 'connection expired']
  ])('rejects %s before validation or persistence and keeps the secret redacted', async (_label, input, expectedCopy) => {
    const { root, state: appState } = harness();

    await submitConnection(root, input);

    await vi.waitFor(() => expect(appState.nwc.status).toBe('error'));
    expect(validateNwcConnection).not.toHaveBeenCalled();
    expect(saveNwcConnection).not.toHaveBeenCalled();
    expect(root.textContent).toContain(expectedCopy);
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
  });

  it.each([
    ['rejected_unauthorized', 'Wallet rejected this connection'],
    ['unreachable_service', 'Could not reach the wallet service']
  ] as const)('surfaces %s validation failures as actionable redacted copy', async (code, expectedCopy) => {
    vi.mocked(validateNwcConnection).mockResolvedValueOnce({
      ok: false,
      error: { name: 'NwcError', code, kind: code, message: `wallet echoed secret=${OTHER_SECRET}` } as never
    });
    const { root, state: appState } = harness();

    await submitConnection(root, VALID);

    await vi.waitFor(() => expect(appState.nwc.status).toBe('error'));
    expect(root.textContent).toContain(expectedCopy);
    expect(saveNwcConnection).not.toHaveBeenCalled();
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
    expect(allVisibleTextAndStorage(root)).not.toContain(OTHER_SECRET);
  });

  it('keeps a validated connection inactive when secure storage fails', async () => {
    vi.mocked(saveNwcConnection).mockRejectedValueOnce(new NwcSecureStorageError('write_failed', `cannot save ${VALID}`));
    const { root, state: appState } = harness();

    await submitConnection(root, VALID);

    await vi.waitFor(() => expect(appState.nwc.status).toBe('error'));
    expect(root.textContent).toContain('Wallet connection validated, but secure storage failed. It was not saved.');
    expect(appState.nwc.active).toBe(false);
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
  });

  it('disconnects the active wallet by clearing secure storage only', async () => {
    const active = stored();
    const { root, state: appState, toasts } = harness({ nwc: { active: true, status: 'idle', walletLabel: active.connection.lud16, relayLabel: 'relay.example.com' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    root.querySelector<HTMLElement>('#nwc-disconnect')?.click();

    await vi.waitFor(() => expect(clearNwcConnection).toHaveBeenCalledWith(SENDER_PUBKEY));
    expect(appState.nwc.active).toBe(false);
    expect(toasts).toContain('Zap wallet disconnected');
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
  });
});

describe('NWC support zap payment UI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadNwcConnection).mockResolvedValue(stored());
  });

  it('loads the stored NWC connection and reports a successful pay_invoice result without leaking credentials', async () => {
    vi.mocked(executeSupportZap).mockResolvedValueOnce({
      ok: true,
      value: { invoice: INVOICE, amountSats: 1000, zapRequest: { kind: 9734, created_at: 1, tags: [], content: '', pubkey: SENDER_PUBKEY, id: '1'.repeat(64), sig: '2'.repeat(128) }, payment: { preimage: PREIMAGE } }
    });
    const active = stored();
    const { root, state: appState, toasts } = harness({ nwc: { active: true, status: 'idle', walletLabel: active.connection.lud16, relayLabel: 'relay.example.com' } });

    await submitZap(root);

    await vi.waitFor(() => expect(appState.nwc.status).toBe('success'));
    expect(executeSupportZap).toHaveBeenCalledWith(expect.objectContaining({
      amountSats: 1000,
      signer: expect.any(Object),
      nwcConnection: expect.objectContaining({ secret: SECRET })
    }));
    expect(toasts).toContain('Zapped 1,000 sats');
    expect(allVisibleTextAndStorage(root)).toContain('Zapped 1,000 sats. Receipt may take a moment to appear.');
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
    expect(allVisibleTextAndStorage(root)).not.toContain(VALID);
  });

  it.each([
    ['rejected payment', 'rejected_unauthorized', 'Wallet rejected the payment.'],
    ['payment timeout', 'unreachable_service', 'Wallet did not respond in time.']
  ])('keeps %s errors actionable and redacted', async (_label, nwcKind, message) => {
    vi.mocked(executeSupportZap).mockResolvedValueOnce({
      ok: false,
      error: { code: 'payment-failed', message: `${message} secret=${SECRET}`, nwcCode: nwcKind === 'unreachable_service' ? 'timeout' : 'rejected_unauthorized', nwcKind: nwcKind as never }
    });
    const active = stored();
    const { root, state: appState } = harness({ nwc: { active: true, status: 'idle', walletLabel: active.connection.lud16, relayLabel: 'relay.example.com' } });

    await submitZap(root);

    await vi.waitFor(() => expect(appState.nwc.status).toBe('error'));
    expect(root.textContent).toContain(message);
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
    expect(allVisibleTextAndStorage(root)).toContain('[REDACTED]');
  });
});

describe('NWC workout-program zap modal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadNwcConnection).mockResolvedValue(stored());
  });

  const workstrProgram: RelayProgram = {
    slug: 'push-day',
    name: 'Push Day',
    description: '',
    difficulty: 'beginner',
    tags: ['strength'],
    exercises: [],
    sourceLabel: 'Workstr',
    eventId: 'e'.repeat(64),
    pubkey: OPERATOR_PUBKEY,
    address: `33402:${OPERATOR_PUBKEY}:workstr:program:push-day`,
    createdAt: 1
  };

  it('shows and uses the creator kind:0 wallet target for operator-authored programs', () => {
    const active = stored();
    const { root } = harness({
      view: 'workouts',
      expandedProgramAddress: workstrProgram.address,
      nwc: { active: true, status: 'idle', walletLabel: active.connection.lud16, relayLabel: 'relay.example.com' },
      programs: [workstrProgram],
      authorProfiles: { [OPERATOR_PUBKEY]: { pubkey: OPERATOR_PUBKEY, name: 'Workstr', lud16: 'workstr@rizful.com' } }
    });

    root.querySelector<HTMLElement>('[data-zap-program]')?.click();

    expect(root.textContent).toContain('Recipient: workstr@rizful.com');
  });

  it('updates visible program zap totals immediately and schedules one targeted receipt refresh', async () => {
    vi.useFakeTimers();
    const active = stored();
    const refreshProgramZapTotals = vi.fn(async () => {});
    vi.mocked(executeWorkoutProgramZapWithStatus).mockResolvedValueOnce({
      attempt: {
        id: 'attempt-1',
        status: 'succeeded',
        programAddress: workstrProgram.address,
        programName: workstrProgram.name,
        amountSats: 21,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      result: {
        ok: true,
        value: {
          invoice: INVOICE,
          amountSats: 21,
          programAddress: workstrProgram.address,
          recipient: { pubkey: OPERATOR_PUBKEY, relay: 'wss://relay.example.com', lnurl: 'workstr@rizful.com', relays: ['wss://relay.example.com'], programAddress: workstrProgram.address, app: 'workstr' },
          zapRequest: { kind: 9734, created_at: 1, tags: [], content: '', pubkey: SENDER_PUBKEY, id: '1'.repeat(64), sig: '2'.repeat(128) },
          payment: { preimage: PREIMAGE }
        }
      }
    });
    const { root, state: appState } = harness({
      view: 'workouts',
      expandedProgramAddress: workstrProgram.address,
      nwc: { active: true, status: 'idle', walletLabel: active.connection.lud16, relayLabel: 'relay.example.com' },
      programs: [workstrProgram],
      programZapTotals: { [workstrProgram.address]: { sats: 5, count: 1 } },
      authorProfiles: { [OPERATOR_PUBKEY]: { pubkey: OPERATOR_PUBKEY, name: 'Workstr', lud16: 'workstr@rizful.com' } },
      store: {} as AppState['store']
    }, { refreshProgramZapTotals });

    root.querySelector<HTMLElement>('[data-zap-program]')?.click();
    const form = root.querySelector<HTMLFormElement>('#nwc-program-zap-form')!;
    form.querySelector<HTMLInputElement>('#nwc-program-zap-amount')!.value = '21';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(appState.programZapTotals?.[workstrProgram.address]).toEqual({ sats: 26, count: 2 }));
    expect(refreshProgramZapTotals).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8000);
    expect(refreshProgramZapTotals).toHaveBeenCalledWith([expect.objectContaining({ address: workstrProgram.address })]);
    vi.useRealTimers();
  });
});

describe('NWC log and non-secure-storage guardrails', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('does not write NWC material to console or localStorage while handling UI failures', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args.join(' ')); });
    vi.mocked(validateNwcConnection).mockResolvedValueOnce({ ok: false, error: { name: 'NwcError', code: 'rejected_unauthorized', kind: 'rejected_unauthorized', message: `denied ${VALID}` } as never });
    const { root } = harness();

    await submitConnection(root, VALID);

    const consoleOutput = logs.join('\n');
    expect(consoleOutput).not.toContain(SECRET);
    expect(consoleOutput).not.toContain(VALID);
    expect(allVisibleTextAndStorage(root)).not.toContain(SECRET);
    expect(Object.keys(localStorage)).not.toContain('nwc');
  });
});
