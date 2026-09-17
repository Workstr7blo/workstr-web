import { html } from '../../app/format';
import { moneroQr } from '../../app/monero-mark';
import type { AppState } from '../../app/state';
import { tipJarNavLabel, tipJarOn, tipJarStatus, type TipJarStatus } from './tip-jar-state';
import { xmrAmount } from './wallet-view';

// Outline piggy bank in the nav icon language: 24px box, stroke drawn in currentColor.
const PIGGY_BANK = '<path d="M19 11.5c0-3.6-3.1-6.5-7-6.5-1.1 0-2.1.2-3 .6L6.5 4v3.3A6.2 6.2 0 0 0 5.1 10H3v3.5h2.2c.5 1.1 1.3 2.1 2.3 2.8V19.5h3v-1.8h2.8v1.8h3v-3.2c1.7-1.2 2.7-3 2.7-4.8z"/><path d="M10 8h3.5"/><path d="M15.5 10.5h.01"/>';

// The ring circumference is normalised with pathLength, so progress is a plain 0..100 offset.
function ringOffset(progress: number): string {
  return (100 - Math.round(progress * 100)).toString();
}

// The piggy bank is the Tip Jar, and the ring around it is live synchronization - nothing else.
// There is no Monero badge: a permanent payment mark in the navigation made the Tip Jar read as
// a Monero subsystem bolted onto Workstr rather than a part of it (#260). The ring is drawn
// behind the piggy bank, starts at twelve o'clock and fills clockwise, and is hidden by CSS
// once the wallet is ready, so only its offset changes while a sync runs.
export function tipJarNavIcon(status: TipJarStatus): string {
  return `<span class="tip-jar-icon" data-tip-jar="${status.visual}">
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

function row(label: string, value: string, extra = ''): string {
  return `<div class="tip-jar-row"><span>${html(label)}</span><strong>${value}</strong>${extra}</div>`;
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

// Whether tips published for this account arrive in this Tip Jar.
function receivingRow(state: AppState, walletAddress: string): string {
  const published = state.monero.address;
  if (state.monero.status === 'idle' || state.monero.status === 'loading') return row('Receiving tips', 'Checking…');
  if (state.monero.status === 'saving') return row('Receiving tips', 'Publishing…');
  if (published && published === walletAddress) return row('Receiving tips', 'Enabled');
  if (published) return row('Receiving tips', 'Another wallet', '<small>Tips go to an address from another wallet. Change it in Settings.</small>');
  return row('Receiving tips', 'Off', `<button id="tip-jar-publish" class="button payment" type="button">Receive tips here</button>`);
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
      <button id="tip-jar-send" class="button" type="button" disabled aria-describedby="tip-jar-send-note">Send</button>
    </div>
    <p class="section-help" id="tip-jar-send-note">Sending XMR from the Tip Jar is not available yet.</p>
    ${receive}
  </div>
  <div class="tip-jar-card tip-jar-rows">
    ${receivingRow(state, address)}
    ${row('Backup', 'Recovery phrase', '<button class="button" type="button" data-view="settings">Open Settings</button>')}
  </div>`;
}

// Which layout the page has. A repaint within the same phase only patches text, so an open
// Receive panel survives every sync tick.
export function tipJarPhase(state: AppState): string {
  if (!tipJarOn(state)) return 'off';
  if (!state.pubkey) return 'signed-out';
  if (state.deviceVault !== 'unlocked') return 'locked';
  const wallet = state.moneroWallet;
  if (wallet?.status === 'missing' || (wallet?.stored === false && !wallet.snapshot)) return 'missing';
  if (wallet?.stored || wallet?.snapshot) return `wallet:${wallet.snapshot?.metadata.creatorSubaddress || wallet.addresses?.[0] || ''}:${state.monero.status}:${state.monero.address}`;
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

// In-place patch for the parts that move with a sync: balance and status word.
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
}
