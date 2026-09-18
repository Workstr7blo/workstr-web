import { moneroSendBody, moneroSendSheet } from '../features/monero/send-view';
import type { OutgoingTipInput } from '../features/monero/tip-jar-history';
import type { MoneroPreparedTransfer, MoneroSendRecipient, MoneroSendState } from '../features/monero/types';
import { moneroAddressFitsNetwork, parseXmrAmount, sendErrorMessage, sendReadiness, xmrExact } from '../features/monero/wallet-send';
import type { AppState } from './state';

export interface MoneroSendControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  closeModal(): void;
  wallet: {
    prepareTransfer(request: { address: string; amountAtomic: string }): Promise<MoneroPreparedTransfer>;
    relayTransfer(prepared: MoneroPreparedTransfer): Promise<string>;
  };
  activity: { recordOutgoing(input: Omit<OutgoingTipInput, 'now'>): Promise<void> };
  // A send changed the balance and the transaction list: bring the Tip Jar up to date.
  afterSend(): void;
}

const UNCERTAIN = 'Workstr could not confirm that the node accepted this transfer. It may still go through: check Recent activity after the next sync before sending again.';

/**
 * Sending from the Tip Jar, whether a creator tip from a program card or a plain send from the
 * Tip Jar page. The transfer is built and signed on this device, shown with its real fee, and
 * broadcast only after an explicit confirm. The node receives the signed transaction and
 * nothing else; the seed and spend key never leave the wallet runtime.
 */
