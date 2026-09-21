import { displayIdentity, html } from './format';
import type { AppState } from './state';

// Who is signed in reaches the screen in two places - the topbar chip and the Settings
// Profile card - and a profile answers from a relay seconds after launch, long after the
// reader has settled somewhere. Rebuilding the root for it redrew the topbar, the
// navigation, every image and the current page to change a name and a picture. Both
// surfaces are written from this one adapter so the patched version cannot say something
// different from the rendered one.
export interface AccountIdentity {
  signedIn: boolean;
  label: string;
  initial: string;
  picture: string | null;
}

export function accountIdentity(state: AppState): AccountIdentity {
  const label = displayIdentity(state);
  return {
    signedIn: Boolean(state.pubkey),
    label,
    initial: label.trim().slice(0, 1).toUpperCase() || 'W',
    picture: state.pubkey ? state.profilePicture || null : null
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

// The badge on the avatar answers "is my identity connected", and that is the only state the
// chip carries. Whether the Tip Jar is on is the bottom navigation's to say (#260): a second
// permanent mark up here made the app read as a Monero product rather than a Workstr one.
function badge(identity: AccountIdentity): string {
  return identity.signedIn ? '<span class="connection-identity-status" role="img" aria-label="Signed in"></span>' : '';
}

function chipStatus(identity: AccountIdentity): string {
  return identity.signedIn
    ? ''
    : '<span class="connection-chip-status"><span class="connection-dot"></span><span class="connection-chip-text">Local</span></span>';
}

function settingsGlyph(): string {
  return '<svg class="connection-chip-settings" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V22a2 2 0 01-4 0v-.09A1.65 1.65 0 009 20.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 16a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.17a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 3.6a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09A1.65 1.65 0 0015 3.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 10c.28.62.9 1 1.58 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
}

export function accountChip(identity: AccountIdentity): string {
  return `<button class="connection-chip ${identity.signedIn ? 'ok' : ''}" id="account-chip" type="button" title="Open settings" aria-label="Open settings">
          <span class="connection-avatar-wrap">${avatarFace('connection-avatar', identity)}${badge(identity)}</span>
          <span class="connection-chip-main">
            <span class="connection-chip-label">${identity.signedIn ? html(identity.label) : 'Account'}</span>
            ${chipStatus(identity)}
          </span>
          ${settingsGlyph()}
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
  patchSettingsProfile(root, identity);
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
}

// The Settings Profile card shows the same name and picture. It is a page away from the
// chip, so a reader on Settings would otherwise watch the topbar update and the card it is
// actually looking at stay stale until something else redrew it. Only the read-only card is
// written: an open editor holds a draft, and a profile arriving must not overwrite it.
function patchSettingsProfile(root: ParentNode, identity: AccountIdentity): void {
  const card = root.querySelector('.profile-card[data-profile-mode="view"]');
  if (!card || !identity.signedIn) return;
  patchAvatar(card.querySelector('.profile-avatar-wrap'), 'profile-avatar', identity);
  const name = card.querySelector('.profile-name');
  if (name) name.textContent = identity.label;
}
