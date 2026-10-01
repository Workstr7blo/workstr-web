// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { confirmAction } from '../src/app/confirm-dialog';

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.confirm-dialog');
const answer = (which: 'confirm' | 'cancel') => dialog()!.querySelector<HTMLButtonElement>(`[data-confirm-answer="${which}"]`)!.click();
const ask = (extra: Partial<Parameters<typeof confirmAction>[0]> = {}) =>
  confirmAction({ title: 'Delete program?', message: 'It is removed from this device.', confirmLabel: 'Delete program', ...extra });

afterEach(() => { document.body.innerHTML = ''; });

describe('confirmAction', () => {
  it('asks in an in-app dialog and resolves true on confirm', async () => {
    const result = ask();
    const el = dialog()!;
    expect(el.hasAttribute('open')).toBe(true);
    expect(el.classList.contains('danger')).toBe(true);
    expect(el.querySelector('.confirm-dialog-title')?.textContent).toBe('Delete program?');
    expect(el.querySelector('[data-confirm-answer="confirm"]')?.textContent).toBe('Delete program');
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h2')!.id);
    answer('confirm');
    await expect(result).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('answers false on Cancel, Escape and a backdrop tap', async () => {
    let result = ask();
    answer('cancel');
    await expect(result).resolves.toBe(false);

    result = ask();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(result).resolves.toBe(false);

    result = ask();
    dialog()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(result).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('focuses Cancel for a destructive question so a stray Enter deletes nothing', async () => {
    const result = ask();
    expect(document.activeElement?.getAttribute('data-confirm-answer')).toBe('cancel');
    answer('cancel');
    await result;
    const neutral = ask({ tone: 'default' });
    expect(document.activeElement?.getAttribute('data-confirm-answer')).toBe('confirm');
    answer('cancel');
    await neutral;
  });

  it('gives focus back to what had it', async () => {
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();
    const result = ask();
    answer('cancel');
    await result;
    expect(document.activeElement).toBe(button);
  });

  it('treats names as text, never markup', async () => {
    const result = ask({ title: 'Delete <img src=x onerror=alert(1)>?' });
    expect(dialog()!.querySelector('img')).toBeNull();
    expect(dialog()!.querySelector('h2')?.textContent).toContain('<img');
    answer('cancel');
    await result;
  });

  it('declines the earlier question when a second one opens over it', async () => {
    const first = ask();
    const second = ask({ title: 'Second?' });
    await expect(first).resolves.toBe(false);
    expect(document.querySelectorAll('dialog.confirm-dialog')).toHaveLength(1);
    answer('confirm');
    await expect(second).resolves.toBe(true);
  });
});
