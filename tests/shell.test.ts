// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { launchSignerUri, renderShell } from '../src/app/shell';

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
    expect(settings?.querySelector('#create-account-settings')).toBeTruthy();
    expect(settings?.querySelector('#restore-account-settings')).toBeTruthy();
    expect(settings?.querySelector('#enable-sync')).toBeTruthy();
    expect(settings?.querySelector('#auto-backup')).toBeNull();
    expect(settings?.textContent).toContain('Create sync account');
    expect(settings?.textContent).toContain('Manual backup');
    expect(settings?.textContent).toContain('0 selected');
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
