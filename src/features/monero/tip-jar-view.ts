import { html, shortMoneroAddress } from '../../app/format';
import { icon } from '../../app/icons';
import { moneroQr } from '../../app/monero-mark';
import type { AppState } from '../../app/state';
import { tipJarActivityCard, updateTipJarActivity } from './tip-jar-history-view';
import { tipJarNavLabel, tipJarOn, tipJarStatus, type TipJarStatus } from './tip-jar-state';
import { sendReadiness } from './wallet-send';
import { xmrAmount, moneroWalletBusy } from './wallet-view';

// The ring circumference is normalised with pathLength, so progress is a plain 0..100 offset.
function ringOffset(progress: number): string {
  return (100 - Math.round(progress * 100)).toString();
}

// The piggy bank is the Tip Jar, and the ring around it is live synchronization - nothing else.
// There is no Monero badge: a permanent payment mark in the navigation made the Tip Jar read as
// a Monero subsystem bolted onto Workstr rather than a part of it (#260). The ring is drawn
// behind the piggy bank, starts at twelve o'clock and fills clockwise, and is hidden by CSS
// once the wallet is ready, so only its offset changes while a sync runs. `data-live` says
// whether the arc is showing real scanning progress; until it is, CSS leaves the faint track.
export function tipJarNavIcon(status: TipJarStatus): string {
  return `<span class="tip-jar-icon" data-tip-jar="${status.visual}" data-live="${status.live ? 'on' : 'off'}">
    <svg class="tip-jar-progress" viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false">
      <circle class="tip-jar-ring-track" cx="14" cy="14" r="12.6"/>
      <circle class="tip-jar-ring" cx="14" cy="14" r="12.6" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${ringOffset(status.progress)}" transform="rotate(-90 14 14)"/>
    </svg>
    ${icon('piggy-bank', { class: 'tip-jar-piggy' })}
  </span><span class="tip-jar-label">${html(tipJarNavLabel(status.visual))}</span><span class="sr-only tip-jar-spoken">, ${html(status.spoken)}</span>`;
}

// Patched in place as the wallet moves, so a sync tick costs four attribute writes.
export function updateTipJarNav(root: ParentNode, state: AppState): void {
  const item = root.querySelector<HTMLElement>('.sidebar [data-view="tipjar"]');
  if (!item) return;
  const status = tipJarStatus(state);
  const icon = item.querySelector<HTMLElement>('.tip-jar-icon');
  if (icon && icon.dataset.tipJar !== status.visual) icon.dataset.tipJar = status.visual;
  const live = status.live ? 'on' : 'off';
  if (icon && icon.dataset.live !== live) icon.dataset.live = live;
  const ring = item.querySelector('.tip-jar-ring');
  const offset = ringOffset(status.progress);
  if (ring && ring.getAttribute('stroke-dashoffset') !== offset) ring.setAttribute('stroke-dashoffset', offset);
  const label = item.querySelector('.tip-jar-label');
  const word = tipJarNavLabel(status.visual);
  if (label && label.textContent !== word) label.textContent = word;
  const spoken = item.querySelector('.tip-jar-spoken');
  const text = `, ${status.spoken}`;
  if (spoken && spoken.textContent !== text) spoken.textContent = text;
}

function balanceText(state: AppState): string {
  const atomic = state.moneroWallet?.snapshot?.balance?.atomicBalance;
  return atomic ? xmrAmount(atomic) : '— XMR';
}

// The number is the subject and the unit is a label for it, so the unit is set smaller. The
// text still reads "0.024 XMR" as one string for anything that reads the element.
function balanceMarkup(state: AppState): string {
  const text = balanceText(state);
  const split = text.lastIndexOf(' ');
  return `${html(text.slice(0, split))}<span class="tip-jar-balance-unit">${html(text.slice(split))}</span>`;
}

// Received XMR needs ten confirmations before it can be spent, so for about twenty minutes the
// balance and what Send can use differ. Said plainly, or a greyed-out Send looks broken.
function balanceNote(state: AppState): string {
  const balance = state.moneroWallet?.snapshot?.balance;
  if (!balance) return '';
  const total = BigInt(balance.atomicBalance || '0');
  const unlocked = BigInt(balance.atomicUnlockedBalance || '0');
  if (total <= unlocked) return '';
  return `${xmrAmount((total - unlocked).toString())} is still confirming and can be sent in about 20 minutes.`;
}