export function createMoneroSendController(ctx: MoneroSendControllerContext) {
  const { root, state, toast } = ctx;
  let current: MoneroSendState | null = null;
  let nextId = 1;

  function available(): string {
    const ready = sendReadiness(state);
    return ready.ok ? ready.availableAtomic : state.moneroWallet?.snapshot?.balance?.atomicUnlockedBalance ?? '0';
  }

  // Writes the step into this sheet only. If the modal was closed, or another sheet replaced
  // it, there is nothing to paint and the caller falls back to a toast.
  function paint(): boolean {
    if (!current) return false;
    const host = root.querySelector<HTMLElement>(`#monero-send[data-send-id="${current.id}"]`);
    if (!host) return false;
    host.innerHTML = moneroSendBody(current, available());
    return true;
  }

  function update(next: Partial<MoneroSendState>): boolean {
    if (!current) return false;
    current = { ...current, ...next };
    return paint();
  }

  function focusField(): void {
    const field = root.querySelector<HTMLElement>('#monero-send-address') ?? root.querySelector<HTMLElement>('#monero-send-amount');
    field?.focus();
  }

  function open(recipient: MoneroSendRecipient | null): boolean {
    if (current?.step === 'sending') { toast('A send is still in progress', 'bad'); return true; }
    current = { id: nextId++, step: 'amount', recipient, amountText: '', addressText: '' };
    ctx.openModal(moneroSendSheet(current, available()));
    focusField();
    return true;
  }

  function readFields(): void {
    if (!current) return;
    const amount = root.querySelector<HTMLInputElement>('#monero-send-amount');
    const address = root.querySelector<HTMLTextAreaElement>('#monero-send-address');
    current = { ...current, amountText: amount?.value ?? current.amountText, addressText: address?.value.trim() ?? current.addressText };
  }

  async function review(): Promise<void> {
    if (!current || current.step !== 'amount') return;
    readFields();
    const ready = sendReadiness(state);
    if (!ready.ok) { update({ error: ready.reason }); return; }
    const address = (current.recipient?.address ?? current.addressText).trim();
    if (!moneroAddressFitsNetwork(address, ready.network)) {
      update({ error: current.recipient ? 'This creator\'s Monero address is not valid for your Tip Jar\'s network.' : 'Enter a valid Monero address.' });
      return;
    }
    const amountAtomic = parseXmrAmount(current.amountText);
    if (!amountAtomic) { update({ error: 'Enter an amount in XMR, for example 0.005.' }); return; }
    if (BigInt(amountAtomic) > BigInt(ready.availableAtomic)) {
      update({ error: `Insufficient balance. Available: ${xmrExact(ready.availableAtomic)}.` });
      return;
    }
    const id = current.id;
    update({ step: 'preparing', error: undefined });
    let prepared: MoneroPreparedTransfer;
    try {
      prepared = await ctx.wallet.prepareTransfer({ address, amountAtomic });
    } catch (error) {
      if (current?.id === id) update({ step: 'amount', error: sendErrorMessage(error, ready.availableAtomic) });
      return;
    }
    if (current?.id !== id) return;
    const total = BigInt(prepared.amountAtomic) + BigInt(prepared.feeAtomic);
    if (total > BigInt(ready.availableAtomic)) {
      update({ step: 'amount', error: `Insufficient balance. Available: ${xmrExact(ready.availableAtomic)}. Required with the network fee: ${xmrExact(total)}.` });
      return;
    }
    update({ step: 'review', prepared });
  }

  // Runs once per prepared transfer. There is no automatic retry anywhere below: a second
  // broadcast of a new transaction after an unclear failure could pay twice.
  async function confirm(): Promise<void> {
    if (!current || current.step !== 'review' || !current.prepared) return;
    const sheet = current;
    const prepared = sheet.prepared as MoneroPreparedTransfer;
    const tip = Boolean(sheet.recipient?.pubkey);
    update({ step: 'sending', error: undefined });
    let txid: string;
    try {
      txid = await ctx.wallet.relayTransfer(prepared);
    } catch {
      const shown = current?.id === sheet.id && update({ step: 'failed', uncertain: true, error: UNCERTAIN });
      if (!shown) toast('Send not confirmed. Check Recent activity before sending again.', 'bad');
      ctx.afterSend();
      return;
    }
    // Broadcast succeeded, so this is now true to record: who it was for, and why.
    await ctx.activity.recordOutgoing({
      txid,
      amountAtomic: prepared.amountAtomic,
      feeAtomic: prepared.feeAtomic,
      recipientAddress: prepared.address,
      recipientPubkey: sheet.recipient?.pubkey,
      program: sheet.recipient?.pubkey ? { address: sheet.recipient.programAddress, name: sheet.recipient.programName } : undefined
    }).catch(() => undefined);
    const shown = current?.id === sheet.id && update({ step: 'sent', txid });
    if (!shown) toast(tip ? 'Tip sent' : 'Sent');
    ctx.afterSend();
  }

  function back(): void {
    if (!current || current.step === 'sending' || current.uncertain) return;
    update({ step: 'amount', prepared: undefined, error: undefined });
    focusField();
  }

  function close(): void {
    // A send in flight keeps its state so its result can still be reported.
    if (current?.step !== 'sending') current = null;
    ctx.closeModal();
  }

  root.addEventListener('submit', (event) => {
    if ((event.target as HTMLElement).id !== 'monero-send-form') return;
    event.preventDefault();
    void review();
  });

  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('#monero-send button');
    if (!target) return;
    const preset = target.dataset.sendPreset;
    if (preset !== undefined) {
      const input = root.querySelector<HTMLInputElement>('#monero-send-amount');
      if (input) input.value = preset;
      root.querySelectorAll<HTMLElement>('[data-send-preset]').forEach((button) => button.setAttribute('aria-pressed', String(button === target)));
      if (current) current = { ...current, amountText: preset, error: undefined };
      return;
    }
    if (target.id === 'monero-send-copy') {
      void navigator.clipboard?.writeText(target.dataset.address || '').then(() => toast('Copied'), () => toast('Could not copy — select the address instead', 'bad'));
      return;
    }
    const action = target.dataset.sendAction;
    if (action === 'confirm') void confirm();
    else if (action === 'back') back();
    else if (action === 'close') close();
  });

  // Typing a custom amount clears the preset highlight, without repainting the field.
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'monero-send-amount' || !current) return;
    current = { ...current, amountText: input.value };
    root.querySelectorAll<HTMLElement>('[data-send-preset]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sendPreset === input.value.trim())));
  });

  return {
    // The Tip Jar page's Send: any address. Says why when the Tip Jar cannot send yet.
    openSend(): boolean {
      const ready = sendReadiness(state);
      if (!ready.ok) { toast(ready.reason, 'bad'); return false; }
      return open(null);
    },
    // A creator tip from a program card. Returns false when the Tip Jar cannot send, so the
    // caller can offer the address to pay from another wallet instead.
    openTip(recipient: MoneroSendRecipient): boolean {
      if (!sendReadiness(state).ok) return false;
      return open(recipient);
    },
    current: (): MoneroSendState | null => current
  };
}
