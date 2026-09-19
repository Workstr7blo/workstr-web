import { html } from '../../app/format';
import { moneroQr } from '../../app/monero-mark';
import type { AppState } from '../../app/state';
import { PIGGY_BANK, tipJarActivityCard, updateTipJarActivity } from './tip-jar-history-view';
import { tipJarNavLabel, tipJarOn, tipJarStatus, type TipJarStatus } from './tip-jar-state';
import { sendReadiness } from './wallet-send';
import { xmrAmount } from './wallet-view';

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
    <svg class="tip-jar-piggy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PIGGY_BANK}</svg>
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

function offBody(): string {
  return `<div class="tip-jar-card tip-jar-empty">
    <p class="tip-jar-lead">Tip Jar is off.</p>
    <p class="section-help">Turn it on to send and receive tips in Workstr.</p>
    <div class="web-empty-actions"><button id="tip-jar-enable" class="button primary" type="button">Enable Tip Jar</button></div>
  </div>`;
}

function notice(lead: string, help: string, actions = ''): string {
  return `<div class="tip-jar-card tip-jar-empty">
    <p class="tip-jar-lead">${html(lead)}</p>
    <p class="section-help">${html(help)}</p>
    ${actions ? `<div class="web-empty-actions">${actions}</div>` : ''}
  </div>`;
}

function walletBody(state: AppState, status: TipJarStatus): string {
  const wallet = state.moneroWallet;
  const snapshot = wallet?.snapshot;
  const address = snapshot?.metadata.creatorSubaddress || wallet?.addresses?.[0] || '';
  const uri = `monero:${address}`;
  const receive = address ? `<div class="tip-jar-receive-body" id="tip-jar-receive-panel" hidden>
        <div class="support-monero-qr" role="img" aria-label="QR code for your Tip Jar address">${moneroQr(uri)}</div>
        <code class="support-monero-address">${html(address)}</code>
        <div class="web-empty-actions"><button id="tip-jar-copy" class="button payment" type="button" data-address="${html(address)}">Copy address</button></div>
        <p class="section-help">Receive XMR to this address. Scan it with any Monero wallet.</p>
      </div>` : '';
  return `<div class="tip-jar-card">
    <div class="tip-jar-balance" id="tip-jar-balance">${html(balanceText(state))}</div>
    <div class="tip-jar-status" id="tip-jar-status" data-tip-jar="${status.visual}">${html(status.word)}</div>
    <div class="tip-jar-actions">
      <button id="tip-jar-receive" class="button payment" type="button" aria-expanded="false" aria-controls="tip-jar-receive-panel"${address ? '' : ' disabled'}>Receive</button>
      <button id="tip-jar-send" class="button payment" type="button"${sendReadiness(state).ok ? '' : ' disabled'}>Send</button>
    </div>
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
  if (wallet?.status === 'missing' || (wallet?.stored === false && !wallet.snapshot)) return 'missing';
  if (wallet?.stored || wallet?.snapshot) return `wallet:${wallet.snapshot?.metadata.creatorSubaddress || wallet.addresses?.[0] || ''}`;
  return 'checking';
}

export function tipJarBody(state: AppState): string {
  const status = tipJarStatus(state);
  switch (tipJarPhase(state).split(':')[0]) {
    case 'off': return offBody();
    case 'signed-out': return notice('Sign in to use your Tip Jar.', 'Your Tip Jar belongs to your Nostr account.', '<button class="button primary" type="button" data-view="settings">Open Settings</button>');
    case 'locked': return notice('Unlock Workstr to open your Tip Jar.', 'Your Tip Jar is kept in this device\'s protected vault.');
    case 'missing': return notice('Set up your Tip Jar.', state.moneroWallet?.legacyAvailable
      ? 'A Tip Jar wallet from an earlier version of Workstr is on this device. You can use it for this account in Settings.'
      : 'Workstr creates a Monero wallet on this device to hold your tips. You can also restore one, or use another wallet, in Settings.',
    '<button id="tip-jar-create" class="button payment" type="button">Create Tip Jar</button><button class="button" type="button" data-view="settings">Open Settings</button>');
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
  const balance = balanceText(state);
  if (balanceEl && balanceEl.textContent !== balance) balanceEl.textContent = balance;
  const statusEl = body.querySelector<HTMLElement>('#tip-jar-status');
  if (statusEl && statusEl.textContent !== status.word) { statusEl.textContent = status.word; statusEl.dataset.tipJar = status.visual; }
  const send = body.querySelector<HTMLButtonElement>('#tip-jar-send');
  const canSend = sendReadiness(state).ok;
  if (send && send.disabled === canSend) send.disabled = !canSend;
  updateTipJarActivity(body, state);
}