// The page's own view of a running sync. The nav ring shows the same progress; here it gets a
// sentence, because the page is where someone waiting for Send to unlock is looking.
function syncMarkup(status: TipJarStatus): string {
  if (status.visual !== 'syncing' || !status.live) return '';
  const percent = Math.round(status.progress * 100);
  return `<div class="tip-jar-sync-bar" role="progressbar" aria-label="Tip Jar sync" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
    <p class="tip-jar-sync-text">Catching up with the Monero network, ${percent}%</p>`;
}

// Why Send is unavailable, under the button that cannot be pressed. Empty when it can.
function sendNote(state: AppState): string {
  const ready = sendReadiness(state);
  return ready.ok ? '' : ready.reason;
}

function noticeIcon(): string {
  return `<span class="tip-jar-notice-icon" aria-hidden="true">${icon('piggy-bank')}</span>`;
}

function offBody(): string {
  return `<div class="tip-jar-card tip-jar-empty tip-jar-notice">
    ${noticeIcon()}
    <div class="tip-jar-notice-copy">
      <p class="tip-jar-lead">Tip Jar is off</p>
      <p class="section-help">Turn it on to send and receive tips in Workstr. Tips are held in a Monero wallet on this device.</p>
    </div>
    <div class="web-empty-actions"><button id="tip-jar-enable" class="button primary" type="button">Enable Tip Jar</button></div>
  </div>`;
}

function notice(lead: string, help: string, actions = ''): string {
  return `<div class="tip-jar-card tip-jar-empty tip-jar-notice">
    ${noticeIcon()}
    <div class="tip-jar-notice-copy">
      <p class="tip-jar-lead">${html(lead)}</p>
      <p class="section-help">${html(help)}</p>
    </div>
    ${actions ? `<div class="web-empty-actions">${actions}</div>` : ''}
  </div>`;
}

function missingWalletBody(state: AppState): string {
  const busy = state.moneroWallet ? moneroWalletBusy(state.moneroWallet.status) : false;
  if (state.moneroWallet?.legacyAvailable) {
    return notice('Use the Tip Jar saved on this device?', 'An earlier Workstr version saved one wallet for the whole device. Use it only if this account owns that wallet.',
      `<button id="monero-wallet-claim" class="button payment" type="button"${busy ? ' disabled' : ''}>Use for this account</button><button id="monero-wallet-claim-dismiss" class="button" type="button"${busy ? ' disabled' : ''}>Not now</button>`);
  }
  return notice('Set up your Tip Jar', 'Workstr creates a Monero wallet on this device to hold your tips. You can also restore one, or use another wallet, in Settings.',
    '<button id="tip-jar-create" class="button payment" type="button">Create Tip Jar</button><button class="button" type="button" data-view="settings">Open Settings</button>');
}

function walletBody(state: AppState, status: TipJarStatus): string {
  const wallet = state.moneroWallet;
  const snapshot = wallet?.snapshot;
  const address = snapshot?.metadata.creatorSubaddress || wallet?.addresses?.[0] || '';
  const uri = `monero:${address}`;
  // The code is the subject here, so the address underneath is one quiet line with its own copy
  // glyph, and both copy controls hand over the same full address (#268).
  const receive = address ? `<div class="tip-jar-receive-body" id="tip-jar-receive-panel" hidden>
        <p class="tip-jar-receive-title">Your Tip Jar address</p>
        <div class="support-monero-qr" role="img" aria-label="QR code for your Tip Jar address">${moneroQr(uri)}</div>
        <div class="tip-jar-address-row">
          <code class="tip-jar-address" aria-hidden="true">${html(shortMoneroAddress(address))}</code>
          <span class="sr-only">Your Tip Jar address: ${html(address)}</span>
          <button class="tip-jar-address-copy" type="button" data-tip-jar-copy data-address="${html(address)}" aria-label="Copy your full Tip Jar address">
            ${icon('copy')}
          </button>
        </div>
        <div class="web-empty-actions"><button id="tip-jar-copy" class="button payment" type="button" data-tip-jar-copy data-address="${html(address)}">${icon('copy')}<span>Copy address</span></button></div>
        <p class="section-help">Scan with any Monero wallet.</p>
      </div>` : '';
  const note = balanceNote(state);
  const cannotSend = sendNote(state);
  return `<div class="tip-jar-card tip-jar-wallet">
    <div class="tip-jar-wallet-head">
      <span class="tip-jar-wallet-label">${icon('piggy-bank')}<span>Balance</span></span>
      <span class="tip-jar-status" id="tip-jar-status" data-tip-jar="${status.visual}">${html(status.word)}</span>
    </div>
    <div class="tip-jar-balance" id="tip-jar-balance">${balanceMarkup(state)}</div>
    <p class="tip-jar-balance-note" id="tip-jar-balance-note"${note ? '' : ' hidden'}>${html(note)}</p>
    <div class="tip-jar-sync" id="tip-jar-sync">${syncMarkup(status)}</div>
    <div class="tip-jar-actions">
      <button id="tip-jar-receive" class="button payment" type="button" aria-expanded="false" aria-controls="tip-jar-receive-panel"${address ? '' : ' disabled'}>${icon('arrow-down-left')}<span>Receive</span>${icon('chevron-down', { class: 'tip-jar-receive-chevron' })}</button>
      <button id="tip-jar-send" class="button payment" type="button" aria-describedby="tip-jar-send-note"${cannotSend ? ' disabled' : ''}>${icon('arrow-up-right')}<span>Send</span></button>
    </div>
    <p class="tip-jar-send-note" id="tip-jar-send-note"${cannotSend ? '' : ' hidden'}>${html(cannotSend)}</p>
    ${receive}
  </div>
  ${tipJarActivityCard(state)}`;
}

