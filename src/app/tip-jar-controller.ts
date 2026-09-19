import { tipJarOn } from '../features/monero/tip-jar-state';
import { updateTipJarNav, updateTipJarPage } from '../features/monero/tip-jar-view';
import { accountIdentity, updateAccountIdentity } from './account-chip';
import type { AppState } from './state';

export interface TipJarControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  savePaymentMode(mode: 'monero' | 'off'): Promise<void>;
  refreshAuthorPaymentTargets(): Promise<void>;
  moneroAddress: { repaint(): void; refreshIfNeeded(): void };
  moneroWallet: { autoSync(): Promise<void>; stop(): Promise<void>; createWallet(): Promise<void> };
  activity?: { resolveProfiles(): Promise<void> };
  send?: { openSend(): boolean };
}

// The Tip Jar setting repaints the payment tokens, and the tokens are declared on `:root`, so
// the flag has to land there too - an override on `body` cannot win against `:root`.
export function applyPaymentMode(state: AppState): void {
  if (tipJarOn(state)) document.documentElement.setAttribute('data-payment-mode', 'monero');
  else document.documentElement.removeAttribute('data-payment-mode');
}

export function createTipJarController(ctx: TipJarControllerContext) {
  const { root, state, toast, moneroAddress, moneroWallet } = ctx;

  // The nav badge and the page, patched in place. Neither needs a page render to follow a sync.
  function repaint(): void {
    updateTipJarNav(root, state);
    updateTipJarPage(root, state);
  }

  // One switch, whichever surface flips it: the Settings toggle and the Tip Jar page's Enable
  // button both land here. Written in place rather than rendered, so no open card is closed.
  async function setEnabled(on: boolean): Promise<void> {
    await ctx.savePaymentMode(on ? 'monero' : 'off');
    applyPaymentMode(state);
    const toggle = root.querySelector<HTMLInputElement>('#monero-tips-toggle');
    if (toggle) toggle.checked = on;
    updateAccountIdentity(root, accountIdentity(state));
    moneroAddress.repaint();
    moneroAddress.refreshIfNeeded();
    void ctx.refreshAuthorPaymentTargets();
    repaint();
    if (on) void moneroWallet.autoSync();
    else void moneroWallet.stop();
  }

  // Delegated once: the page body is rebuilt in place, so per-render binding would miss it.
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('#tip-jar-body button');
    if (!target) return;
    if (target.id === 'tip-jar-enable') void setEnabled(true);
    else if (target.id === 'tip-jar-create') void moneroWallet.createWallet();
    else if (target.id === 'tip-jar-receive') {
      const panel = root.querySelector<HTMLElement>('#tip-jar-receive-panel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      target.setAttribute('aria-expanded', String(!panel.hidden));
    }
    else if (target.id === 'tip-jar-send') ctx.send?.openSend();
    // Both the address row's glyph and the Copy address button carry the whole address, however
    // little of it the row shows.
    else if (target.dataset.tipJarCopy !== undefined) {
      void navigator.clipboard.writeText(target.dataset.address || '').then(() => toast('Copied'), () => toast('Could not copy', 'bad'));
    }
  });

  return {
    repaint,
    setEnabled,
    // Opening the page checks the published address, brings the wallet up to date, and asks for
    // any creator profile the activity list is still missing.
    open(): void {
      if (!tipJarOn(state)) return;
      moneroAddress.refreshIfNeeded();
      void moneroWallet.autoSync();
      void ctx.activity?.resolveProfiles();
    }
  };
}
