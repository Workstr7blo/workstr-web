// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMoneroTipController } from '../src/app/monero-tip-controller';
import { moneroTipAddress, moneroTipButton } from '../src/features/sheets/monero-tip-view';
import { programCard } from '../src/features/sheets/views';
import { shellMarkup } from '../src/app/layout';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';

const AUTHOR = 'f'.repeat(64);
const OTHER_AUTHOR = 'a'.repeat(64);
const ADDRESS = `8${'B'.repeat(94)}`;

const program: RelayProgram = {
  slug: 'push-day',
  name: 'Push Day',
  description: '',
  difficulty: 'intermediate',
  tags: ['strength'],
  exercises: [],
  sourceLabel: 'Workstr',
  eventId: 'e'.repeat(64),
  pubkey: AUTHOR,
  address: `33402:${AUTHOR}:workstr:program:push-day`,
  createdAt: 1
};

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: null,
    profileNames: {},
    authorProfiles: {},
    authorPaymentTargets: { [AUTHOR]: ADDRESS },
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] },
    monero: { status: 'idle', address: '' },
    nwc: { active: false, status: 'idle' },
    support: { status: 'idle', receipts: [] },
    view: 'workouts',
    subState: { exercises: 'library', workouts: 'discover', statistics: 'training' },
    exercises: [],
    programs: [program],
    programZapAttempts: [],
    sheets: [],
    library: [],
    discoverExercises: [],
    librarySelect: { active: false, slugs: new Set() },
    discoverSelect: { active: false, addresses: new Set() },
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    finishedSessions: [],
    activeSession: null,
    bodyEntries: [],
    history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    backup: { state: 'off', pending: 0 },
    expandedProgramAddress: null,
    expandedSessionId: null,
    filter: '',
    programFilter: '',
    exerciseStatus: '',
    programStatus: '',
    signInStatus: null,
    ...overrides
  } as unknown as AppState;
}

function harness(overrides: Partial<AppState> = {}) {
  document.body.innerHTML = '<div id="app"><div id="modal"><div id="modal-content"></div></div><div id="cards"></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const app = state(overrides);
  const cards = root.querySelector('#cards') as HTMLElement;
  cards.innerHTML = programCard(program, app, { showPayment: true });
  const toast = vi.fn();
  const openModal = vi.fn((content: string) => {
    (root.querySelector('#modal-content') as HTMLElement).innerHTML = content;
  });
  const controller = createMoneroTipController({ root, state: app, toast, openModal });
  controller.bind();
  const modal = () => root.querySelector('#modal-content') as HTMLElement;
  return { root, cards, state: app, toast, openModal, controller, modal };
}

