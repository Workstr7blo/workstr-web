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
  store: null,
  settings: { unit: 'kg', paymentMode: 'off', publicRelays: [] },
  monero: { status: 'idle', address: '' }, profile: { status: 'idle', editing: false },
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
    // `data-fallback="next"` reaches the fallback through `nextElementSibling`. Anything
    // between them turns a broken avatar into a blank hole.
    expect(image?.nextElementSibling?.className).toBe('connection-avatar fallback');
    expect(image?.getAttribute('data-fallback')).toBe('next');
    expect(image?.hasAttribute('onerror')).toBe(false);
  });

  // The point of the whole change: an <img> that is still showing the same picture is not
  // recreated, because a fresh one is a fresh fetch and a visible redraw.
  it('leaves the picture element alone when only the name changed', () => {
    const root = mount(accountIdentity(state()));
    const image = root.querySelector('img.connection-avatar');
    updateAccountIdentity(root, accountIdentity(state({ profileName: 'Coach' })));
    expect(root.querySelector('img.connection-avatar')).toBe(image);
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Coach');
    expect(root.querySelector('.profile-card .profile-name')?.textContent).toBe('Coach');
    // The name is patched where the name lives. The npub under it does not change with a
    // profile - overwriting it with the name was the bug this assertion replaces.
    expect(root.querySelector('.profile-card .profile-npub')?.textContent).toMatch(/^npub1/);
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
    expect(root.querySelector('img.profile-avatar')).toBeTruthy();
    expect(root.querySelector('.profile-card .profile-name')?.textContent).toBe('Trainer');
    expect(root.querySelector('.profile-card .profile-npub')?.textContent).toMatch(/^npub1/);
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

  // An open editor holds a draft. A profile arriving from a relay must not write over it.
  it('leaves an open Profile editor alone', () => {
    const editing = state({ profile: { status: 'ready', editing: true, event: null, baseline: { displayName: 'Trainer', picture: '', address: '' }, draft: { displayName: 'Typed', picture: '', address: '' } } } as Partial<AppState>);
    const root = mount(accountIdentity(editing), editing);
    updateAccountIdentity(root, accountIdentity(state({ profileName: 'Coach' })));
    expect(root.querySelector<HTMLInputElement>('#profile-display-name')?.value).toBe('Typed');
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Coach');
  });

  it('carries the signed-out chip and its Local line', () => {
    const root = mount(accountIdentity(state({ pubkey: null, profileName: null, profilePicture: null })));
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Account');
    expect(root.querySelector('.connection-chip-status')?.textContent).toContain('Local');
    expect(root.querySelector('.connection-identity-status')).toBeNull();
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
    expect(root.querySelector('.connection-avatar.fallback')?.textContent).toBe('W');
  });

  it('uses the identity pill as the Settings affordance', () => {
    const root = mount(accountIdentity(state()));
    const chip = root.querySelector<HTMLButtonElement>('#account-chip')!;
    expect(chip.getAttribute('aria-label')).toBe('Open settings');
    expect(chip.querySelector('.connection-chip-settings')).toBeTruthy();
    expect(chip.querySelector('.connection-chip-chevron')).toBeNull();
    expect(chip.querySelector('.connection-chip-settings button')).toBeNull();
  });

  // #260: the Tip Jar is the bottom navigation's to report. Turning it on must leave the
  // header exactly as it was - no medallion, no Monero mark, no second status element.
  it('carries no Tip Jar mark whether the Tip Jar is on or off', () => {
    const root = mount(accountIdentity(state()));
    const before = root.querySelector('#account-chip')!.innerHTML;
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
    updateAccountIdentity(root, accountIdentity(state({ settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } } as Partial<AppState>)));
    expect(root.querySelector('.connection-payment-mark')).toBeNull();
    expect(root.querySelector('.monero-mark')).toBeNull();
    expect(root.querySelector('#account-chip')!.innerHTML).toBe(before);
  });

  // Every view except Settings has no Profile card, and the chip itself is gone while the
  // shell has not mounted yet. Reporting that is how a caller tells a silent state update
  // from a visible one.
  it('reports that there was nothing to write to', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    expect(updateAccountIdentity(root, accountIdentity(state()))).toBe(false);
  });

  it('writes the chip when the Profile card is not on screen', () => {
    document.body.innerHTML = `<div id="app">${accountChip(accountIdentity(state({ profileName: null, profilePicture: null })))}</div>`;
    const root = document.getElementById('app') as HTMLElement;
    expect(updateAccountIdentity(root, accountIdentity(state()))).toBe(true);
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Trainer');
  });
});
