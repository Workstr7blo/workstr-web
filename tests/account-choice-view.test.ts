// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountChoiceMarkup } from '../src/app/account-choice-view';
import * as nip07 from '../src/signer/nip07';

function render(): HTMLElement {
  document.body.innerHTML = `<div id="modal-content">${accountChoiceMarkup()}</div>`;
  return document.getElementById('modal-content') as HTMLElement;
}

const withExtension = (present: boolean) => vi.spyOn(nip07, 'hasNip07').mockReturnValue(present);

afterEach(() => { vi.restoreAllMocks(); });

describe('the account choice screen', () => {
  it('has no tab switcher and no tab state', () => {
    const root = render();
    expect(root.querySelector('.auth-tabs')).toBeNull();
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector('[role="tab"]')).toBeNull();
    expect(root.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it('offers exactly one way to create an account', () => {
    const root = render();
    expect(root.querySelectorAll('#create-local-account')).toHaveLength(1);
    expect(root.querySelector('.account-create')?.textContent).toContain('Create a new Workstr account');
  });

  // The distinction the tabs blurred: a signer holds an identity that already exists. It
  // cannot mint a Workstr recovery key, so it has no business under Create.
  it('keeps signer options out of the create area', () => {
    withExtension(true);
    const create = render().querySelector('.account-create') as HTMLElement;
    expect(create.querySelector('#connect-remote-signer')).toBeNull();
    expect(create.querySelector('#connect-extension-signer')).toBeNull();
    expect(create.textContent).not.toContain('signer');
    expect(create.textContent).not.toContain('extension');
  });

  it('orders the existing-account paths by what most people should pick', () => {
    withExtension(true);
    const ids = Array.from(render().querySelectorAll('.account-paths .account-path')).map((el) => el.id);
    expect(ids).toEqual(['pair-new-device', 'restore-local-account', 'connect-remote-signer', 'connect-extension-signer']);
  });

  // A row that cannot work is worse than no row. This is the one path whose availability is
  // actually detectable, so it is the one that disappears.
  it('drops the extension row when no extension is there', () => {
    withExtension(false);
    const root = render();
    expect(root.querySelector('#connect-extension-signer')).toBeNull();
    expect(Array.from(root.querySelectorAll('.account-path')).map((el) => el.id))
      .toEqual(['pair-new-device', 'restore-local-account', 'connect-remote-signer']);
  });

  it('marks scanning as the recommended path in text, not only in colour', () => {
    const scan = render().querySelector('#pair-new-device') as HTMLElement;
    expect(scan.classList.contains('recommended')).toBe(true);
    expect(scan.textContent).toContain('Recommended');
    // And it is the only one so marked.
    expect(document.querySelectorAll('.account-path.recommended')).toHaveLength(1);
  });

  it('makes every path a real button so the keyboard reaches it', () => {
    withExtension(true);
    for (const path of Array.from(render().querySelectorAll('.account-path'))) {
      expect(path.tagName).toBe('BUTTON');
      expect(path.getAttribute('type')).toBe('button');
      expect(path.querySelector('strong')?.textContent?.trim()).toBeTruthy();
      expect(path.querySelector('small')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('hides the decorative icons from assistive technology', () => {
    const root = render();
    for (const icon of Array.from(root.querySelectorAll('.account-path-icon, .account-create-icon, .account-path-chevron'))) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  // Lowest emphasis, last on the page, and still there: Workstr works without an account and
  // this issue does not change that.
  it('keeps continuing locally available and quiet', () => {
    const root = render();
    const local = root.querySelector('#continue-local') as HTMLElement;
    expect(local).toBeTruthy();
    expect(local.className).toBe('auth-link-button');
    expect(local.classList.contains('button')).toBe(false);
    // Last thing in the modal.
    expect(root.lastElementChild?.contains(local)).toBe(true);
  });

  it('lists a path for every existing-account route the app supports', () => {
    withExtension(true);
    const text = render().querySelector('.account-paths')?.textContent || '';
    for (const phrase of ['Scan from another device', 'Restore with recovery key', 'Use mobile signer', 'Use browser extension']) {
      expect(text).toContain(phrase);
    }
  });

  it('leads with the benefit rather than with sync jargon', () => {
    const intro = render().querySelector('.section-help')?.textContent || '';
    expect(intro).toContain('Use Workstr locally');
    expect(intro).not.toContain('encrypted sync');
  });
});
