import type { RelayProgram } from '../nostr/canon';
import type { MoneroSendRecipient } from '../features/monero/types';
import { moneroTipAddress, moneroTipCreator } from '../features/sheets/monero-tip-view';
import type { AppState } from './state';

export interface MoneroTipControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal?(content: string): void;
  // Starts the Workstr Tip Jar flow for this creator. It owns every native not-ready state.
  sendTip?(recipient: MoneroSendRecipient): boolean;
}

/**
 * Tipping a program's creator always starts the Workstr Tip Jar flow.
 *
 * The creator's public NIP-A3 Monero address remains the internal destination for a Workstr
 * Tip Jar send, but a failed readiness check never becomes an external-wallet hand-off.
 */
export function createMoneroTipController(ctx: MoneroTipControllerContext) {
  const { root, state, toast } = ctx;

  function findProgram(address: string): RelayProgram | undefined {
    return state.programs.find((program) => program.address === address);
  }

  function show(address: string): void {
    const program = findProgram(address);
    const target = program ? moneroTipAddress(program, state) : '';
    // The button only exists when there is an address, so this is a stale card being
    // clicked after a refresh dropped the target rather than something to explain at length.
    if (!program || !target) { toast('This creator has no public Monero address', 'bad'); return; }
    const recipient: MoneroSendRecipient = {
      address: target,
      pubkey: program.pubkey,
      name: moneroTipCreator(program, state),
      picture: program.pubkey ? state.authorProfiles?.[program.pubkey]?.picture : undefined,
      programAddress: program.address,
      programName: program.name
    };
    if (!ctx.sendTip?.(recipient)) toast('Tip Jar is temporarily unavailable. Try again in a moment.', 'bad');
  }

  // Scoped so a program list rewritten by a filter can rebind its own cards without the
  // page around them being rendered.
  function bind(scope: ParentNode = root): void {
    scope.querySelectorAll<HTMLElement>('[data-monero-tip]').forEach((button) => button.addEventListener('click', (event) => {
      // The card header toggles on click, and the tip action is inside it.
      event.stopPropagation();
      show(button.dataset.moneroTip || '');
    }));
  }

  return { bind, show };
}
