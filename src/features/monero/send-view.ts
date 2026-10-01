import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
import type { MoneroSendRecipient, MoneroSendState } from './types';
import { shortAddress, shortTxid, TIP_PRESETS, xmrExact, xmrInputText } from './wallet-send';
import { xmrAmount } from './wallet-view';

// The send sheet: amount, then an explicit review of amount, fee and total, then the result.
// Every step is written into `#monero-send` in place, so the modal never re-opens under the
// reader and the amount they are typing is never replaced by a repaint.

function isTip(state: MoneroSendState): boolean {
  return Boolean(state.recipient?.pubkey);
}

function recipientName(state: MoneroSendState): string {
  return state.recipient?.name || 'this address';
}

function recipientBlock(state: MoneroSendState): string {
  const recipient = state.recipient;
  if (!recipient) return '';
  const name = recipient.name || 'Monero address';
  const initial = html(name.trim().slice(0, 1).toUpperCase() || '?');
  const avatar = recipient.picture
    ? `<img src="${html(recipient.picture)}" alt="" referrerpolicy="no-referrer" data-fallback="replace" data-fallback-text="${initial}">`
    : `<span>${initial}</span>`;
  return `<div class="monero-send-recipient">
    <span class="monero-send-avatar" aria-hidden="true">${avatar}</span>
    <span class="monero-send-recipient-copy"><strong>${html(name)}</strong>${recipient.programName ? `<small>${html(recipient.programName)}</small>` : ''}</span>
  </div>`;
}

export interface MoneroTipStartView {
  id: number;
  recipient: MoneroSendRecipient;
  title: string;
  lead: string;
  help: string;
  detail?: string;
  primary?: { label: string; action: 'enable' | 'setup' | 'add-funds' | 'settings' | 'retry' };
  secondary?: { label: string; action: 'tipjar' | 'settings' | 'retry' };
}

function errorLine(state: MoneroSendState): string {
  return state.error ? `<p class="monero-send-error" role="alert">${icon('circle-alert')}<span>${html(state.error)}</span></p>` : '';
}

// `body` is markup: callers escape what they put in it.
function note(name: IconName, body: string, tone: 'info' | 'warn' = 'info'): string {
  return `<p class="monero-send-note ${tone}">${icon(name)}<span>${body}</span></p>`;
}

function labelled(name: IconName, label: string): string {
  return `${icon(name)}<span>${label}</span>`;
}

function amountStep(state: MoneroSendState, availableAtomic: string): string {
  const busy = state.step === 'preparing';
  const presets = isTip(state) ? `<div class="monero-send-presets" role="group" aria-label="Quick amounts">${TIP_PRESETS.map((atomic) => {
    const text = xmrInputText(atomic);
    return `<button class="button" type="button" data-send-preset="${html(text)}" aria-label="${html(xmrAmount(atomic))}" aria-pressed="${state.amountText === text}"${busy ? ' disabled' : ''}>${html(text)}</button>`;
  }).join('')}</div>` : '';
  const address = state.recipient ? '' : `<label class="monero-send-field">Monero address
      <textarea id="monero-send-address" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"${busy ? ' disabled' : ''}>${html(state.addressText)}</textarea>
    </label>`;
  return `<form id="monero-send-form" class="monero-send-form" novalidate>
    <p class="monero-send-available">${icon('wallet')}<span>Available <strong>${html(xmrExact(availableAtomic))}</strong></span></p>
    ${address}
    ${presets}
    <label class="monero-send-field">Amount
      <span class="monero-send-amount"><input id="monero-send-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.005" value="${html(state.amountText)}"${busy ? ' disabled' : ''}><span aria-hidden="true">XMR</span></span>
    </label>
    ${errorLine(state)}
    <div class="monero-send-actions">
      <button class="button" type="button" data-send-action="close"${busy ? ' disabled' : ''}>Cancel</button>
      <button class="button payment" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Calculating fee…' : labelled('arrow-right', 'Review')}</button>
    </div>
  </form>`;
}

function reviewRows(state: MoneroSendState): string {
  const prepared = state.prepared;
  if (!prepared) return '';
  const total = (BigInt(prepared.amountAtomic) + BigInt(prepared.feeAtomic)).toString();
  return `<dl class="monero-send-review">
    <div><dt>Send</dt><dd>${html(xmrExact(prepared.amountAtomic))}</dd></div>
    ${state.recipient?.name ? `<div><dt>To</dt><dd>${html(state.recipient.name)}</dd></div>` : ''}
    <div><dt>Address</dt><dd><code title="${html(prepared.address)}">${html(shortAddress(prepared.address))}</code></dd></div>
    <div><dt>Network fee</dt><dd>${html(xmrExact(prepared.feeAtomic))}</dd></div>
    <div class="monero-send-total"><dt>Total</dt><dd>${html(xmrExact(total))}</dd></div>
  </dl>`;
}

