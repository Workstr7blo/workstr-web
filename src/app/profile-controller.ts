import { fetchProfileMetadataEvent, editableProfileFields, publishProfileMetadata, type ProfileMetadataChanges } from '../nostr/profile-metadata';
import { parseProfileEvent, writeCachedProfile } from '../nostr/profile';
import { MediaUploadError, uploadProfileImage } from '../nostr/media-upload';
import type { SignedNostrEvent, Signer } from '../signer/types';
import type { AppState } from './state';
import type { MoneroAddressPublishResult } from './monero-address-controller';
import { isSignerTimeout, publishFailureReason } from './monero-address-controller';
import { accountIdentity, updateAccountIdentity } from './account-chip';
import { normalizeProfileField, profileDirty, profileDraftError, type ProfileFields } from './profile-editor';
import { photoPreview, profileCardBody, profileMode } from './profile-view';

// The Settings Profile editor: one card, one Save changes, two Nostr events underneath. The
// display name and picture are `kind:0`; the Monero address is NIP-A3 `kind:10133`, still
// read and written by the Monero address controller. This file decides which of the two a
// save needs, publishes each independently, and keeps whichever did not land dirty so a
// retry never republishes the one that did.
//
// The card is repainted in place, never through the shell render: a render rebuilds Settings
// and would close the editor the result is being reported in, and throw away the draft.
export interface ProfileControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  getSigner(): Promise<Signer | null>;
  moneroAddress: {
    refresh(): Promise<void>;
    refreshIfNeeded(): void;
    publish(address: string): Promise<MoneroAddressPublishResult>;
  };
}

const NOT_LOADED = 'Your current profile could not be loaded, so it was not changed. Refresh profile and try again.';