// Which layout the page has. A repaint within the same phase only patches text, so an open
// Receive panel survives every sync tick.
export function tipJarPhase(state: AppState): string {
  if (!tipJarOn(state)) return 'off';
  if (!state.pubkey) return 'signed-out';
  if (state.deviceVault !== 'unlocked') return 'locked';
  const wallet = state.moneroWallet;
  if (wallet?.status === 'missing' || (wallet?.stored === false && !wallet.snapshot)) return wallet?.legacyAvailable ? 'missing:legacy' : 'missing';
  if (wallet?.stored || wallet?.snapshot) return `wallet:${wallet.snapshot?.metadata.creatorSubaddress || wallet.addresses?.[0] || ''}`;
  return 'checking';
}

export function tipJarBody(state: AppState): string {
  const status = tipJarStatus(state);
  switch (tipJarPhase(state).split(':')[0]) {
    case 'off': return offBody();
    case 'signed-out': return notice('Sign in to use your Tip Jar.', 'Your Tip Jar belongs to your Nostr account.', '<button class="button primary" type="button" data-view="settings">Open Settings</button>');
    case 'locked': return notice('Unlock Workstr to open your Tip Jar.', 'Your Tip Jar is kept in this device\'s protected vault.');
    case 'missing': return missingWalletBody(state);
    case 'wallet': return walletBody(state, status);
    default: return notice('Getting your Tip Jar ready…', 'This only takes a moment.');
  }
}

export function tipJarView(state: AppState): string {
  return `<div class="page active" id="page-tipjar">
    <div class="page-title">Tip Jar</div>
    <div id="tip-jar-body" data-phase="${html(tipJarPhase(state))}">${tipJarBody(state)}</div>
  </div>`;
}

const paintedSync = new WeakMap<Element, string>();

// In-place patch for the parts that move with a sync: balance, status word and activity.
export function updateTipJarPage(root: ParentNode, state: AppState): void {
  const body = root.querySelector<HTMLElement>('#tip-jar-body');
  if (!body) return;
  const phase = tipJarPhase(state);
  if (body.dataset.phase !== phase) {
    body.dataset.phase = phase;
    body.innerHTML = tipJarBody(state);
    return;
  }
  const status = tipJarStatus(state);
  const balanceEl = body.querySelector('#tip-jar-balance');
  const balance = balanceMarkup(state);
  if (balanceEl && balanceEl.innerHTML !== balance) balanceEl.innerHTML = balance;
  const statusEl = body.querySelector<HTMLElement>('#tip-jar-status');
  if (statusEl && statusEl.textContent !== status.word) { statusEl.textContent = status.word; statusEl.dataset.tipJar = status.visual; }
  const note = balanceNote(state);
  const noteEl = body.querySelector<HTMLElement>('#tip-jar-balance-note');
  if (noteEl && noteEl.textContent !== note) { noteEl.textContent = note; noteEl.hidden = !note; }
  const syncEl = body.querySelector<HTMLElement>('#tip-jar-sync');
  const sync = syncMarkup(status);
  if (syncEl && paintedSync.get(syncEl) !== sync) { paintedSync.set(syncEl, sync); syncEl.innerHTML = sync; }
  const send = body.querySelector<HTMLButtonElement>('#tip-jar-send');
  const cannotSend = sendNote(state);
  if (send && send.disabled !== Boolean(cannotSend)) send.disabled = Boolean(cannotSend);
  const sendNoteEl = body.querySelector<HTMLElement>('#tip-jar-send-note');
  if (sendNoteEl && sendNoteEl.textContent !== cannotSend) { sendNoteEl.textContent = cannotSend; sendNoteEl.hidden = !cannotSend; }
  updateTipJarActivity(body, state);
}
