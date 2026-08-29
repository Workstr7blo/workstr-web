// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { launchSignerUri, renderShell } from '../src/app/shell';
import { shellMarkup } from '../src/app/layout';
import type { AppState } from '../src/app/state';

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
    expect(settings?.textContent).toContain('Data & Sync');
    expect(settings?.textContent).toContain('Training Preferences');
    expect(settings?.textContent).toContain('Support Workstr');
    expect(settings?.querySelector('.advanced-settings:not([open])')).toBeTruthy();
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
