// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountChoiceMarkup } from '../src/app/account-choice-view';

function render(): HTMLElement {
  document.body.innerHTML = `<div id="modal-content">${accountChoiceMarkup()}</div>`;
  return document.getElementById('modal-content') as HTMLElement;
}

describe('the account choice screen', () => {
  it('offers exactly one way to create a Workstr account', () => {
    const root = render();
    expect(root.querySelectorAll('#create-local-account')).toHaveLength(1);
    expect(root.querySelector('.account-create')?.textContent).toContain('Create a new Workstr account');
  });

  it('offers only Workstr account restore routes for an existing account', () => {
    const ids = Array.from(render().querySelectorAll('.account-paths .account-path')).map((el) => el.id);
    expect(ids).toEqual(['pair-new-device', 'restore-local-account']);
    expect(render().textContent).not.toMatch(/signer|extension|NIP-07|NIP-46/i);
  });

  it('marks scanning as the recommended path in text, not only in colour', () => {
    const scan = render().querySelector('#pair-new-device') as HTMLElement;
    expect(scan.classList.contains('recommended')).toBe(true);
    expect(scan.textContent).toContain('Recommended');
    expect(document.querySelectorAll('.account-path.recommended')).toHaveLength(1);
  });

  it('makes every path a real button so the keyboard reaches it', () => {
    for (const path of Array.from(render().querySelectorAll('.account-path'))) {
      expect(path.tagName).toBe('BUTTON');
      expect(path.getAttribute('type')).toBe('button');
      expect(path.querySelector('strong')?.textContent?.trim()).toBeTruthy();
      expect(path.querySelector('small')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('keeps continuing locally available and quiet', () => {
    const root = render();
    const local = root.querySelector('#continue-local') as HTMLElement;
    expect(local).toBeTruthy();
    expect(local.className).toBe('auth-link-button');
    expect(local.classList.contains('button')).toBe(false);
    expect(root.lastElementChild?.contains(local)).toBe(true);
  });
});
