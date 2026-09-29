import { nip19 } from 'nostr-tools';
import type { AppState } from './state';
import { accountIdentity, avatarFace } from './account-chip';
import { displayIdentity, displayNpub, html, shortMoneroAddress } from './format';
import { icon } from './icons';
import { anyProfileDirty, isSafeAvatarUrl, normalizeProfileField, type ProfileEditorState } from './profile-editor';

// The Settings Profile card: who the reader is to everyone else on Nostr. Rendering only -
// `profile-controller.ts` owns the draft, the uploads and every publish, and repaints this
// card in place so a result never closes the editor it is reported in.
//
// Normal mode is read-only on purpose. The avatar there is a picture, not a hidden button:
// editing starts from a visible, labelled Edit profile action and nowhere else.
const PENCIL = icon('pencil', { size: 16 });
const CAMERA = icon('camera', { size: 16 });
const COPY = icon('copy', { size: 16 });

// Refresh is rare and never the reason someone opened the card, so it is an icon in the
// card's corner in both modes rather than a button the size of Edit profile. The name stays
// in the markup for assistive technology and as a tooltip.
function refreshButton(disabled: boolean): string {
  return `<button id="profile-refresh" class="button quiet profile-icon-button" type="button" title="Refresh profile"${disabled ? ' disabled' : ''}>${icon('refresh-cw')}<span class="sr-only">Refresh profile</span></button>`;
}

function fullNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey); } catch { return pubkey; }
}

function addressSummary(state: AppState): string {
  const monero = state.monero;
  if (monero.address) return html(shortMoneroAddress(monero.address));
  if (monero.status === 'loading' || monero.status === 'idle') return 'Loading…';
  if (monero.status === 'error') return 'Could not be loaded';
  return 'Not set';
}

function busyMessage(profile: ProfileEditorState, state: AppState): string {
  if (profile.uploading) return 'Uploading photo…';
  if (profile.saving) return 'Saving profile…';
  if (profile.status === 'loading' || state.monero.status === 'loading') return 'Loading profile…';
  return '';
}

// One live region per card. Errors are worded as errors and marked with a text prefix, so
// they do not depend on the colour they are also given.
function statusLine(profile: ProfileEditorState, state: AppState): string {
  const busy = busyMessage(profile, state);
  const text = busy || profile.message || '';
  const bad = !busy && profile.messageKind === 'bad';
  return `<p class="profile-status${bad ? ' bad' : profile.messageKind === 'ok' && !busy ? ' ok' : ''}" id="profile-status" role="status" aria-live="polite">${bad ? '<span class="profile-status-mark">Error: </span>' : ''}${html(text)}</p>`;
}

function localProfile(): string {
  return `<div class="profile-card-body">
      <div class="profile-copy"><strong id="profile-card-title">Local only</strong><small>No public Nostr profile is connected. Your training stays on this device.</small></div>
      <div class="profile-actions"><button id="sign-in-settings" class="button primary" type="button">Create or restore account</button></div>
    </div>`;
}

function viewProfile(state: AppState): string {
  const profile = state.profile;
  const busy = Boolean(busyMessage(profile, state));
  const name = displayIdentity(state);
  const npub = displayNpub(state.pubkey || '');
  // With no display name the title already is the npub; printing it a second time under
  // itself reads as a rendering fault, not as information.
  const npubLine = name === npub ? '' : `<small class="profile-npub">${html(npub)}</small>`;
  return `<div class="profile-card-body">
      <div class="profile-identity">
        <span class="profile-avatar-wrap">${avatarFace('profile-avatar', accountIdentity(state))}</span>
        <span class="profile-copy">
          <strong class="profile-name" id="profile-card-title">${html(name)}</strong>
          ${npubLine}
        </span>
        ${refreshButton(busy)}
      </div>
      <dl class="profile-facts"><div><dt>Monero address</dt><dd class="profile-address">${addressSummary(state)}</dd></div></dl>
      ${statusLine(profile, state)}
      <div class="profile-actions">
        <button id="profile-edit" class="button" type="button"${profile.status === 'loading' || state.monero.status === 'loading' ? ' disabled' : ''}>${PENCIL}<span>Edit profile</span></button>
      </div>
    </div>`;
}

export function photoPreview(state: AppState, picture: string): string {
  const initial = accountIdentity(state).initial;
  const face = picture && isSafeAvatarUrl(picture)
    ? `<img class="profile-photo-image" src="${html(picture)}" alt="Profile photo preview" referrerpolicy="no-referrer" data-fallback="next"><span class="profile-photo-image fallback" hidden>${html(initial)}</span>`
    : `<span class="profile-photo-image fallback" role="img" aria-label="No profile photo">${html(initial)}</span>`;
  return `${face}<span class="profile-photo-badge" aria-hidden="true">${CAMERA}</span>`;
}