export function createProfileController(ctx: ProfileControllerContext) {
  const { root, state } = ctx;
  let loading: Promise<void> | null = null;
  let upload: AbortController | null = null;

  const profile = () => state.profile;
  const card = () => root.querySelector<HTMLElement>('#profile-card');

  // What the published profile says right now. Before the complete `kind:0` has been read,
  // the cached name and picture stand in so the card is not empty - but only for display:
  // saving still requires the real event.
  function currentFields(): ProfileFields {
    const loaded = profile().event !== undefined;
    const fields = loaded ? editableProfileFields(profile().event ?? null) : { displayName: state.profileName || '', picture: state.profilePicture || '' };
    return { ...fields, address: state.monero.address || '' };
  }

  function paint(): void {
    const host = card();
    if (!host) return;
    const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.id : '';
    const advancedOpen = host.querySelector('#profile-advanced-toggle')?.getAttribute('aria-expanded') === 'true';
    host.dataset.profileMode = profileMode(state);
    host.innerHTML = profileCardBody(state, advancedOpen);
    // A repaint replaces the element that had focus. Putting it back on its successor keeps
    // a keyboard or screen-reader user where they were.
    const successor = focused ? host.querySelector<HTMLElement>(`#${focused}`) : null;
    if (successor && !(successor as HTMLButtonElement).disabled) successor.focus();
  }

  function focus(id: string): void {
    root.querySelector<HTMLElement>(`#${id}`)?.focus();
  }

  function set(next: Partial<AppState['profile']>): void {
    state.profile = { ...state.profile, ...next };
    paint();
  }

  // A published `kind:0` is also who the topbar says is signed in.
  function adoptEvent(pubkey: string, event: SignedNostrEvent | null): void {
    if (!event) return;
    const parsed = parseProfileEvent(pubkey, event);
    if (!parsed) return;
    writeCachedProfile(parsed);
    state.profileName = parsed.name || parsed.nip05 || null;
    state.profilePicture = parsed.picture || null;
    updateAccountIdentity(root, accountIdentity(state));
  }

  function load(): Promise<void> {
    if (loading) return loading;
    const pubkey = state.pubkey;
    if (!pubkey) return Promise.resolve();
    set({ status: 'loading' });
    loading = (async () => {
      try {
        const event = await fetchProfileMetadataEvent(pubkey, state.settings.publicRelays);
        if (state.pubkey !== pubkey) return;
        state.profile = { ...state.profile, status: 'ready', event };
        adoptEvent(pubkey, event);
      } catch {
        if (state.pubkey !== pubkey) return;
        // Whatever was read before stays the baseline; nothing is assumed empty.
        state.profile = { ...state.profile, status: 'error', message: NOT_LOADED, messageKind: 'bad' };
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // The first Settings visit reads both events; after that only Refresh profile asks again.
  function refreshIfNeeded(): void {
    if (!state.pubkey) return;
    if (profile().status === 'idle') void load().then(repaint);
    ctx.moneroAddress.refreshIfNeeded();
  }

  async function refresh(confirmed = false): Promise<void> {
    if (!state.pubkey || profile().saving || profile().uploading) return;
    const dirty = profileDirty(profile());
    if (profile().editing && (dirty.profile || dirty.address) && !confirmed) {
      set({ confirmRefresh: true });
      focus('profile-refresh-confirm');
      return;
    }
    set({ confirmRefresh: false, message: undefined, messageKind: undefined });
    await Promise.all([load(), ctx.moneroAddress.refresh()]);
    if (profile().editing) {
      const fields = currentFields();
      state.profile = { ...state.profile, baseline: fields, draft: { ...fields } };
    }
    if (profile().status === 'ready' && state.monero.status === 'ready') state.profile = { ...state.profile, message: undefined, messageKind: undefined };
    else if (state.monero.status === 'error' && profile().status !== 'error') state.profile = { ...state.profile, message: state.monero.message, messageKind: 'bad' };
    paint();
  }

  function startEdit(): void {
    const fields = currentFields();
    set({ editing: true, baseline: fields, draft: { ...fields }, confirmRefresh: false, message: profile().status === 'error' ? NOT_LOADED : undefined, messageKind: profile().status === 'error' ? 'bad' : undefined });
    focus('profile-display-name');
  }

  function stopEdit(message?: string): void {
    upload?.abort();
    upload = null;
    set({ editing: false, baseline: undefined, draft: undefined, confirmRefresh: false, uploading: false, message, messageKind: message ? 'ok' : undefined });
    focus('profile-edit');
  }

  // Typing is mirrored into the draft without a repaint, which would move the caret. Only the
  // two things the draft decides are patched: whether Save is possible and the photo preview.
  function input(field: keyof ProfileFields, value: string): void {
    const current = profile();
    if (!current.draft || !current.baseline) return;
    // An emptied avatar URL is not a request to publish no picture; it falls back to the one
    // already published.
    const next = field === 'picture' && !value.trim() ? current.baseline.picture : value;
    state.profile = { ...current, draft: { ...current.draft, [field]: next }, message: current.messageKind === 'bad' ? undefined : current.message };
    const save = root.querySelector<HTMLButtonElement>('#profile-save');
    const dirty = profileDirty(state.profile);
    if (save) save.disabled = !(dirty.profile || dirty.address) || Boolean(current.uploading || current.saving);
    const photo = root.querySelector('#profile-photo-button');
    if (field === 'picture' && photo) photo.innerHTML = photoPreview(state, normalizeProfileField(next));
  }

  async function uploadPhoto(file: File): Promise<void> {
    if (!profile().editing || profile().uploading) return;
    if (!file.type.startsWith('image/')) { set({ message: 'Choose an image file.', messageKind: 'bad' }); return; }
    const signer = await ctx.getSigner();
    if (!signer) { set({ message: 'Unlock Workstr to upload a photo.', messageKind: 'bad' }); return; }
    const controller = new AbortController();
    upload = controller;
    const pubkey = state.pubkey;
    set({ uploading: true, message: undefined, messageKind: undefined });
    try {
      const url = await uploadProfileImage(file, signer, { signal: controller.signal });
      if (controller.signal.aborted || state.pubkey !== pubkey || !profile().draft) return;
      // The hosted URL is only a draft until Save changes. A later publish failure keeps it,
      // so a retry does not upload the same image again.
      state.profile = { ...state.profile, draft: { ...profile().draft!, picture: url }, message: 'Photo ready. Save changes to publish it.', messageKind: 'ok' };
    } catch (error) {
      if (controller.signal.aborted) return;
      const reason = error instanceof MediaUploadError ? error.message : publishFailureReason(error);
      state.profile = { ...state.profile, message: `Could not upload the photo: ${reason}. Your current photo is unchanged. Try again, or enter an image URL under Advanced.`, messageKind: 'bad' };
    } finally {
      if (upload === controller) upload = null;
      if (!controller.signal.aborted) { set({ uploading: false }); focus('profile-change-photo'); }
    }
  }

  async function publishProfile(signer: Signer, baseline: ProfileFields, draft: ProfileFields): Promise<string | null> {
    if (profile().event === undefined) return NOT_LOADED;
    const changes: ProfileMetadataChanges = {};
    if (normalizeProfileField(draft.displayName) !== normalizeProfileField(baseline.displayName)) changes.displayName = normalizeProfileField(draft.displayName);
    if (normalizeProfileField(draft.picture) !== normalizeProfileField(baseline.picture)) changes.picture = normalizeProfileField(draft.picture);
    try {
      const result = await publishProfileMetadata(signer, changes, { relays: state.settings.publicRelays, existing: profile().event });
      state.profile = { ...state.profile, event: result.event, baseline: { ...profile().baseline!, displayName: draft.displayName, picture: draft.picture } };
      adoptEvent(result.event.pubkey || state.pubkey || '', result.event);
      return null;
    } catch (error) {
      return isSignerTimeout(error) ? 'Your signer did not answer.' : publishFailureReason(error);
    }
  }

  async function save(): Promise<void> {
    const current = profile();
    if (!current.editing || !current.baseline || !current.draft || current.saving || current.uploading) return;
    const dirty = profileDirty(current);
    if (!dirty.profile && !dirty.address) return;
    const invalid = profileDraftError(current.baseline, current.draft);
    if (invalid) { set({ message: invalid, messageKind: 'bad' }); return; }
    const signer = await ctx.getSigner();
    if (!signer) { set({ message: 'Unlock Workstr to save your profile.', messageKind: 'bad' }); return; }
    const pubkey = state.pubkey;
    const draft = { ...current.draft };
    set({ saving: true, confirmRefresh: false, message: undefined, messageKind: undefined });

    const profileError = dirty.profile ? await publishProfile(signer, current.baseline, draft) : null;
    let addressError: string | null = null;
    if (dirty.address && state.pubkey === pubkey) {
      const result = await ctx.moneroAddress.publish(normalizeProfileField(draft.address));
      if (result.ok) state.profile = { ...state.profile, baseline: { ...profile().baseline!, address: draft.address } };
      else addressError = result.message;
    }
    if (state.pubkey !== pubkey) return;
    state.profile = { ...state.profile, saving: false };

    if (!profileError && !addressError) {
      stopEdit('Profile updated.');
      ctx.toast('Profile updated');
      return;
    }
    let message: string;
    if (dirty.profile && dirty.address && !profileError) message = `Avatar and display name updated. The Monero address could not be updated: ${addressError}`;
    else if (dirty.profile && dirty.address && !addressError) message = `Monero address updated. The avatar or display name could not be updated: ${profileError}`;
    else message = `Your profile could not be updated: ${profileError || addressError}`;
    set({ message, messageKind: 'bad' });
    ctx.toast('Profile not fully updated', 'bad');
  }

  function copyNpub(button: HTMLElement): void {
    const status = root.querySelector('#profile-status');
    void navigator.clipboard.writeText(button.dataset.npub || '').then(
      () => { if (status) status.textContent = 'npub copied.'; },
      () => { if (status) status.textContent = 'Could not copy the npub.'; }
    );
  }

  function toggleAdvanced(button: HTMLElement): void {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    const panel = root.querySelector<HTMLElement>('#profile-advanced-panel');
    if (panel) panel.hidden = !open;
    if (open) focus('profile-avatar-url');
  }

  // Delegated once, because the card is repainted in place and per-render binding would miss
  // every repaint the controller makes itself.
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('#profile-card button');
    if (!target) return;
    switch (target.id) {
      case 'profile-edit': startEdit(); break;
      case 'profile-cancel': stopEdit(); break;
      case 'profile-refresh': void refresh(); break;
      case 'profile-refresh-confirm': void refresh(true); break;
      case 'profile-refresh-keep': set({ confirmRefresh: false }); focus('profile-save'); break;
      case 'profile-photo-button':
      case 'profile-change-photo': root.querySelector<HTMLInputElement>('#profile-photo-input')?.click(); break;
      case 'profile-copy-npub': copyNpub(target); break;
      case 'profile-advanced-toggle': toggleAdvanced(target); break;
    }
  });
  root.addEventListener('submit', (event) => {
    if ((event.target as HTMLElement).id !== 'profile-form') return;
    event.preventDefault();
    void save();
  });
  root.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'profile-display-name') input('displayName', target.value);
    else if (target.id === 'profile-address') input('address', target.value);
    else if (target.id === 'profile-avatar-url') input('picture', target.value);
  });
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id !== 'profile-photo-input') return;
    const file = target.files?.[0];
    target.value = '';
    if (file) void uploadPhoto(file);
  });

  // Something outside the editor moved - the address lookup answered, a profile arrived. The
  // read-only card follows; an open editor keeps its draft and is left alone.
  function repaint(): void {
    if (!profile().editing) paint();
  }

  return { refresh, refreshIfNeeded, repaint, save, startEdit, cancel: () => stopEdit(), uploadPhoto };
}
