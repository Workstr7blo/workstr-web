import { normalizePaymentMode } from '../core/types';
import { moneroMark } from '../features/sheets/monero-tip-view';
import { displayIdentity, html } from './format';
import type { AppState } from './state';

// Who is signed in reaches the screen in two places - the topbar chip and the Settings
// Account card - and a profile answers from a relay seconds after launch, long after the
// reader has settled somewhere. Rebuilding the root for it redrew the topbar, the
// navigation, every image and the current page to change a name and a picture. Both
// surfaces are written from this one adapter so the patched version cannot say something
// different from the rendered one.
export interface AccountIdentity {
  signedIn: boolean;
  label: string;
  initial: string;
  picture: string | null;
  monero: boolean;
}

export function accountIdentity(state: AppState): AccountIdentity {
  const label = displayIdentity(state);
  return {
    signedIn: Boolean(state.pubkey),
    label,
    initial: label.trim().slice(0, 1).toUpperCase() || 'W',
    picture: state.pubkey ? state.profilePicture || null : null,
    monero: normalizePaymentMode(state.settings.paymentMode) === 'monero'
  };
}

// The image must stay immediately before its fallback: the `onerror` handler reaches the
// fallback through `nextElementSibling`, so anything inserted between them turns a broken
// avatar into a blank hole. Emitting the pair from one place is what keeps that true for
// the topbar and Settings copies at once.
export function avatarFace(className: string, identity: AccountIdentity): string {
  if (!identity.picture) return `<span class="${className} fallback">${html(identity.initial)}</span>`;
  return `<img class="${className}" src="${html(identity.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="${className} fallback" hidden>${html(identity.initial)}</span>`;
}

// The badge on the avatar answers "is my identity connected"; the medallion answers "which
// rail pays creators". Signed out, the rail is not actionable and the chip already carries
// a second line, so only the badge is dropped.
function badge(identity: AccountIdentity): string {
  return identity.signedIn ? '<span class="connection-identity-status" role="img" aria-label="Signed in"></span>' : '';
}

function paymentMark(identity: AccountIdentity): string {
  if (!identity.signedIn) return '';
  const label = identity.monero ? 'Monero payments' : 'Lightning payments';
  return `<span class="connection-payment-mark" role="img" aria-label="${label}" title="${identity.monero ? 'Monero' : 'Lightning'} payment mode">${identity.monero ? moneroMark(13) : '₿'}</span>`;
}

function chipStatus(identity: AccountIdentity): string {
  return identity.signedIn
    ? ''
    : '<span class="connection-chip-status"><span class="connection-dot"></span><span class="connection-chip-text">Local</span></span>';
}

export function accountChip(identity: AccountIdentity): string {
  return `<button class="connection-chip ${identity.signedIn ? 'ok' : ''}" id="account-chip" type="button" title="Open settings" aria-label="Open settings">
          <span class="connection-avatar-wrap">${avatarFace('connection-avatar', identity)}${badge(identity)}</span>
          <span class="connection-chip-main">
            <span class="connection-chip-label">${identity.signedIn ? html(identity.label) : 'Account'}</span>
            ${chipStatus(identity)}
          </span>
          ${paymentMark(identity)}
          <svg class="connection-chip-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
}

// Writes the arrived profile into both surfaces without recreating either. Reports whether
// the chip was there to write to; nothing else in the app decides anything from that, it
// is how a caller can tell a silent state update from a visible one.
export function updateAccountIdentity(root: ParentNode, identity: AccountIdentity): boolean {
  const chip = root.querySelector<HTMLElement>('#account-chip');
  if (!chip) return false;
  chip.classList.toggle('ok', identity.signedIn);
  patchAvatar(chip.querySelector('.connection-avatar-wrap'), 'connection-avatar', identity, badge(identity));
  const label = chip.querySelector('.connection-chip-label');
  if (label) label.textContent = identity.signedIn ? identity.label : 'Account';
  patchChipExtras(chip, identity);
  patchSettingsAccount(root, identity);
  return true;
}

// A live <img> is never replaced while it is still showing the same picture: a fresh one is
// a fresh fetch and a visible redraw, which is the whole of what this change removes. Only
// the shape - a picture arriving where there was none, or going - rebuilds the wrap, and
// then from `avatarFace` so the fallback contract survives.
function patchAvatar(wrap: Element | null, className: string, identity: AccountIdentity, trailing = ''): void {
  if (!wrap) return;
  const image = wrap.querySelector<HTMLImageElement>(`img.${className}`);
  const fallback = wrap.querySelector<HTMLElement>(`.${className}.fallback`);
  const mountedBadge = wrap.querySelector('.connection-identity-status');
  if (Boolean(identity.picture) !== Boolean(image) || Boolean(mountedBadge) !== Boolean(trailing)) {
    // The face is replaced where it stands rather than by rewriting the container: in the
    // Settings card the avatar shares its parent with the name and the key line, and those
    // are not this function's to throw away.
    const anchor = image || fallback;
    if (!anchor) return;
    anchor.insertAdjacentHTML('beforebegin', avatarFace(className, identity) + trailing);
    image?.remove();
    fallback?.remove();
    mountedBadge?.remove();
    return;
  }
  if (fallback) fallback.textContent = identity.initial;
  if (!image || !identity.picture || image.getAttribute('src') === identity.picture) return;
  image.setAttribute('src', identity.picture);
  // A previous picture that failed to load left the pair swapped over. The new one has not
  // failed yet, so it gets its turn.
  image.hidden = false;
  if (fallback) fallback.hidden = true;
}

function patchChipExtras(chip: HTMLElement, identity: AccountIdentity): void {
  const status = chip.querySelector('.connection-chip-status');
  const main = chip.querySelector('.connection-chip-main');
  if (identity.signedIn && status) status.remove();
  else if (!identity.signedIn && !status && main) main.insertAdjacentHTML('beforeend', chipStatus(identity));
  const mark = chip.querySelector('.connection-payment-mark');
  const wanted = paymentMark(identity);
  if (!wanted) mark?.remove();
  else if (mark) mark.outerHTML = wanted;
  else chip.querySelector('.connection-chip-chevron')?.insertAdjacentHTML('beforebegin', wanted);
}

// The Settings Account card shows the same name and picture. It is a page away from the
// chip, so a reader on Settings would otherwise watch the topbar update and the card it is
// actually looking at stay stale until something else redrew it.
function patchSettingsAccount(root: ParentNode, identity: AccountIdentity): void {
  const card = root.querySelector('.account-card');
  if (!card) return;
  const summary = card.querySelector(':scope > summary .settings-category-copy small');
  if (summary) summary.textContent = identity.signedIn ? `Signed in · ${identity.label}` : 'Local only';
  const row = card.querySelector('.settings-account-identity');
  if (!row || !identity.signedIn) return;
  patchAvatar(row, 'settings-account-avatar', identity);
  const name = row.querySelector('strong');
  if (name) name.textContent = identity.label;
}
