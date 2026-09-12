// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { settingsView } from '../src/app/settings-view';
import { accountChip, accountIdentity, avatarFace, updateAccountIdentity, type AccountIdentity } from '../src/app/account-chip';
import type { AppState } from '../src/app/state';

// Enough state to render the whole Settings page, because that is what the patch runs
// against. The identity fields are what these tests actually vary.
const state = (over: Partial<AppState> = {}): AppState => ({
  pubkey: 'ab'.repeat(32),
  npub: 'npub1trainer',
  profileName: 'Trainer',
  profilePicture: 'https://example.invalid/a.png',
  profileNames: {},
  signerType: 'local',
  store: null,
  settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] },
  monero: { status: 'idle', address: '' },
  library: [],
  discoverExercises: [],
  finishedSessions: [],
  sheets: [],
  backup: { state: 'off', pending: 0 },
  signInStatus: null,
  ...over
} as unknown as AppState);

// The chip beside the real Settings page, not a hand-written imitation of it. A fixture
// that only looked like the card let the card be restructured underneath this patch without
// a single test failing - the page rendered correctly and then had its summary overwritten
// at runtime. `settingsView` is the markup the patch will actually meet.
function mount(identity: AccountIdentity, appState = state()): HTMLElement {
  document.body.innerHTML = `<div id="app">
    <div class="topbar-actions">${accountChip(identity)}</div>
    ${settingsView(appState)}
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
    // The name is patched where the name lives. The line under it says which signer holds
    // the key, which a profile does not change - overwriting it with the name was the bug
    // this assertion replaces.
    expect(root.querySelector('.account-card summary .settings-category-copy strong')?.textContent).toBe('Coach');
    expect(root.querySelector('.account-card summary .settings-category-copy small')?.textContent).toBe('Signed in with a device key');
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
    expect(root.querySelector('.settings-account-identity small')?.textContent).toBe('Device-managed key for faster sync.');
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

  // Off has nothing to mark, so the medallion is added and removed rather than swapped.
  it('adds and removes the Monero medallion with the switch', () => {
    const root = mount(accountIdentity(state()));
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
    updateAccountIdentity(root, accountIdentity(state({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>)));
    expect(root.querySelector('.connection-payment-mark')?.querySelector('.monero-mark')).toBeTruthy();
    expect(root.querySelector('.connection-payment-mark')?.getAttribute('aria-label')).toBe('Monero tips on');
    updateAccountIdentity(root, accountIdentity(state()));
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
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
