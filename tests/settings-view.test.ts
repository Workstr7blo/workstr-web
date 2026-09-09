// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { settingsView, updateTrainingPreferences } from '../src/app/settings-view';
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

function signedIn(overrides: Partial<AppState> = {}): Partial<AppState> {
  return { pubkey: 'ab'.repeat(32), signerType: 'local', ...overrides } as Partial<AppState>;
}

const groupLabels = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-group-label')).map((el) => el.textContent?.trim() || '');

// The card titles in document order, which is the order someone reads the page in.
const cardTitles = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-category > summary .settings-category-copy strong')).map((el) => el.textContent?.trim() || '');

describe('the Settings page', () => {
  it('reads as five groups in the order a person thinks in', () => {
    expect(groupLabels(render(signedIn()))).toEqual(['Account', 'Training', 'Payments', 'Support', 'System & Data']);
  });

  it('orders the cards within each group', () => {
    const titles = cardTitles(render(signedIn()));
    expect(titles.indexOf('Training Preferences')).toBeLessThan(titles.indexOf('Beast Mode'));
    expect(titles.indexOf('Payment Mode')).toBeLessThan(titles.indexOf('Zap Wallet'));
    expect(titles.indexOf('Data & Sync')).toBeLessThan(titles.indexOf('Advanced'));
  });

  it('puts each card in its group', () => {
    const root = render(signedIn());
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
    const root = render(signedIn());
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
    const root = render(signedIn());
    const blurbs = Array.from(root.querySelectorAll('.settings-group-copy small')).map((el) => el.textContent?.trim());
    expect(blurbs).toHaveLength(5);
    expect(blurbs.every((line) => Boolean(line))).toBe(true);
    expect(root.querySelector('.page-blurb')?.textContent?.trim()).toBeTruthy();
  });

  // Cards in a group share one container and are divided by a line, so a group reads as one
  // object. A group holding a single card is just a card.
  it('collects a group into one container', () => {
    const root = render(signedIn());
    const training = root.querySelector('.training-preferences-card')?.closest('.settings-group');
    expect(training?.querySelectorAll('.settings-group-cards')).toHaveLength(1);
    expect(training?.querySelectorAll('.settings-group-cards > .settings-category')).toHaveLength(2);
    const account = root.querySelector('.account-card')?.closest('.settings-group');
    expect(account?.querySelectorAll('.settings-group-cards > .settings-category')).toHaveLength(1);
  });

  it('keeps Support visually its own thing', () => {
    const root = render(signedIn());
    const support = root.querySelector('.support-panel')?.closest('.settings-group-cards');
    expect(support?.classList.contains('settings-group-cards--support')).toBe(true);
  });

  it('keeps export and import inside Data & Sync', () => {
    const card = render().querySelector('.data-sync-card');
    expect(card?.querySelector('#export-data')).toBeTruthy();
    expect(card?.querySelector('#import-data')).toBeTruthy();
    expect(card?.querySelector('#import-file')).toBeTruthy();
  });

  it('renders local-only Settings as account, training, and local data only', () => {
    const root = render();
    expect(groupLabels(root)).toEqual(['Account', 'Training', 'System & Data']);
    expect(cardTitles(root)).toEqual(['Local only', 'Training Preferences', 'Data & Sync', 'Advanced']);
    expect(root.querySelector('.beast-mode-card')).toBeNull();
    expect(root.querySelector('.payment-mode-card')).toBeNull();
    expect(root.querySelector('.nwc-card')).toBeNull();
    expect(root.querySelector('.support-panel')).toBeNull();
    expect(render({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>).querySelector('.support-panel')).toBeNull();
    expect(root.textContent).not.toContain('Payments');
    expect(root.textContent).not.toContain('Support Workstr');
    expect(root.textContent).not.toContain('Payment Mode');
    expect(root.textContent).not.toContain('Zap Wallet');
  });

  it('keeps local-only Data & Sync focused on manual backup', () => {
    const card = render().querySelector('.data-sync-card') as HTMLElement;
    expect(card.querySelector('summary .settings-category-copy small')?.textContent).toBe('Manual backup for this device');
    expect(card.querySelector('summary .status-pill')?.textContent).toBe('local');
    expect(card.querySelector('.manual-backup-group')).toBeTruthy();
    expect(card.querySelector('#export-data')).toBeTruthy();
    expect(card.querySelector('#import-data')).toBeTruthy();
    expect(card.querySelector('#import-file')).toBeTruthy();
    expect(card.querySelector('.sync-control-group')).toBeNull();
    expect(card.querySelector('#auto-backup')).toBeNull();
    expect(card.querySelector('#sync-now')).toBeNull();
    expect(card.querySelector('#enable-sync')).toBeNull();
    expect(card.textContent).not.toContain('Use Account above');
    expect(card.textContent).not.toContain('Auto-sync');
    expect(card.textContent).not.toContain('Sync now');
  });

  it('drops the Zap Wallet card on the Monero rail and leaves the payment card standing', () => {
    const monero = render(signedIn({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>));
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

    // #204: the two savers write these strings in place rather than rebuilding the page,
    // which is what keeps the card the reader is inside from closing under them. Running the
    // patcher over the real view is the only way to see that it still finds its targets - the
    // failure it guards is silent, because the page renders correctly and is overwritten a
    // moment later.
    it('writes the changed strings in place without rebuilding the card', () => {
      const root = withKit();
      const card = root.querySelector('.training-preferences-card') as HTMLDetailsElement;
      card.open = true;
      const pill = card.querySelector('.training-preference-block .status-pill');
      const chips = card.querySelector('.equip-options');

      const changed = state({
        library: [{ id: 'a', name: 'Row', equipment: ['Dumbbells'] }, { id: 'b', name: 'Push-up', equipment: ['Body Weight'] }],
        discoverExercises: [{ id: 'c', name: 'Press', equipment: ['Bench'] }],
        settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [], ownedEquipment: ['Dumbbells', 'Bench'] }
      } as unknown as Partial<AppState>);
      expect(updateTrainingPreferences(root, changed)).toBe(true);

      expect(root.querySelector('.training-preferences-card')).toBe(card);
      expect(card.open).toBe(true);
      expect(card.querySelector('.equip-options')).toBe(chips);
      expect(card.querySelector('.training-preference-block .status-pill')).toBe(pill);
      expect(pill?.textContent).toBe('2 selected');
      expect(card.querySelector('summary .settings-category-copy small')?.textContent).toBe('Kilograms \u00b7 2 equipment');
    });

    it('reports a miss when the card is not on the page', () => {
      document.body.innerHTML = '<div id="app"></div>';
      expect(updateTrainingPreferences(document.getElementById('app') as HTMLElement, state())).toBe(false);
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

  it('shows Add device only for device-managed accounts', () => {
    const local = render(signedIn({ signerType: 'local', profileName: 'Trainer' }));
    expect(local.querySelector('#add-device-settings')).toBeTruthy();
    expect(local.querySelector('#sign-out-settings')).toBeTruthy();
    expect(local.querySelector('#remove-account-data')).toBeTruthy();
    expect(local.querySelector('.account-card .settings-account-identity small')?.textContent).toBe('Device-managed key for faster sync.');
    expect(local.querySelector('.account-card > summary')?.textContent).toContain('Signed in with a device key');

    const nip07 = render(signedIn({ signerType: 'nip07', profileName: 'Trainer' }));
    expect(nip07.querySelector('#add-device-settings')).toBeNull();
    expect(nip07.querySelector('#sign-out-settings')).toBeTruthy();
    expect(nip07.querySelector('#remove-account-data')).toBeTruthy();
    expect(nip07.querySelector('.account-card .settings-account-identity small')?.textContent).toBe('Keys stay in your signer.');
    expect(nip07.querySelector('.account-card > summary')?.textContent).toContain('Signed in with your signer');

    const nip46 = render(signedIn({ signerType: 'nip46', profileName: 'Trainer' }));
    expect(nip46.querySelector('#add-device-settings')).toBeNull();
    expect(nip46.querySelector('#sign-out-settings')).toBeTruthy();
    expect(nip46.querySelector('#remove-account-data')).toBeTruthy();
    expect(nip46.querySelector('.account-card .settings-account-identity small')?.textContent).toBe('Keys stay in your signer.');

    const localOnly = render();
    expect(localOnly.querySelector('#add-device-settings')).toBeNull();
    expect(localOnly.querySelector('#sign-out-settings')).toBeNull();
    expect(localOnly.querySelector('#remove-account-data')).toBeNull();
    expect(localOnly.querySelector('#sign-in-settings')).toBeTruthy();
  });
});

// Regrouping is a markup change, and the patchers from #189 find their targets by selector.
// A reshuffle that breaks one of them fails silently: the page looks right and the disclosure
// bug comes back. These assert against the real page markup rather than a fixture.
describe('the background patchers still find their cards', () => {
  it('writes the funding surface inside the grouped page', () => {
    const root = render(signedIn());
    const card = root.querySelector('.support-panel') as HTMLDetailsElement;
    card.open = true;

    expect(updateSupportFunding(root, { status: 'ready', receipts: [] })).toBe(true);

    expect(root.querySelector('.support-panel')).toBe(card);
    expect(card.open).toBe(true);
    expect(root.querySelector('.support-panel #support-funding')).toBeTruthy();
    expect(root.querySelector('.support-panel > summary .settings-category-copy small')?.textContent).toContain('sats this month');
  });

  it('leaves the Monero support card alone instead of rerendering the page for it', () => {
    const root = render(signedIn({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>));
    const card = root.querySelector('.support-panel') as HTMLDetailsElement;
    card.open = true;
    const before = card.innerHTML;

    // True without touching anything: a rerender here would close whatever the reader has open.
    expect(updateSupportFunding(root, { status: 'ready', receipts: [] })).toBe(true);

    expect(root.querySelector('.support-panel')).toBe(card);
    expect(card.open).toBe(true);
    expect(card.innerHTML).toBe(before);
    expect(root.querySelector('#support-funding')).toBeNull();
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
