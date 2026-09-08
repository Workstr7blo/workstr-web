// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { settingsView } from '../src/app/settings-view';
import { updateSupportFunding } from '../src/features/support/views';
import { updateBackupCard, updateBackupStatus, backupPanelState } from '../src/features/backup/views';
import { accountIdentity, updateAccountIdentity } from '../src/app/account-chip';
import { displayNpub } from '../src/app/format';
import type { AppState } from '../src/app/state';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: null, npub: null, profileName: null, profilePicture: null, profileNames: {},
    signerType: null, store: null,
    settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    monero: { status: 'idle', address: '' },
    library: [], discoverExercises: [], finishedSessions: [], sheets: [],
    backup: { state: 'off', pending: 0 },
    signInStatus: null,
    ...overrides
  } as unknown as AppState;
}

function render(overrides: Partial<AppState> = {}): HTMLElement {
  document.body.innerHTML = `<div id="app">${settingsView(state(overrides))}</div>`;
  return document.getElementById('app') as HTMLElement;
}

const groupLabels = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-group-label')).map((el) => el.textContent?.trim() || '');

// The card titles in document order, which is the order someone reads the page in.
const cardTitles = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-category > summary .settings-category-copy strong')).map((el) => el.textContent?.trim() || '');

describe('the Settings page', () => {
  it('reads as five groups in the order a person thinks in', () => {
    expect(groupLabels(render())).toEqual(['Account', 'Training', 'Payments', 'Support', 'System & Data']);
  });

  it('orders the cards within each group', () => {
    const titles = cardTitles(render());
    expect(titles.indexOf('Training Preferences')).toBeLessThan(titles.indexOf('Beast Mode'));
    expect(titles.indexOf('Payment Mode')).toBeLessThan(titles.indexOf('Zap Wallet'));
    expect(titles.indexOf('Data & Sync')).toBeLessThan(titles.indexOf('Advanced'));
  });

  it('puts each card in its group', () => {
    const root = render();
    const groupOf = (selector: string): string | undefined => root.querySelector(selector)
      ?.closest('.settings-group')?.querySelector('.settings-group-label')?.textContent?.trim();
    expect(groupOf('.account-card')).toBe('Account');
    expect(groupOf('.training-preferences-card')).toBe('Training');
    expect(groupOf('.beast-mode-card')).toBe('Training');
    expect(groupOf('.payment-mode-card')).toBe('Payments');
    expect(groupOf('.nwc-card')).toBe('Payments');
    expect(groupOf('.support-panel')).toBe('Support');
    expect(groupOf('.data-sync-card')).toBe('System & Data');
    expect(groupOf('.advanced-settings')).toBe('System & Data');
  });

  // Grouping is a claim about meaning, so it is made in markup a screen reader can follow
  // rather than in styling alone.
  it('names each group semantically', () => {
    const root = render();
    for (const section of Array.from(root.querySelectorAll('.settings-group'))) {
      const labelledBy = section.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = root.querySelector(`#${labelledBy}`);
      expect(heading?.tagName).toBe('H2');
      expect(heading?.textContent?.trim()).toBeTruthy();
    }
    // Icons repeat the label they sit beside, so they are not announced twice.
    for (const icon of Array.from(root.querySelectorAll('.settings-group-icon'))) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('gives every group a one-line blurb', () => {
    const root = render();
    const blurbs = Array.from(root.querySelectorAll('.settings-group-copy small')).map((el) => el.textContent?.trim());
    expect(blurbs).toHaveLength(5);
    expect(blurbs.every((line) => Boolean(line))).toBe(true);
    expect(root.querySelector('.page-blurb')?.textContent?.trim()).toBeTruthy();
  });

  // Cards in a group share one container and are divided by a line, so a group reads as one
  // object. A group holding a single card is just a card.
  it('collects a group into one container', () => {
    const root = render();
    const training = root.querySelector('.training-preferences-card')?.closest('.settings-group');
    expect(training?.querySelectorAll('.settings-group-cards')).toHaveLength(1);
    expect(training?.querySelectorAll('.settings-group-cards > .settings-category')).toHaveLength(2);
    const account = root.querySelector('.account-card')?.closest('.settings-group');
    expect(account?.querySelectorAll('.settings-group-cards > .settings-category')).toHaveLength(1);
  });

  it('keeps Support visually its own thing', () => {
    const root = render();
    const support = root.querySelector('.support-panel')?.closest('.settings-group-cards');
    expect(support?.classList.contains('settings-group-cards--support')).toBe(true);
  });

  it('keeps export and import inside Data & Sync', () => {
    const card = render().querySelector('.data-sync-card');
    expect(card?.querySelector('#export-data')).toBeTruthy();
    expect(card?.querySelector('#import-data')).toBeTruthy();
    expect(card?.querySelector('#import-file')).toBeTruthy();
  });

  it('drops the Zap Wallet card on the Monero rail and leaves the payment card standing', () => {
    const monero = render({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>);
    expect(monero.querySelector('.nwc-card')).toBeNull();
    expect(monero.querySelector('.payment-mode-card')).toBeTruthy();
    expect(cardTitles(monero)).not.toContain('Zap Wallet');
  });

  // The card holds two preferences, and #202 asked for them to read as one surface: plain
  // blocks divided by a line, with nothing inside carrying the bordered `.settings-row-main`
  // treatment that would make it look like a card within a card.
  describe('Training Preferences', () => {
    const withKit = (): HTMLElement => render({
      library: [{ id: 'a', name: 'Row', equipment: ['Dumbbells'] }, { id: 'b', name: 'Push-up', equipment: ['Body Weight'] }],
      discoverExercises: [{ id: 'c', name: 'Press', equipment: ['Bench'] }],
      settings: { unit: 'lbs', paymentMode: 'lightning', publicRelays: [], ownedEquipment: ['Dumbbells'] }
    } as unknown as Partial<AppState>);

    it('reads as one surface with a divider instead of nested cards', () => {
      const card = withKit().querySelector('.training-preferences-card') as HTMLElement;
      expect(card.querySelectorAll('.settings-row-main')).toHaveLength(0);
      expect(card.querySelectorAll('.settings-inline-section')).toHaveLength(0);
      expect(card.querySelectorAll('.training-preference')).toHaveLength(2);
      expect(card.querySelectorAll('.training-preference-divider')).toHaveLength(1);
      // Weight unit, then the line, then Equipment.
      const order = [...card.querySelectorAll('.settings-category-body > *')].map((el) => el.className);
      expect(order).toEqual(['training-preference training-preference-row', 'training-preference-divider', 'training-preference training-preference-block']);
    });

    it('keeps the weight unit select and drops the storage detail from its copy', () => {
      const card = withKit().querySelector('.training-preferences-card') as HTMLElement;
      const select = card.querySelector('#unit-select') as HTMLSelectElement;
      expect([...select.options].map((option) => option.value)).toEqual(['kg', 'lbs']);
      expect(select.value).toBe('lbs');
      expect(select.getAttribute('aria-label')).toBe('Weight unit');
      expect(card.querySelector('.training-preference-row small')?.textContent).toBe('Choose how weights are displayed.');
      expect(card.textContent).not.toContain('stored in kilograms');
    });

    it('offers owned equipment as real checkboxes, free equipment excluded', () => {
      const card = withKit().querySelector('.training-preferences-card') as HTMLElement;
      const boxes = [...card.querySelectorAll<HTMLInputElement>('.equip-options .equip-toggle')];
      expect(boxes.map((box) => box.value)).toEqual(['bench', 'dumbbells']);
      expect(boxes.every((box) => box.type === 'checkbox')).toBe(true);
      expect(boxes.filter((box) => box.checked).map((box) => box.value)).toEqual(['dumbbells']);
      expect(card.querySelector('.training-preference-block .status-pill')?.textContent).toBe('1 selected');
    });

    it('explains an empty kit without adding another card', () => {
      const card = render().querySelector('.training-preferences-card') as HTMLElement;
      expect(card.querySelector('.equip-options')).toBeNull();
      expect(card.querySelectorAll('.settings-row-main')).toHaveLength(0);
      expect(card.querySelector('.training-preference-block small')?.textContent).toContain('Import exercises from Discover');
      expect(card.querySelector('.training-preference-block .status-pill')?.textContent).toBe('0 selected');
    });

    it('still summarises unit and kit size while collapsed', () => {
      expect(withKit().querySelector('.training-preferences-card > summary .settings-category-copy small')?.textContent).toBe('Pounds · 1 equipment');
    });
  });

  it('shows the signed-in identity in the Account summary', () => {
    const signedIn = render({ pubkey: 'ab'.repeat(32), signerType: 'local', profileName: 'Trainer' });
    const summary = signedIn.querySelector('.account-card > summary');
    expect(summary?.querySelector('.settings-account-summary')).toBeTruthy();
    expect(summary?.textContent).toContain('Signed in');
    expect(summary?.querySelector('.status-pill')?.textContent).toBe('SIGNED IN');
    expect(render().querySelector('.account-card > summary .status-pill')?.textContent).toBe('LOCAL');
  });
});

// Regrouping is a markup change, and the patchers from #189 find their targets by selector.
// A reshuffle that breaks one of them fails silently: the page looks right and the disclosure
// bug comes back. These assert against the real page markup rather than a fixture.
describe('the background patchers still find their cards', () => {
  it('writes the funding surface inside the grouped page', () => {
    const root = render();
    const card = root.querySelector('.support-panel') as HTMLDetailsElement;
    card.open = true;

    expect(updateSupportFunding(root, { status: 'ready', receipts: [] })).toBe(true);

    expect(root.querySelector('.support-panel')).toBe(card);
    expect(card.open).toBe(true);
    expect(root.querySelector('.support-panel #support-funding')).toBeTruthy();
    expect(root.querySelector('.support-panel > summary .settings-category-copy small')?.textContent).toContain('sats this month');
  });

  it('writes the sync card inside the grouped page', () => {
    const root = render({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [], backup: { enabled: true } } } as Partial<AppState>);
    const card = root.querySelector('.data-sync-card') as HTMLDetailsElement;
    card.open = true;

    expect(updateBackupCard(root, backupPanelState(state({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [], backup: { enabled: true } }, backup: { state: 'syncing', pending: 2 } } as Partial<AppState>)))).toBe(true);

    expect(root.querySelector('.data-sync-card')).toBe(card);
    expect(card.open).toBe(true);
    expect(root.querySelector('.data-sync-card #auto-backup')).toBeTruthy();
    expect(root.querySelector('.data-sync-card #export-data')).toBeTruthy();
  });

  // The bug this catches: the Account summary was redesigned and `patchSettingsAccount`
  // still wrote the old shape into it, so the page rendered correctly and was then
  // overwritten a moment later. Rendering the view and running the patch over it is the
  // only way to see that; either one alone looks fine.
  it('leaves the Account summary saying what the view wrote', () => {
    const signedIn = state({ pubkey: 'ab'.repeat(32), npub: 'npub1trainer', signerType: 'local', profileName: 'Trainer' });
    document.body.innerHTML = `<div id="app">${settingsView(signedIn)}</div>`;
    const root = document.getElementById('app') as HTMLElement;
    const before = root.querySelector('.account-card > summary .settings-category-copy small')?.textContent;

    updateAccountIdentity(root, accountIdentity(signedIn));

    expect(root.querySelector('.account-card > summary .settings-category-copy strong')?.textContent).toBe('Trainer');
    expect(root.querySelector('.account-card > summary .settings-category-copy small')?.textContent).toBe(before);
    // Shown because the profile gives a name; without one the display name is already the
    // shortened npub and the line is suppressed rather than printed twice.
    expect(root.querySelector('.settings-account-npub')?.textContent).toBe(displayNpub('ab'.repeat(32)));
    document.body.innerHTML = `<div id="app">${settingsView(state({ pubkey: 'ab'.repeat(32), signerType: 'local' }))}</div>`;
    expect(document.querySelector('.settings-account-npub')).toBeNull();
  });

  it('patches the sync status line inside the grouped page', () => {
    const root = render({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [], backup: { enabled: true } } } as Partial<AppState>);

    const patched = updateBackupStatus(root, backupPanelState(state({
      pubkey: 'ab'.repeat(32),
      settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [], backup: { enabled: true } },
      backup: { state: 'syncing', pending: 3 }
    } as Partial<AppState>)));

    expect(patched).toBe(true);
    expect(root.querySelector('.data-sync-card > summary .status-pill')?.textContent).toBe('syncing');
  });
});
