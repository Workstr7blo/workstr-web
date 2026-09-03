import type { RelayProgram } from '../nostr/canon';
import { moneroTipAddress, moneroTipCreator, moneroTipModal } from '../features/sheets/monero-tip-view';
import type { AppState } from './state';

export interface MoneroTipControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
}

/**
 * Tipping a program's creator in Monero.
 *
 * Everything this controller does is local: it shows an address the relays already
 * published, copies it, or hands it to a wallet. It never reaches Idenstr, NWC, or the
 * program-zap path — a Monero transfer is not a NIP-57 zap and must not borrow its
 * plumbing.
 */
export function createMoneroTipController(ctx: MoneroTipControllerContext) {
  const { root, state, toast, openModal } = ctx;

  function findProgram(address: string): RelayProgram | undefined {
    return state.programs.find((program) => program.address === address);
  }

  function show(address: string): void {
    const program = findProgram(address);
    const target = program ? moneroTipAddress(program, state) : '';
    // The button only exists when there is an address, so this is a stale card being
    // clicked after a refresh dropped the target rather than something to explain at length.
    if (!program || !target) { toast('This creator has no public Monero address', 'bad'); return; }
    openModal(moneroTipModal({
      address: target,
      creator: moneroTipCreator(program, state),
      programName: program.name
    }));
    bindModal(target);
  }

  function bindModal(address: string): void {
    const copy = root.querySelector<HTMLButtonElement>('#monero-tip-copy');
    copy?.addEventListener('click', () => {
      // Clipboard access can be refused outright (an insecure context, a permission
      // policy). The address stays on screen either way, so a failure only has to say so.
      navigator.clipboard?.writeText(address).then(
        () => { copy.textContent = 'Copied'; },
        () => { toast('Could not copy — select the address instead', 'bad'); }
      );
    });
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-monero-tip]').forEach((button) => button.addEventListener('click', (event) => {
      // The card header toggles on click, and the tip action is inside it.
      event.stopPropagation();
      show(button.dataset.moneroTip || '');
    }));
  }

  return { bind, show };
}