function reviewStep(state: MoneroSendState): string {
  const sending = state.step === 'sending';
  return `${reviewRows(state)}
    ${sending ? note('hourglass', 'Sending. Keep Workstr open until this finishes.') : note('triangle-alert', 'Signed on this device. A Monero transfer cannot be reversed once it is sent.', 'warn')}
    <div class="monero-send-actions">
      <button class="button" type="button" data-send-action="back"${sending ? ' disabled' : ''}>${labelled('arrow-left', 'Back')}</button>
      <button class="button payment" type="button" data-send-action="confirm"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : labelled('send', isTip(state) ? 'Send tip' : 'Send')}</button>
    </div>`;
}

function sentStep(state: MoneroSendState): string {
  const prepared = state.prepared;
  const amount = prepared ? xmrExact(prepared.amountAtomic) : '';
  const to = state.recipient?.name ? ` to ${state.recipient.name}` : '';
  return `<p class="monero-send-result ok" role="status">${icon('circle-check')}<span>${html(amount)} sent${html(to)}.</span></p>
    <div class="monero-send-txid"><span>Transaction</span><code title="${html(state.txid || '')}">${html(shortTxid(state.txid || ''))}</code></div>
    ${note('clock', 'It shows under Recent activity in your Tip Jar and is final once the network confirms it, usually within 20 minutes.')}
    <div class="monero-send-actions"><button class="button payment" type="button" data-send-action="close">${labelled('check', 'Done')}</button></div>`;
}

// Only a broadcast whose outcome is unknown ends here - a transfer that could not be built goes
// back to the amount. The node may have taken it, so there is no way to send it again from here.
function failedStep(state: MoneroSendState): string {
  return `<p class="monero-send-error" role="alert">${icon('circle-alert')}<span>${html(state.error || 'The transfer did not go through.')}</span></p>
    <div class="monero-send-actions"><button class="button payment" type="button" data-send-action="close">Close</button></div>`;
}

function headIcon(state: MoneroSendState): IconName {
  switch (state.step) {
    case 'review':
    case 'sending': return 'shield-check';
    case 'sent': return 'circle-check';
    case 'failed': return 'circle-alert';
    default: return isTip(state) ? 'piggy-bank' : 'send';
  }
}

function sheetHead(id: string, text: string, name: IconName): string {
  return `<div class="monero-send-head"><span class="monero-send-head-icon" aria-hidden="true">${icon(name)}</span><h2 class="page-title monero-send-title" id="${id}">${html(text)}</h2></div>`;
}

function title(state: MoneroSendState): string {
  const tip = isTip(state);
  switch (state.step) {
    case 'review':
    case 'sending': return tip ? 'Confirm Monero tip' : 'Confirm send';
    case 'sent': return tip ? 'Tip sent' : 'Sent';
    case 'failed': return 'Send not confirmed';
    default: return tip ? 'Tip with Monero' : 'Send Monero';
  }
}

export function moneroSendBody(state: MoneroSendState, availableAtomic: string): string {
  const step = state.step === 'amount' || state.step === 'preparing'
    ? amountStep(state, availableAtomic)
    : state.step === 'sent' ? sentStep(state)
    : state.step === 'failed' ? failedStep(state)
    : reviewStep(state);
  // The review names the recipient in its own To row, so the header block is not repeated there.
  const reviewing = state.step === 'review' || state.step === 'sending';
  return `${sheetHead('monero-send-title', title(state), headIcon(state))}
    ${reviewing ? '' : recipientBlock(state)}
    ${step}`;
}

export function moneroSendSheet(state: MoneroSendState, availableAtomic: string): string {
  return `<section class="monero-send" id="monero-send" data-send-id="${state.id}" aria-labelledby="monero-send-title">${moneroSendBody(state, availableAtomic)}</section>`;
}

function tipStartActions(view: MoneroTipStartView): string {
  const actions = [view.secondary, view.primary].filter(Boolean) as NonNullable<MoneroTipStartView['primary']>[];
  if (!actions.length) return '';
  return `<div class="monero-send-actions">${actions.map((action, index) => `<button class="button${index === actions.length - 1 ? ' payment' : ''}" type="button" data-tip-start-action="${action.action}">${html(action.label)}</button>`).join('')}</div>`;
}

export function moneroTipStartSheet(view: MoneroTipStartView): string {
  const headerState: MoneroSendState = { id: view.id, step: 'amount', recipient: view.recipient, amountText: '', addressText: '' };
  return `<section class="monero-send monero-tip-start" id="monero-tip-start" data-tip-start-id="${view.id}" aria-labelledby="monero-tip-start-title">
    ${sheetHead('monero-tip-start-title', view.title, 'piggy-bank')}
    ${recipientBlock(headerState)}
    <p class="monero-send-result" role="status">${html(view.lead)}</p>
    ${note('info', html(view.help))}
    ${view.detail ? `<p class="monero-send-available">${icon('wallet')}<span>${html(view.detail)}</span></p>` : ''}
    ${tipStartActions(view)}
  </section>`;
}
