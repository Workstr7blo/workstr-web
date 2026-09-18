// The rules for spending from the Tip Jar: when a send may start, what an amount means, which
// addresses are acceptable, and how a wallet error is put into words. Nothing here touches the
// wallet or the DOM.
//
// Amounts are atomic units in strings and BigInts end to end. A floating-point XMR value never
// exists, because 0.1 + 0.2 is not a number anyone should be paying.
import type { AppState } from '../../app/state';
import { tipJarOn } from './tip-jar-state';
import type { MoneroNetwork } from './types';

export const XMR_DECIMALS = 12;
const ATOMIC_PER_XMR = 10n ** BigInt(XMR_DECIMALS);

// The tip sheet's quick amounts, in atomic units: 0.001, 0.005 and 0.01 XMR.
export const TIP_PRESETS: ReadonlyArray<string> = ['1000000000', '5000000000', '10000000000'];

// Standard and subaddress prefixes per network, for 95-character addresses and 106-character
// integrated ones. A mainnet wallet must never be pointed at a stagenet address, or the reverse.
const PREFIXES: Record<MoneroNetwork, string> = { mainnet: '48', stagenet: '57', testnet: '9AB' };
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function moneroAddressFitsNetwork(value: string, network: MoneroNetwork): boolean {
  const address = value.trim();
  if (address.length !== 95 && address.length !== 106) return false;
  return PREFIXES[network].includes(address[0]) && BASE58.test(address);
}

// "0.005", "0,005", ".5" and "2" are amounts; anything with more than twelve decimals, a sign,
// an exponent or no value at all is not. Returns atomic units, or null.
export function parseXmrAmount(input: string): string | null {
  const text = input.trim().replace(',', '.');
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > XMR_DECIMALS) return null;
  const atomic = BigInt(match[1] || '0') * ATOMIC_PER_XMR + BigInt(fraction.padEnd(XMR_DECIMALS, '0') || '0');
  return atomic > 0n ? atomic.toString() : null;
}

// Every significant digit, for the confirmation screen: a fee rounded to six places could read
// as smaller than what is actually paid.
export function xmrExact(atomic: string | bigint): string {
  const value = BigInt(atomic);
  const whole = value / ATOMIC_PER_XMR;
  const fraction = (value % ATOMIC_PER_XMR).toString().padStart(XMR_DECIMALS, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} XMR`;
}

// The amount input's text for a preset, without the unit.
export function xmrInputText(atomic: string): string {
  return xmrExact(atomic).replace(/ XMR$/, '');
}

export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

export function shortTxid(txid: string): string {
  return txid.length > 12 ? `${txid.slice(0, 6)}…${txid.slice(-6)}` : txid;
}

export type SendReadiness =
  | { ok: true; availableAtomic: string; network: MoneroNetwork }
  | { ok: false; reason: string };

// A send needs a Tip Jar that is on, open, synchronized and holding spendable XMR. Anything
// less and the wallet cannot know which outputs are really its to spend.
export function sendReadiness(state: AppState): SendReadiness {
  if (!tipJarOn(state)) return { ok: false, reason: 'Turn on the Tip Jar to send from Workstr.' };
  if (!state.pubkey) return { ok: false, reason: 'Sign in to use your Tip Jar.' };
  if (state.deviceVault !== 'unlocked') return { ok: false, reason: 'Unlock Workstr to send from your Tip Jar.' };
  const wallet = state.moneroWallet;
  const snapshot = wallet?.snapshot;
  if (!snapshot || wallet?.status !== 'ready') return { ok: false, reason: 'Your Tip Jar is not open yet.' };
  if (!snapshot.sync?.synchronized) return { ok: false, reason: 'Your Tip Jar is still syncing. Sending is available once it has caught up.' };
  const available = snapshot.balance?.atomicUnlockedBalance ?? '0';
  if (BigInt(available) <= 0n) {
    return { ok: false, reason: BigInt(snapshot.balance?.atomicBalance ?? '0') > 0n
      ? 'Received XMR can be spent after 10 confirmations, about 20 minutes.'
      : 'Your Tip Jar is empty. Receive some XMR first.' };
  }
  return { ok: true, availableAtomic: available, network: snapshot.metadata.network };
}

// The wallet's own wording is for developers. These are the failures a person can act on.
export function sendErrorMessage(error: unknown, availableAtomic: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/not enough (unlocked )?money|insufficient/i.test(raw)) {
    return `Insufficient balance for this amount plus the network fee. Available: ${xmrExact(availableAtomic)}.`;
  }
  if (/invalid (destination )?address|address.*invalid/i.test(raw)) return 'That Monero address is not valid.';
  if (/node|daemon|network|fetch|timeout|connect/i.test(raw)) return 'The Monero node could not be reached. Try again in a moment.';
  const line = raw.split('\n')[0].trim().slice(0, 140);
  return line ? `The transaction could not be created (${line}).` : 'The transaction could not be created.';
}