function editProfile(state: AppState, advancedOpen: boolean): string {
  const profile = state.profile;
  const draft = profile.draft || { displayName: '', picture: '', address: '' };
  const busy = Boolean(profile.uploading || profile.saving);
  const disabled = busy ? ' disabled' : '';
  const canSave = anyProfileDirty(profile) && !busy && profile.status !== 'loading';
  const npub = fullNpub(state.pubkey || '');
  const confirm = profile.confirmRefresh
    ? `<div class="profile-confirm" role="alertdialog" aria-labelledby="profile-confirm-text">
        <p id="profile-confirm-text">Refreshing discards your unsaved changes.</p>
        <div class="profile-form-actions"><button id="profile-refresh-confirm" class="button danger" type="button">Discard and refresh</button><button id="profile-refresh-keep" class="button" type="button">Keep editing</button></div>
      </div>`
    : '';
  // The photo is changed from the photo itself: one target, marked with a camera, instead of
  // the picture and a Change photo button beside it doing the same thing.
  return `<form class="profile-card-body profile-form" id="profile-form" novalidate>
      <div class="profile-photo">
        <button id="profile-photo-button" class="profile-photo-button" type="button" aria-label="Change photo"${disabled}>${photoPreview(state, normalizeProfileField(draft.picture))}</button>
        <span class="profile-photo-copy"><strong>Profile photo</strong><small>${profile.uploading ? 'Uploading…' : 'Tap the photo to choose a new one.'}</small></span>
        ${refreshButton(busy)}
        <input id="profile-photo-input" type="file" accept="image/*" hidden />
      </div>
      <label class="profile-field"><span>Display name</span>
        <input id="profile-display-name" type="text" autocomplete="nickname" maxlength="80" value="${html(draft.displayName)}"${profile.saving ? ' disabled' : ''} />
      </label>
      <div class="profile-field"><span id="profile-npub-label">npub</span>
        <div class="profile-npub-row"><code class="profile-npub-full" aria-labelledby="profile-npub-label">${html(npub)}</code><button id="profile-copy-npub" class="button quiet profile-icon-button" type="button" title="Copy npub" data-npub="${html(npub)}">${COPY}<span class="sr-only">Copy</span></button></div>
      </div>
      <label class="profile-field"><span>Monero payment address</span>
        <input id="profile-address" class="profile-address-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Starts with 4 or 8" value="${html(draft.address)}"${profile.saving ? ' disabled' : ''} />
        <small>Leave it empty and save to remove your address.</small>
      </label>
      <div class="profile-advanced">
        <button id="profile-advanced-toggle" class="profile-advanced-toggle" type="button" aria-expanded="${advancedOpen}" aria-controls="profile-advanced-panel">${icon('link')}<span class="settings-row-copy"><strong>Photo from a link</strong><small>Use an image you host yourself</small></span><span class="settings-category-chevron" aria-hidden="true">${icon('chevron-down')}</span></button>
        <div id="profile-advanced-panel" class="profile-advanced-panel"${advancedOpen ? '' : ' hidden'}>
          <label class="profile-field"><span>Image URL</span>
            <input id="profile-avatar-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" value="${html(draft.picture)}"${disabled} />
            <small>A direct https:// link to an image.</small>
          </label>
        </div>
      </div>
      ${statusLine(profile, state)}
      ${confirm}
      <div class="profile-form-actions">
        <button id="profile-cancel" class="button" type="button"${profile.saving ? ' disabled' : ''}>Cancel</button>
        <button id="profile-save" class="button primary" type="submit"${canSave ? '' : ' disabled'}>Save changes</button>
      </div>
    </form>`;
}

export function profileCardBody(state: AppState, advancedOpen = false): string {
  if (!state.pubkey) return localProfile();
  return state.profile.editing ? editProfile(state, advancedOpen) : viewProfile(state);
}

export function profileMode(state: AppState): 'local' | 'view' | 'edit' {
  if (!state.pubkey) return 'local';
  return state.profile.editing ? 'edit' : 'view';
}

export function profileCard(state: AppState): string {
  return `<section class="settings-category profile-card" id="profile-card" data-settings-section="profile" data-profile-mode="${profileMode(state)}" aria-labelledby="profile-card-title">${profileCardBody(state)}</section>`;
}
