import type { SignedNostrEvent } from '../signer/types';
import { looksLikeMoneroAddress } from '../nostr/payment-targets';

// The Settings Profile editor as data. It presents three fields as one profile, but they
// belong to two Nostr events - the display name and picture to `kind:0`, the Monero address
// to the NIP-A3 `kind:10133` - so every question it answers is asked per event group: which
// group changed, which one to publish, and which one is still unsaved after a partial failure.
export interface ProfileFields {
  displayName: string;
  picture: string;
  address: string;
}

export interface ProfileEditorState {
  /** The `kind:0` read. Separate from the address, which `state.monero` owns. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /**
   * The latest complete `kind:0`, or null when the account has none. Undefined until a read
   * succeeds: a profile that could not be read cannot be safely rewritten.
   */
  event?: SignedNostrEvent | null;
  editing: boolean;
  /** What the published profile was when editing began, advanced as each event lands. */
  baseline?: ProfileFields;
  draft?: ProfileFields;
  uploading?: boolean;
  saving?: boolean;
  /** A refresh was asked for over unsaved changes and is waiting for the reader to agree. */
  confirmRefresh?: boolean;
  message?: string;
  messageKind?: 'ok' | 'bad';
}

export const EMPTY_PROFILE: ProfileEditorState = { status: 'idle', editing: false };

export function emptyProfileEditor(): ProfileEditorState {
  return { ...EMPTY_PROFILE };
}

// Whitespace a person cannot see is not a change, so "Trainer " and "Trainer" publish nothing.
export function normalizeProfileField(value: string | undefined): string {
  return (value ?? '').trim();
}

export function profileChanged(baseline: ProfileFields, draft: ProfileFields): boolean {
  return normalizeProfileField(baseline.displayName) !== normalizeProfileField(draft.displayName)
    || normalizeProfileField(baseline.picture) !== normalizeProfileField(draft.picture);
}

export function paymentAddressChanged(baseline: ProfileFields, draft: ProfileFields): boolean {
  return normalizeProfileField(baseline.address) !== normalizeProfileField(draft.address);
}

export function profileDirty(editor: ProfileEditorState): { profile: boolean; address: boolean } {
  if (!editor.baseline || !editor.draft) return { profile: false, address: false };
  return { profile: profileChanged(editor.baseline, editor.draft), address: paymentAddressChanged(editor.baseline, editor.draft) };
}

export function anyProfileDirty(editor: ProfileEditorState): boolean {
  const dirty = profileDirty(editor);
  return dirty.profile || dirty.address;
}

// Only `https:` images: an `http:` avatar is mixed content on the Workstr origin, and a
// `javascript:` or `data:` URL is not an image host at all.
export function isSafeAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** The first reason the draft cannot be saved, or null. Unchanged fields are not judged. */
export function profileDraftError(baseline: ProfileFields, draft: ProfileFields): string | null {
  if (normalizeProfileField(baseline.displayName) !== normalizeProfileField(draft.displayName) && !normalizeProfileField(draft.displayName)) {
    return 'Enter a display name.';
  }
  const picture = normalizeProfileField(draft.picture);
  if (picture !== normalizeProfileField(baseline.picture) && !isSafeAvatarUrl(picture)) {
    return 'The avatar URL must be a direct https:// image link.';
  }
  const address = normalizeProfileField(draft.address);
  if (address !== normalizeProfileField(baseline.address) && address && !looksLikeMoneroAddress(address)) {
    return 'That does not look like a Monero address. Mainnet addresses are 95 characters (106 when integrated) and start with 4 or 8.';
  }
  return null;
}
