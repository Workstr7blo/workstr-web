// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMoneroTipController } from '../src/app/monero-tip-controller';
import { moneroTipAddress, moneroTipButton } from '../src/features/sheets/monero-tip-view';
import { PIGGY_BANK, tipPiggyIcon } from '../src/app/piggy-bank';
import { MONERO_MARK } from '../src/app/monero-mark';
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
    monero: { status: 'idle', address: '' }, profile: { status: 'idle', editing: false },
    view: 'workouts',
    subState: { exercises: 'library', workouts: 'discover', statistics: 'training' },
    exercises: [],
    programs: [program],
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
  const sendTip = vi.fn((recipient) => {
    openModal(`<section id="monero-tip-start">Tip ${recipient.name || 'this creator'}<button data-tip-start-action="enable">Enable Tip Jar</button></section>`);
    return true;
  });
  const controller = createMoneroTipController({ root, state: app, toast, openModal, sendTip });
  controller.bind();
  const modal = () => root.querySelector('#modal-content') as HTMLElement;
  return { root, cards, state: app, toast, openModal, sendTip, controller, modal };
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

  it('puts the Tip on the creator byline, named for the creator, never under the map', () => {
    const card = programCard(program, state(), { showPayment: true });
    const byline = card.slice(card.indexOf('workout-card-byline'), card.indexOf('workout-card-meta'));
    expect(byline).toContain('monero-tip-cta');
    expect(card).not.toContain('workout-card-media');
    expect(card).toMatch(/aria-label="Tip [^"]+"/);
    expect(programCard(program, state(), { showPayment: false })).not.toContain('monero-tip-cta');
  });

  // #267: the card says what the button does - add to this creator's Tip Jar - and not which
  // rail carries it. A Monero mark on every card made the network the subject of the card.
  it('marks the Tip with the Tip Jar piggy bank and a plus, never the Monero mark', () => {
    const card = programCard(program, state(), { showPayment: true });
    const cta = card.slice(card.indexOf('monero-tip-cta'), card.indexOf('</button>'));

    expect(cta).toContain('tip-piggy-icon');
    expect(cta).toContain(PIGGY_BANK);
    expect(cta).toContain(tipPiggyIcon(18));
    // The plus: attached to the pig, and a third of it at most.
    expect(cta).toMatch(/<circle cx="19.3" cy="4.7" r="3.2"\/>/);
    expect(cta).toContain('>Tip</span>');
    // Still the same orange payment control it was; only the icon changed.
    expect(card).toContain('class="button payment small monero-tip-cta"');

    // No Monero mark, badge or wording, and nothing for a screen reader to read twice: the
    // icon is decorative and the accessible name is the action.
    expect(cta).not.toContain(MONERO_MARK);
    expect(cta).not.toContain('monero-badge');
    expect(cta).not.toContain('sr-only');
    expect(cta).toContain('aria-hidden="true"');
    expect(card).not.toContain('with Monero');
    expect(card.match(/aria-label="(Tip [^"]*)"/)?.[1]).not.toMatch(/monero|xmr|piggy|plus/i);
  });

  it('ignores a target that is not a Monero address', () => {
    const app = state({ authorPaymentTargets: { [AUTHOR]: 'bc1qexamplenotmonero' } });
    expect(moneroTipAddress(program, app)).toBe('');
    expect(moneroTipButton(program, app)).toBe('');
  });

  it('shows the Tip action with nothing counted beside it', () => {
    const monero = shellMarkup(state());

    expect(monero).toContain('monero-tip-cta');
    expect(monero).not.toContain('program-zap-cta');
    expect(monero).not.toContain('data-zap-program');
    expect(monero).not.toContain('sats');
    expect(monero).not.toContain('top zapped');
    expect(monero).not.toContain('rank-1');
  });

  // Even for an author who publishes an address: off means no payment action on any card.
  it('shows no payment action while Monero tips are off', () => {
    const off = shellMarkup(state({ settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] } }));

    expect(off).not.toContain('monero-tip-cta');
    expect(off).not.toContain('program-zap-cta');
    expect(off).not.toContain('sats');
  });

  it('never invents Monero social proof', () => {
    const monero = shellMarkup(state());
    for (const claim of ['0 XMR', 'Top tipped', 'Most supported', 'Creator earnings', 'Monero tips received']) {
      expect(monero).not.toContain(claim);
    }
  });
});

describe('the Monero tip flow', () => {
  it('starts the Workstr Tip Jar flow without exposing a creator wallet hand-off', () => {
    const app = harness({ profileNames: { [AUTHOR]: 'Alice' } });
    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    const text = app.modal().textContent || '';
    expect(app.openModal).toHaveBeenCalledTimes(1);
    expect(text).toContain('Tip Alice');
    expect(text).toContain('Enable Tip Jar');
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain('Open wallet');
    expect(app.modal().querySelector('.monero-tip-qr svg')).toBeNull();
    expect(app.modal().querySelector<HTMLAnchorElement>('#monero-tip-open')).toBeNull();
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

  it('hands the creator address to Workstr internally as the send destination', () => {
    const app = harness();
    app.cards.querySelector<HTMLElement>('[data-monero-tip]')!.click();

    expect(app.sendTip).toHaveBeenCalledWith(expect.objectContaining({ address: ADDRESS, pubkey: AUTHOR, programAddress: program.address, programName: program.name }));
    expect(app.openModal).toHaveBeenCalled();
    expect(app.modal().textContent).toContain('Tip');
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
