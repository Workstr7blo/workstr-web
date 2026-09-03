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
    expect(settings?.textContent).toContain('Lightning zaps (default)');
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

  it('toggles Monero Mode without touching zap or NWC behavior', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await shell.ready;
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();

    const toggle = () => root.querySelector<HTMLInputElement>('#payment-mode-toggle');
    expect(toggle()?.checked).toBe(false);
    expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false);

    toggle()!.checked = true;
    toggle()!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-payment-mode')).toBe('monero'));
    expect(root.querySelector('.settings-page')?.textContent).toContain('Monero payment targets');

    toggle()!.checked = false;
    toggle()!.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false));
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

  it('renders a compact kind 0 identity chip when signed in', () => {
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
      discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' }
    } as AppState);

    expect(markup).toContain('class="connection-avatar" src="https://example.com/avatar.png"');
    expect(markup).toContain('>Settebello</span>');
    expect(markup).toContain('aria-label="Signed in"');
    expect(markup).not.toContain('>Connected</span>');
    expect(markup).not.toContain('connection-chip-label">Account');
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
