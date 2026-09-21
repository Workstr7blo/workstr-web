// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { settingsView, updateTrainingPreferences } from '../src/app/settings-view';
import { supportPanel } from '../src/features/support/views';
import { updateBackupCard, updateBackupStatus, backupPanelState } from '../src/features/backup/views';
import { accountIdentity, updateAccountIdentity } from '../src/app/account-chip';
import { displayNpub } from '../src/app/format';
import type { AppState } from '../src/app/state';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: null, npub: null, profileName: null, profilePicture: null, profileNames: {}, store: null,
    settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] },
    monero: { status: 'idle', address: '' }, profile: { status: 'idle', editing: false },
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
  return { pubkey: 'ab'.repeat(32), ...overrides } as Partial<AppState>;
}

function tipJarSnapshot() {
  return {
    metadata: {
      version: 1 as const,
      id: 'wallet-1',
      scope: `monero.hot-wallet.${'ab'.repeat(32)}`,
      network: 'mainnet' as const,
      node: { mode: 'workstr' as const, host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' as const },
      restoreHeight: 3763000,
      primaryAddress: '4PrimaryAddress',
      creatorSubaddress: `8${'A'.repeat(94)}`,
      creatorSubaddressIndex: 1,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
      source: 'created' as const
    },
    balance: null,
    sync: { height: 3766916, daemonHeight: 3766916, synchronized: true, updatedAt: '2026-09-20T00:00:00.000Z' }
  };
}

const groupLabels = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-group-label')).map((el) => el.textContent?.trim() || '');

// The card titles in document order, which is the order someone reads the page in.
const cardTitles = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.settings-category > summary .settings-category-copy strong')).map((el) => el.textContent?.trim() || '');

describe('the Settings page', () => {
  it('reads as six groups in the order a person thinks in', () => {
    expect(groupLabels(render(signedIn()))).toEqual(['Profile', 'Training', 'Payments', 'Access & Security', 'Support', 'System & Data']);
  });

  it('orders the cards within each group', () => {
    const titles = cardTitles(render(signedIn()));
    expect(titles.indexOf('Training Preferences')).toBeLessThan(titles.indexOf('Beast Mode'));
    expect(titles.indexOf('Data & Sync')).toBeLessThan(titles.indexOf('Advanced'));
  });

  it('puts each card in its group', () => {
    const root = render(signedIn());
    const groupOf = (selector: string): string | undefined => root.querySelector(selector)
      ?.closest('.settings-group')?.querySelector('.settings-group-label')?.textContent?.trim();
    expect(root.querySelector('.account-card')).toBeNull();
    expect(groupOf('.profile-card')).toBe('Profile');
    expect(groupOf('.access-card')).toBe('Access & Security');
    expect(groupOf('.training-preferences-card')).toBe('Training');
    expect(groupOf('.beast-mode-card')).toBe('Training');
    expect(groupOf('.monero-tips-card')).toBe('Payments');
    expect(root.querySelector('.monero-wallet-card')).toBeNull();
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
    expect(blurbs).toHaveLength(6);
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
    const profile = root.querySelector('.profile-card')?.closest('.settings-group');
    expect(profile?.querySelectorAll('.settings-group-cards > .settings-category')).toHaveLength(1);
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

  it('renders local-only Settings as profile, training, and local data only', () => {
    const root = render();
    expect(groupLabels(root)).toEqual(['Profile', 'Training', 'System & Data']);
    expect(cardTitles(root)).toEqual(['Training Preferences', 'Data & Sync', 'Advanced']);
    expect(root.querySelector('.access-card')).toBeNull();
    expect(root.querySelector('.beast-mode-card')).toBeNull();
    expect(root.querySelector('.monero-tips-card')).toBeNull();
    expect(root.querySelector('.support-panel')).toBeNull();
    expect(render({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>).querySelector('.support-panel')).toBeNull();
    expect(root.textContent).not.toContain('Payments');
    expect(root.textContent).not.toContain('Support Workstr');
    expect(root.textContent).not.toContain('Monero tips');
    expect(root.textContent).not.toContain('Tip Jar');
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

  describe('Monero tips', () => {
    const off = (overrides: Partial<AppState> = {}): HTMLElement => render(signedIn(overrides));
    const on = (overrides: Partial<AppState> = {}): HTMLElement =>
      render(signedIn({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] }, ...overrides } as Partial<AppState>));

    it('is one switch in Payments, off by default', () => {
      const root = off();
      const card = root.querySelector('.monero-tips-card') as HTMLElement;
      const toggle = card.querySelector<HTMLInputElement>('#monero-tips-toggle')!;
      expect(card.tagName).toBe('SECTION');
      expect(toggle.type).toBe('checkbox');
      expect(toggle.getAttribute('role')).toBe('switch');
      expect(toggle.checked).toBe(false);
      expect(card.querySelector('#monero-tips-label')?.textContent).toBe('Tip Jar');
      expect(card.querySelector('#monero-tips-copy')?.textContent).toBe('Send and receive tips in Workstr.');
      expect(card.querySelector('input[type="text"]')).toBeNull();
      expect(card.closest('.settings-group')?.querySelector('.settings-group-copy small')?.textContent).toBe('Tip program creators with Monero');
    });

    // The public address is the Profile's. The switch neither shows nor edits it, and says
    // nothing about it whichever way it is set.
    it('keeps the public address out of Payments whichever way the switch is set', () => {
      for (const root of [on(), off({ monero: { status: 'ready', address: `8${'B'.repeat(94)}` } } as Partial<AppState>)]) {
        const payments = root.querySelector('.monero-tips-card')?.closest('.settings-group') as HTMLElement;
        expect(payments.querySelector('#profile-address, #monero-address')).toBeNull();
        expect(payments.textContent).not.toContain('payment address');
        expect(root.querySelector('#monero-tips-copy')?.textContent).toBe('Send and receive tips in Workstr.');
        expect(root.querySelector('.profile-card .profile-address')).toBeTruthy();
      }
    });

    it('shows the same Support Workstr card whichever way it is set', () => {
      const offCard = off().querySelector('.support-panel')?.outerHTML;
      const onCard = on().querySelector('.support-panel')?.outerHTML;
      expect(offCard).toBeTruthy();
      expect(offCard).toBe(onCard);
      expect(supportPanel()).toContain('Private support with Monero');
    });

    it('keeps wallet setup and telemetry out of normal Tip Jar Settings', () => {
      const root = off({ deviceVault: 'unlocked', moneroWallet: { status: 'ready', stored: true, snapshot: tipJarSnapshot(), message: 'Wallet synced.', messageKind: 'ok' } });
      const paymentGroup = root.querySelector('.monero-tips-card')?.closest('.settings-group') as HTMLElement;
      expect(root.querySelector('.monero-wallet-card')).toBeNull();
      expect(paymentGroup.textContent).toContain('Tip Jar');
      for (const hidden of ['Tip Jar wallet', 'READY', 'Wallet synced.', 'Wallet height', 'Node height', 'Wallet status', 'Network', 'xmr.workstr.fit']) {
        expect(paymentGroup.textContent).not.toContain(hidden);
      }
      expect(paymentGroup.querySelector('#monero-tips-toggle')).toBeTruthy();
      expect(paymentGroup.querySelector('#monero-wallet-create, #monero-wallet-open, #monero-wallet-recheck')).toBeNull();
    });

    it('moves Tip Jar wallet telemetry into collapsed Advanced diagnostics', () => {
      const root = off({ deviceVault: 'unlocked', moneroWallet: { status: 'ready', stored: true, snapshot: tipJarSnapshot() } });
      const advanced = root.querySelector('.advanced-settings') as HTMLDetailsElement;
      const diagnostics = advanced.querySelector('.settings-diagnostics') as HTMLDetailsElement;
      const tipJar = diagnostics.querySelector('.monero-wallet-diagnostics') as HTMLDetailsElement;
      expect(diagnostics.open).toBe(false);
      expect(tipJar.open).toBe(false);
      expect(tipJar.querySelector('summary')?.textContent).toBe('Tip Jar');
      expect(tipJar.textContent).toContain('Wallet height');
      expect(tipJar.textContent).toContain('3766916');
      expect(tipJar.textContent).toContain('Node height');
      expect(tipJar.textContent).toContain('Wallet status');
      expect(tipJar.textContent).toContain('Synced');
      expect(tipJar.textContent).toContain('Network');
      expect(tipJar.textContent).toContain('mainnet');
      expect(tipJar.textContent).toContain('Node');
      expect(tipJar.textContent).toContain('xmr.workstr.fit:43736');
    });

    it('leaves no Lightning surface anywhere in Settings', () => {
      for (const root of [off(), on()]) {
        const text = root.textContent || '';
        for (const gone of ['Zap', 'Lightning', 'NWC', 'sats', 'Payment Mode']) expect(text).not.toContain(gone);
        expect(root.querySelector('.nwc-card, .payment-rail, .payment-mode-card, #open-nwc-zap, #support-funding')).toBeNull();
      }
    });
  });

  // The card holds two preferences, and #202 asked for them to read as one surface: plain
  // blocks divided by a line, with nothing inside carrying the bordered `.settings-row-main`
  // treatment that would make it look like a card within a card.
  describe('Training Preferences', () => {
    const withKit = (): HTMLElement => render({
      library: [{ id: 'a', name: 'Row', equipment: ['Dumbbells'] }, { id: 'b', name: 'Push-up', equipment: ['Body Weight'] }],
      discoverExercises: [{ id: 'c', name: 'Press', equipment: ['Bench'] }],
      settings: { unit: 'lbs', paymentMode: 'off', publicRelays: [], ownedEquipment: ['Dumbbells'] }
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
      // "Dumbbells" and a kit saved as dumbbells both resolve to the shared dumbbell key.
      expect(boxes.map((box) => box.value)).toEqual(['bench', 'dumbbell']);
      expect(boxes.every((box) => box.type === 'checkbox')).toBe(true);
      expect(boxes.filter((box) => box.checked).map((box) => box.value)).toEqual(['dumbbell']);
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
        settings: { unit: 'kg', paymentMode: 'off', publicRelays: [], ownedEquipment: ['Dumbbells', 'Bench'] }
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

  it('moves device and account access into Access & Security', () => {
    const account = render(signedIn({ profileName: 'Trainer', deviceVault: 'unlocked' } as Partial<AppState>));
    const access = account.querySelector('.access-card')?.closest('.settings-group') as HTMLElement;
    for (const id of ['#add-device-settings', '#sign-out-settings', '#remove-account-data', '#change-device-code', '#lock-workstr']) {
      expect(access.querySelector(id), id).toBeTruthy();
      expect(account.querySelector('.profile-card')?.querySelector(id), id).toBeNull();
    }
    // Profile already says who this is; Access & Security does not repeat it.
    expect(access.querySelector('.profile-avatar, img')).toBeNull();
    expect(access.textContent).not.toContain('Trainer');
    // The destructive action is set apart from the routine ones.
    expect(access.querySelector('.access-danger #remove-account-data')?.classList.contains('danger')).toBe(true);

    const localOnly = render();
    expect(localOnly.querySelector('#add-device-settings')).toBeNull();
    expect(localOnly.querySelector('#sign-out-settings')).toBeNull();
    expect(localOnly.querySelector('#remove-account-data')).toBeNull();
    expect(localOnly.querySelector('.profile-card #sign-in-settings')?.textContent).toBe('Create or restore account');
  });
});

// Regrouping is a markup change, and the patchers from #189 find their targets by selector.
// A reshuffle that breaks one of them fails silently: the page looks right and the disclosure
// bug comes back. These assert against the real page markup rather than a fixture.
describe('the background patchers still find their cards', () => {
  it('writes the sync card inside the grouped page', () => {
    const root = render({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'off', publicRelays: [], backup: { enabled: true } } } as Partial<AppState>);
    const card = root.querySelector('.data-sync-card') as HTMLDetailsElement;
    card.open = true;

    expect(updateBackupCard(root, backupPanelState(state({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'off', publicRelays: [], backup: { enabled: true } }, backup: { state: 'syncing', pending: 2 } } as Partial<AppState>)))).toBe(true);

    expect(root.querySelector('.data-sync-card')).toBe(card);
    expect(card.open).toBe(true);
    expect(root.querySelector('.data-sync-card #auto-backup')).toBeTruthy();
    expect(root.querySelector('.data-sync-card #export-data')).toBeTruthy();
  });

  // The bug this catches: the old Account summary was redesigned and its patcher still wrote
  // the old shape into it, so the page rendered correctly and was then overwritten a moment
  // later. Rendering the view and running the patch over it is the only way to see that.
  it('leaves the Profile card saying what the view wrote', () => {
    const signedIn = state({ pubkey: 'ab'.repeat(32), npub: 'npub1trainer', profileName: 'Trainer' });
    document.body.innerHTML = `<div id="app">${settingsView(signedIn)}</div>`;
    const root = document.getElementById('app') as HTMLElement;

    updateAccountIdentity(root, accountIdentity(signedIn));

    expect(root.querySelector('.profile-card .profile-name')?.textContent).toBe('Trainer');
    expect(root.querySelector('.profile-card .profile-npub')?.textContent).toBe(displayNpub('ab'.repeat(32)));
  });

  it('patches the sync status line inside the grouped page', () => {
    const root = render({ pubkey: 'ab'.repeat(32), settings: { unit: 'kg', paymentMode: 'off', publicRelays: [], backup: { enabled: true } } } as Partial<AppState>);

    const patched = updateBackupStatus(root, backupPanelState(state({
      pubkey: 'ab'.repeat(32),
      settings: { unit: 'kg', paymentMode: 'off', publicRelays: [], backup: { enabled: true } },
      backup: { state: 'syncing', pending: 3 }
    } as Partial<AppState>)));

    expect(patched).toBe(true);
    expect(root.querySelector('.data-sync-card > summary .status-pill')?.textContent).toBe('syncing');
  });
});