describe('Monero Tip on program cards', () => {
  it('offers a tip action only for an author who publishes a Monero address', () => {
    const withTarget = programCard(program, state(), { showPayment: true });
    expect(withTarget).toContain('monero-tip-cta');
    expect(withTarget).toContain(`data-monero-tip="${program.address}"`);

    // Nothing at all for an author without one. A disabled "no address" control would put
    // somebody else's payment setup on screen as if it were the reader's problem.
    const withoutTarget = programCard(program, state({ authorPaymentTargets: { [AUTHOR]: null } }), { showPayment: true });
    expect(withoutTarget).not.toContain('monero-tip-cta');
    expect(withoutTarget).not.toContain('No address');
    expect(withoutTarget).not.toContain('Monero unavailable');

    // Before any relay has answered, the card says nothing either.
    expect(programCard(program, state({ authorPaymentTargets: {} }), { showPayment: true })).not.toContain('monero-tip-cta');
  });

  it('ignores a target that is not a Monero address', () => {
    const app = state({ authorPaymentTargets: { [AUTHOR]: 'bc1qexamplenotmonero' } });
    expect(moneroTipAddress(program, app)).toBe('');
    expect(moneroTipButton(program, app)).toBe('');
  });

  it('replaces the Lightning zap surfaces rather than recolouring them', () => {
    const monero = shellMarkup(state({ programZapTotals: { [program.address]: { sats: 2000, count: 3 } } }));

    expect(monero).toContain('monero-tip-cta');
    expect(monero).not.toContain('program-zap-cta');
    expect(monero).not.toContain('data-zap-program');
    expect(monero).not.toContain('sats');
    expect(monero).not.toContain('top zapped');
    expect(monero).not.toContain('rank-1');
  });

  it('leaves the Lightning rail exactly as it was', () => {
    const lightning = shellMarkup(state({
      settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] },
      programZapTotals: { [program.address]: { sats: 2000, count: 3 } }
    }));

    expect(lightning).toContain('program-zap-cta');
    expect(lightning).toContain('2,000 sats');
    expect(lightning).toContain('#1 top zapped');
    // The Monero action belongs to the Monero rail, even for an author who has an address.
    expect(lightning).not.toContain('monero-tip-cta');
  });

  it('withdraws the local Lightning zap record from an expanded card', () => {
    const attempt = [{
      id: 'zap-1', status: 'succeeded', programAddress: program.address, programName: 'Push Day',
      amountSats: 21, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z'
    }];
    const lightning = programCard(program, state({ settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] }, expandedProgramAddress: program.address, programZapAttempts: attempt } as Partial<AppState>), { showPayment: true });
    expect(lightning).toContain('Zap sent · 21 sats');

    const monero = programCard(program, state({ expandedProgramAddress: program.address, programZapAttempts: attempt } as Partial<AppState>), { showPayment: true });
    expect(monero).not.toContain('Creator zap');
    expect(monero).not.toContain('Zap sent');
  });

  it('never invents Monero social proof', () => {
    const monero = shellMarkup(state());
    for (const claim of ['0 XMR', 'Top tipped', 'Most supported', 'Creator earnings', 'Monero tips received']) {
      expect(monero).not.toContain(claim);
    }
  });
});

describe('the Monero tip sheet', () => {
  it('opens with the creator, the address, a QR and both actions', () => {
    const app = harness({ profileNames: { [AUTHOR]: 'Alice' } });
    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    const text = app.modal().textContent || '';
    expect(app.openModal).toHaveBeenCalledTimes(1);
    expect(text).toContain('Tip with Monero');
    expect(text).toContain('Alice');
    expect(text).toContain(ADDRESS);
    expect(app.modal().querySelector('.monero-tip-qr svg')).toBeTruthy();
    expect(app.modal().querySelector<HTMLAnchorElement>('#monero-tip-open')?.getAttribute('href')).toBe(`monero:${ADDRESS}`);
  });

  // A Monero transfer is not a NIP-57 zap. Borrowing the zap plumbing would ask a wallet
  // for an invoice nobody is going to pay, and put a Lightning receipt against a payment
  // that never happened.
  it('does not open the card while opening the sheet, and touches no zap path', () => {
    const app = harness();
    const toggled = vi.fn();
    app.cards.querySelector<HTMLElement>('[data-toggle-program]')!.addEventListener('click', toggled);

    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    expect(toggled).not.toHaveBeenCalled();
    expect(app.modal().innerHTML).not.toContain('nwc');
    expect(app.modal().textContent).not.toContain('sats');
  });

  it('copies the address to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const app = harness();
    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    const copy = app.modal().querySelector<HTMLButtonElement>('#monero-tip-copy')!;
    copy.click();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(copy.textContent).toBe('Copied');
  });

  it('says so rather than opening an empty sheet when the target has gone', () => {
    const app = harness();
    app.state.authorPaymentTargets = { [AUTHOR]: null };

    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    expect(app.openModal).not.toHaveBeenCalled();
    expect(app.toast).toHaveBeenCalledWith('This creator has no public Monero address', 'bad');
  });

  it('shows the author key when the creator publishes no profile name', () => {
    const app = harness({ authorPaymentTargets: { [AUTHOR]: ADDRESS, [OTHER_AUTHOR]: null } });
    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    expect(app.modal().textContent).toContain('npub');
  });
});
