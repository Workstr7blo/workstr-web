import { icon, type IconName } from './icons';

/**
 * The in-app replacement for `window.confirm`. The native prompt is a grey system sheet with
 * the page's origin as its title, and on iOS it looks like something went wrong rather than a
 * question the app is asking.
 *
 * Built on `<dialog>` and `showModal()` so it sits in the browser's top layer: above the live
 * session overlay, the device vault lock screen and an open modal alike, none of which it
 * replaces or rerenders. It owns its own element, so whatever was on screen underneath is
 * exactly as it was once the answer is in.
 *
 * Every way out that is not the confirm button - Cancel, Escape, a tap on the backdrop, a
 * second confirm opening over it - answers false. A destructive question focuses Cancel, so a
 * stray Enter does not delete anything.
 */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get the danger tone, a warning icon, and focus on Cancel. */
  tone?: 'danger' | 'default';
  icon?: IconName;
}

let pending: { dialog: HTMLDialogElement; finish(answer: boolean): void } | null = null;
let sequence = 0;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  pending?.finish(false);
  const tone = options.tone ?? 'danger';
  const id = `confirm-dialog-${++sequence}`;
  const dialog = document.createElement('dialog');
  dialog.className = `confirm-dialog ${tone}`;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-message`);
  // Static markup only; the caller's title and message go in as text, never as HTML, since
  // they carry program and exercise names that came from relays.
  dialog.innerHTML = `<div class="confirm-dialog-card">
    <div class="confirm-dialog-head"><span class="confirm-dialog-icon" aria-hidden="true">${icon(options.icon ?? (tone === 'danger' ? 'triangle-alert' : 'info'))}</span><h2 class="confirm-dialog-title" id="${id}-title"></h2></div>
    <p class="confirm-dialog-message" id="${id}-message"></p>
    <div class="confirm-dialog-actions">
      <button class="button" type="button" data-confirm-answer="cancel"></button>
      <button class="button ${tone === 'danger' ? 'danger' : 'primary'}" type="button" data-confirm-answer="confirm"></button>
    </div>
  </div>`;
  dialog.querySelector('.confirm-dialog-title')!.textContent = options.title;
  dialog.querySelector('.confirm-dialog-message')!.textContent = options.message;
  const cancel = dialog.querySelector<HTMLButtonElement>('[data-confirm-answer="cancel"]')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-confirm-answer="confirm"]')!;
  cancel.textContent = options.cancelLabel ?? 'Cancel';
  confirm.textContent = options.confirmLabel;

  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      if (pending?.dialog === dialog) pending = null;
      document.removeEventListener('keydown', onKey, true);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.remove();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(answer);
    };
    // `cancel` is the browser's Escape on a modal dialog. The keydown listener covers the
    // engines that do not raise it, and a dialog opened without showModal.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    // A click whose target is the dialog itself landed on the backdrop, outside the card.
    dialog.addEventListener('click', (event) => { if (event.target === dialog) finish(false); });
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey, true);
    pending = { dialog, finish };
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    (tone === 'danger' ? cancel : confirm).focus();
  });
}
