// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountChip, accountIdentity, avatarFace, updateAccountIdentity, type AccountIdentity } from '../src/app/account-chip';
import type { AppState } from '../src/app/state';

const state = (over: Partial<AppState> = {}): AppState => ({
  pubkey: 'ab'.repeat(32),
  profileName: 'Trainer',
  profilePicture: 'https://example.invalid/a.png',
  settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] },
  ...over
} as AppState);

// The chip and the Settings card as the shell mounts them, so the patch is exercised
// against the markup it will actually meet.
function mount(identity: AccountIdentity): HTMLElement {
  document.body.innerHTML = `<div id="app">
    <div class="topbar-actions">${accountChip(identity)}</div>
    <details class="settings-category account-card" data-settings-section="account">
      <summary><span class="settings-category-copy"><strong>Account</strong><small>Signed in · ${identity.label}</small></span></summary>
      <div class="settings-row-main account-row">
        <div class="settings-account-identity">${avatarFace('settings-account-avatar', identity)}<span><strong>${identity.label}</strong><small>Keys stay in your signer.</small></span></div>
      </div>
    </details>
  </div>`;
  return document.getElementById('app') as HTMLElement;
}

describe('the account chip', () => {
  it('keeps the image immediately before its fallback', () => {
    const root = mount(accountIdentity(state()));
    const image = root.querySelector('img.connection-avatar');
    // The `onerror` handler reaches the fallback through `nextElementSibling`. Anything
    // between them turns a broken avatar into a blank hole.
    expect(image?.nextElementSibling?.className).toBe('connection-avatar fallback');
    expect(image?.getAttribute('onerror')).toContain('nextElementSibling');
  });

  // The point of the whole change: an <img> that is still showing the same picture is not
  // recreated, because a fresh one is a fresh fetch and a visible redraw.
  it('leaves the picture element alone when only the name changed', () => {
    const root = mount(accountIdentity(state()));
    const image = root.querySelector('img.connection-avatar');
    updateAccountIdentity(root, accountIdentity(state({ profileName: 'Coach' })));
    expect(root.querySelector('img.connection-avatar')).toBe(image);
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Coach');
    expect(root.querySelector('.settings-account-identity strong')?.textContent).toBe('Coach');
    expect(root.querySelector('.account-card summary small')?.textContent).toBe('Signed in · Coach');
  });

  it('moves the same element to a new picture rather than making another', () => {
    const root = mount(accountIdentity(state()));
    const image = root.querySelector('img.connection-avatar');
    updateAccountIdentity(root, accountIdentity(state({ profilePicture: 'https://example.invalid/b.png' })));
    expect(root.querySelector('img.connection-avatar')).toBe(image);
    expect(image?.getAttribute('src')).toBe('https://example.invalid/b.png');
  });

  // A profile arriving where there was none is the one case that has to build an element,
  // and it must not take the name beside it down with it.
  it('gives a fallback-only avatar a picture without disturbing its siblings', () => {
    const root = mount(accountIdentity(state({ profilePicture: null })));
    expect(root.querySelector('img.connection-avatar')).toBeNull();
    updateAccountIdentity(root, accountIdentity(state()));
    expect(root.querySelector('img.connection-avatar')?.getAttribute('src')).toBe('https://example.invalid/a.png');
    expect(root.querySelector('img.settings-account-avatar')).toBeTruthy();
    expect(root.querySelector('.settings-account-identity strong')?.textContent).toBe('Trainer');
    expect(root.querySelector('.settings-account-identity small')?.textContent).toBe('Keys stay in your signer.');
  });

  it('puts a failed picture back on screen when a working one replaces it', () => {
    const root = mount(accountIdentity(state()));
    const image = root.querySelector<HTMLImageElement>('img.connection-avatar')!;
    const fallback = root.querySelector<HTMLElement>('.connection-avatar.fallback')!;
    image.hidden = true; fallback.hidden = false;
    updateAccountIdentity(root, accountIdentity(state({ profilePicture: 'https://example.invalid/c.png' })));
    expect(image.hidden).toBe(false);
    expect(fallback.hidden).toBe(true);
  });

  it('carries the signed-out chip and its Local line', () => {
    const root = mount(accountIdentity(state({ pubkey: null, profileName: null, profilePicture: null })));
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Account');
    expect(root.querySelector('.connection-chip-status')?.textContent).toContain('Local');
    expect(root.querySelector('.connection-identity-status')).toBeNull();
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
    expect(root.querySelector('.connection-avatar.fallback')?.textContent).toBe('W');
  });

  it('swaps the payment medallion with the rail', () => {
    const root = mount(accountIdentity(state()));
    expect(root.querySelector('.connection-payment-mark')?.textContent).toBe('₿');
    updateAccountIdentity(root, accountIdentity(state({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>)));
    expect(root.querySelector('.connection-payment-mark')?.querySelector('.monero-mark')).toBeTruthy();
    expect(root.querySelector('.connection-payment-mark')?.getAttribute('aria-label')).toBe('Monero payments');
  });

  // Every view except Settings has no Account card, and the chip itself is gone while the
  // shell has not mounted yet. Reporting that is how a caller tells a silent state update
  // from a visible one.
  it('reports that there was nothing to write to', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    expect(updateAccountIdentity(root, accountIdentity(state()))).toBe(false);
  });

  it('writes the chip when the Account card is not on screen', () => {
    document.body.innerHTML = `<div id="app">${accountChip(accountIdentity(state({ profileName: null, profilePicture: null })))}</div>`;
    const root = document.getElementById('app') as HTMLElement;
    expect(updateAccountIdentity(root, accountIdentity(state()))).toBe(true);
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Trainer');
  });
});
