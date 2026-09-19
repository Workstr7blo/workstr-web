import { normalizePaymentMode } from '../../core/types';
import type { AppState } from '../../app/state';
import type { MoneroWalletSyncState } from './types';

// The one mapping from wallet state to what the Tip Jar shows. The nav badge, the Tip Jar page
// and its status word all read this, so they cannot disagree about the same wallet.
export type TipJarVisualState = 'off' | 'connecting' | 'syncing' | 'ready' | 'error';

export interface TipJarStatus {
  visual: TipJarVisualState;
  // Short user-facing word for the page.
  word: string;
  // For assistive technology, after "Tip Jar, ".
  spoken: string;
  // 0..1; 1 once synchronized, 0 when unknown.
  progress: number;
  // Whether `progress` is live scanning progress. The nav ring is drawn only when it is: a
  // bright arc that cannot move yet reads as a stalled sync rather than a starting one (#266).
  live: boolean;
}

// The Settings switch, the nav item, the page and wallet activation all read this one setting.
// What the bottom-nav item is called right now. The nav says three things only - the Tip Jar
// exists, it is catching up, it cannot be reached - so the five wallet states collapse to three
// words. The page keeps the finer `word` above.
export function tipJarNavLabel(visual: TipJarVisualState): string {
  if (visual === 'connecting' || visual === 'syncing') return 'Syncing';
  return visual === 'error' ? 'Offline' : 'Tip Jar';
}

export function tipJarOn(state: AppState): boolean {
  return normalizePaymentMode(state.settings.paymentMode) === 'monero';
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// Tolerates missing heights, a zero daemon height and a wallet ahead of a stale daemon reading.
export function syncFraction(sync: Pick<MoneroWalletSyncState, 'height' | 'daemonHeight'> | null | undefined): number {
  const height = sync?.height;
  const daemonHeight = sync?.daemonHeight;
  if (typeof height !== 'number' || typeof daemonHeight !== 'number' || daemonHeight <= 0) return 0;
  return clamp(height / daemonHeight);
}

// How far the wallet has come in the catch-up session it is scanning now: from the height the
// sync started at to the daemon height it is heading for. This is what the ring promises, and
// what `height / daemonHeight` cannot say - a wallet a thousand blocks behind a three-million
// block chain is at 99.97% of the chain and at 0% of its own catch-up. Null when the heights
// describe no session, so the caller falls back instead of painting a false nought (#266).
export function blockSyncFraction(currentHeight: number, startHeight: number, targetHeight: number): number | null {
  if (![currentHeight, startHeight, targetHeight].every((value) => Number.isFinite(value))) return null;
  const total = targetHeight - startHeight;
  if (total <= 0) return null;
  return clamp((currentHeight - startHeight) / total);
}

export function tipJarStatus(state: AppState): TipJarStatus {
  if (!tipJarOn(state)) return { visual: 'off', word: 'Off', spoken: 'off', progress: 0, live: false };
  if (!state.pubkey) return { visual: 'error', word: 'Sign in', spoken: 'unavailable', progress: 0, live: false };
  if (state.deviceVault !== 'unlocked') return { visual: 'connecting', word: 'Locked', spoken: 'locked', progress: 0, live: false };
  const wallet = state.moneroWallet ?? { status: 'unknown' as const };
  if (wallet.status === 'error') return { visual: 'error', word: 'Offline', spoken: 'unavailable', progress: 0, live: false };
  if (wallet.status === 'missing') return { visual: 'connecting', word: 'Not set up', spoken: 'not set up', progress: 0, live: false };
  if (wallet.status === 'syncing') {
    const progress = clamp(wallet.syncProgress ?? syncFraction(wallet.snapshot?.sync));
    // A percentage is only spoken once it is one: before scanning starts the saved position is a
    // hint, and reading it out as "100 percent" of a sync that has not begun would be a lie.
    const live = wallet.syncLive === true;
    return { visual: 'syncing', word: 'Syncing', spoken: live ? `syncing, ${Math.round(progress * 100)} percent` : 'syncing', progress, live };
  }
  if (wallet.status === 'ready' && wallet.snapshot?.sync?.synchronized) return { visual: 'ready', word: 'Ready', spoken: 'ready', progress: 1, live: false };
  return { visual: 'connecting', word: 'Connecting', spoken: 'connecting', progress: 0, live: false };
}
