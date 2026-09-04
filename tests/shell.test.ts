// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { launchSignerUri, renderShell } from '../src/app/shell';
import { shellMarkup } from '../src/app/layout';
import type { AppState } from '../src/app/state';

// Boot and settings-view rendering both kick off background relay fetches unrelated to this
// file's assertions; without mocks they open real sockets that outlive a synchronous test and
// surface as unhandled errors once some other test actually awaits long enough to observe them.
vi.mock('../src/nostr/zaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/zaps')>(),
  fetchMonthlyZapReceipts: vi.fn(async () => [])
}));
vi.mock('../src/nostr/canon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/canon')>(),
  fetchCanonExercises: vi.fn(async () => []),
  fetchCanonPrograms: vi.fn(async () => [])
}));
// `renderShell` also fires a background kind-0 lookup whenever a session pubkey is present.
// That one was missed, so the suite still opened real relay sockets and intermittently failed
// the run with an undici/jsdom `Event` mismatch even though every test passed.
vi.mock('../src/nostr/profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/profile')>(),
  fetchProfile: vi.fn(async () => null)
}));

describe('shell', () => {
  it('renders the app chrome and all views without a signer', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    renderShell(root);
    expect(root.querySelector('.sidebar')).toBeTruthy();
    expect(root.querySelector('#page-exercises')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-library')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-discover')).toBeTruthy();
    // walk every nav view; each must render its page without throwing
    for (const view of ['workouts', 'statistics', 'settings', 'exercises']) {
      root.querySelector<HTMLElement>(`[data-view="${view}"]`)?.click();
      expect(root.querySelector('.page.active'), view).toBeTruthy();
    }
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();
    const settings = root.querySelector('.settings-page') as HTMLElement;
    expect(settings?.textContent).toContain('Account');
    expect(settings?.textContent).toContain('Beast Mode');
    expect(settings?.textContent).toContain('Create 1 local program');
    expect(settings?.textContent).toContain('Complete 5 workouts');
    expect(settings?.textContent).toContain('Train on 3 distinct local days');
    expect(settings?.textContent).toContain('Signed-in Nostr profile has a picture');
    expect(settings?.textContent).toContain('Data & Sync');
    expect(settings?.textContent).toContain('Training Preferences');
    expect(settings?.textContent).toContain('Support Workstr');
    expect(settings?.textContent).toContain('Monero Mode');
    expect(settings?.textContent).toContain('Lightning zaps');
    expect(settings?.querySelector('.advanced-settings:not([open])')).toBeTruthy();
    expect(settings?.querySelectorAll('.settings-category:not([open])')).toHaveLength(8);
    expect(settings?.querySelector('.account-card summary')?.textContent).toContain('Local only');
    expect(settings?.querySelector('.beast-mode-card summary')?.textContent).toContain('0/4 objectives');
    expect(settings?.querySelector('.account-card .terminal-mini')).toBeNull();
    expect(settings?.querySelector('#sign-in-settings')).toBeTruthy();
    expect(settings?.querySelector('#create-account-settings')).toBeNull();
    expect(settings?.querySelector('#restore-account-settings')).toBeNull();
    expect(settings?.querySelector('#enable-sync')).toBeNull();
    expect(settings?.querySelector('#auto-backup')).toBeNull();
    expect(settings?.textContent).not.toContain('Create sync account');
    expect(settings?.textContent).toContain('Use Account above');
    expect(settings?.textContent).toContain('Manual backup');
    expect(settings?.textContent).toContain('0 selected');
    expect(settings?.querySelector('.beast-mode-card [data-beast-mode-state="locked"]')).toBeTruthy();
  });

  it('swaps the wallet card for the Monero payment address when the rail changes', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await shell.ready;
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();

    const rail = (value: string) => root.querySelector<HTMLInputElement>(`input[name="payment-mode"][value="${value}"]`);
    const selected = () => root.querySelector('.payment-rail-option.selected .payment-rail-copy strong')?.textContent;
    const pick = (value: string) => {
      const input = rail(value)!;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Lightning is the default rail, and it is a choice rather than an off state.
    expect(rail('lightning')?.checked).toBe(true);
    expect(rail('monero')?.checked).toBe(false);
    expect(selected()).toBe('Lightning zaps');
    expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false);

    pick('monero');
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-payment-mode')).toBe('monero'));
    expect(selected()).toBe('Monero tips');
    expect(root.querySelector('.payment-mode-card .status-pill.ok')?.textContent).toBe('MONERO');

    // The wallet card is replaced, not deleted: nothing about the stored NWC connection
    // changes, and the section that takes its place is a payment address rather than a wallet.
    expect(root.querySelector('.nwc-card')).toBeNull();
    expect(root.querySelector('#nwc-connect')).toBeNull();
    expect(root.querySelector('#monero-address-section')).toBeTruthy();
    expect(root.querySelector('.payment-mode-card[open]')).toBeTruthy();
    expect(root.querySelector('#open-nwc-zap')).toBeNull();

    pick('lightning');
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false));
    expect(selected()).toBe('Lightning zaps');
    expect(root.querySelector('.nwc-card')).toBeTruthy();
    expect(root.querySelector('#nwc-connect')).toBeTruthy();
    expect(root.querySelector('#monero-address-section')).toBeNull();
    expect(root.querySelector('#open-nwc-zap')).toBeTruthy();
  });

  it('opens a single tabbed account modal from the signed-out chip', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    renderShell(root);

    root.querySelector<HTMLElement>('#account-chip')?.click();
    const modal = root.querySelector('#modal.open') as HTMLElement;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Workstr account');
    expect(modal.querySelector('#auth-tab-login[aria-selected="true"]')).toBeTruthy();
    expect(modal.querySelector('#auth-tab-create[aria-selected="false"]')).toBeTruthy();
    expect(modal.querySelector('#restore-local-account')).toBeTruthy();
    expect(modal.querySelector('#connect-remote-signer')).toBeTruthy();
    expect(modal.querySelector('#create-local-account')).toBeNull();

    modal.querySelector<HTMLElement>('#auth-tab-create')?.click();
    const createModal = root.querySelector('#modal.open') as HTMLElement;
    expect(createModal.querySelector('#auth-tab-create[aria-selected="true"]')).toBeTruthy();
    expect(createModal.querySelector('#create-local-account')).toBeTruthy();
    expect(createModal.querySelector('#restore-local-account')).toBeNull();
  });

  // The account pill carries two independent states — is this identity connected, and which
  // rail pays creators — so most of its tests differ from each other by one field.
  const signedIn = (overrides: Partial<AppState> = {}): AppState => ({
    pubkey: 'f'.repeat(64),
    npub: null,
    profileName: 'Settebello',
    profilePicture: 'https://example.com/avatar.png',
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    monero: { status: 'idle', address: '' },
    signerType: 'local',
    view: 'exercises',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
    programZapAttempts: [],
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
  } as AppState);

  // The account chip's own row: avatar wrapper, then name, then the payment medallion, then
  // the chevron. Slicing to the button keeps `₿` assertions off the Settings rail selector,
  // which renders the same glyph further down the same markup.
  const accountChip = (markup: string): string =>
    markup.slice(markup.indexOf('id="account-chip"'), markup.indexOf('</header>'));

  it('renders a compact kind 0 identity chip when signed in', () => {
    const markup = shellMarkup(signedIn());

    expect(markup).toContain('class="connection-avatar" src="https://example.com/avatar.png"');
    expect(markup).toContain('>Settebello</span>');
    expect(markup).toContain('aria-label="Signed in"');
    expect(markup).not.toContain('>Connected</span>');
    expect(markup).not.toContain('connection-chip-label">Account');
  });

  it('badges the avatar with the signed-in dot instead of floating it beside the name', () => {
    const chip = accountChip(shellMarkup(signedIn()));

    expect(chip).toContain('class="connection-avatar-wrap"');
    expect(chip).toContain('class="connection-identity-status" role="img" aria-label="Signed in"');
    // The status badge is inside the avatar wrapper, and the name is not.
    expect(chip.indexOf('connection-identity-status')).toBeLessThan(chip.indexOf('connection-chip-main'));
    // The old bare dot beside the username is gone.
    expect(chip).not.toContain('<span class="connection-dot" aria-label="Signed in">');
  });

  it('keeps the broken-avatar fallback adjacent to the image it replaces', () => {
    const chip = accountChip(shellMarkup(signedIn()));
    // `onerror` reaches the fallback through `nextElementSibling`, so nothing may sit between
    // them. The status badge has to come after the fallback, not before it.
    expect(chip).toContain('onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="connection-avatar fallback" hidden>S</span><span class="connection-identity-status"');
  });

  it('falls back to the profile initial and still badges the avatar', () => {
    const chip = accountChip(shellMarkup(signedIn({ profilePicture: null })));

    expect(chip).toContain('<span class="connection-avatar fallback">S</span>');
    expect(chip).toContain('connection-identity-status');
    expect(chip).not.toContain('<img class="connection-avatar"');
  });

  it('marks the account pill with the Lightning rail by default', () => {
    const chip = accountChip(shellMarkup(signedIn()));

    expect(chip).toContain('class="connection-payment-mark" role="img" aria-label="Lightning payments"');
    expect(chip).toContain('title="Lightning payment mode"');
    expect(chip).toContain('₿');
    expect(chip).not.toContain('monero-mark');
    // Informational only: the pill stays one button, so no nested control appears.
    expect(chip).not.toContain('<button');
    // The rail sits between the name and the chevron.
    expect(chip.indexOf('connection-payment-mark')).toBeLessThan(chip.indexOf('connection-chip-chevron'));
  });

  it('swaps the account pill to the Monero rail without changing its structure', () => {
    const chip = accountChip(shellMarkup(signedIn({ settings: { unit: 'kg', publicRelays: [], paymentMode: 'monero' } })));

    expect(chip).toContain('class="connection-payment-mark" role="img" aria-label="Monero payments"');
    expect(chip).toContain('title="Monero payment mode"');
    expect(chip).toContain('monero-mark');
    expect(chip).not.toContain('₿');
    // Same component, same identity badge — only the rail changed.
    expect(chip).toContain('connection-identity-status');
    expect(chip).toContain('class="connection-avatar-wrap"');
  });

  it('leaves a local account unbadged and without a payment rail', () => {
    const chip = accountChip(shellMarkup(signedIn({ pubkey: null, profileName: null, profilePicture: null })));

    expect(chip).toContain('connection-chip-label">Account');
    expect(chip).toContain('>Local</span>');
    expect(chip).not.toContain('aria-label="Signed in"');
    expect(chip).not.toContain('connection-identity-status');
    expect(chip).not.toContain('connection-payment-mark');
  });

  it('renders Beast Mode as unlocked in Settings from objective local state', () => {
    const markup = shellMarkup({
      pubkey: 'f'.repeat(64),
      npub: null,
      profileName: 'Settebello',
      profilePicture: 'https://example.com/avatar.png',
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
      programZapAttempts: [],
      activeSession: null,
      finishedSessions: [
        { id: 1, sheetName: 'A', startedAt: '2026-08-01T10:00:00', finishedAt: '2026-08-01T10:30:00', exercises: [], sets: [] },
        { id: 2, sheetName: 'B', startedAt: '2026-08-01T11:00:00', finishedAt: '2026-08-01T11:30:00', exercises: [], sets: [] },
        { id: 3, sheetName: 'C', startedAt: '2026-08-02T10:00:00', finishedAt: '2026-08-02T10:30:00', exercises: [], sets: [] },
        { id: 4, sheetName: 'D', startedAt: '2026-08-03T10:00:00', finishedAt: '2026-08-03T10:30:00', exercises: [], sets: [] },
        { id: 5, sheetName: 'E', startedAt: '2026-08-03T11:00:00', finishedAt: '2026-08-03T11:30:00', exercises: [], sets: [] }
      ],
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
      sheets: [{ id: 1, slug: 'push-day', name: 'Push Day', notes: '', difficulty: '', tags: [], is_temporary: false, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', exercises: [] }],
      library: [],
      librarySelect: { active: false, slugs: new Set() },
      discoverSelect: { active: false, addresses: new Set() },
      discoverExercises: [],
      exFilter: { cat: '', muscle: '', diff: '', equip: '' },
      discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' }
    } as AppState);

    expect(markup).toContain('data-beast-mode-state="unlocked"');
    expect(markup).toContain('>UNLOCKED</span>');
    expect(markup).toContain('4/4 objectives');
  });
});

describe('signer app launch', () => {
  it('reuses the current context on mobile instead of opening a blank tab', () => {
    document.body.innerHTML = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.target).toBe('');
      expect(this.href).toBe('nostrconnect://example');
    });
    launchSignerUri('nostrconnect://example', true);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a')).toBeNull();
    click.mockRestore();
  });

  it('keeps the desktop signer flow in a separate tab', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.target).toBe('_blank');
    });
    launchSignerUri('nostrconnect://example', false);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
