// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfileController } from '../src/app/profile-controller';
import { profileCard } from '../src/app/profile-view';
import { emptyProfileEditor } from '../src/app/profile-editor';
import type { AppState } from '../src/app/state';
import type { SignedNostrEvent, Signer } from '../src/signer/types';

const { fetchProfileMetadataEventMock, publishProfileMetadataMock, uploadProfileImageMock } = vi.hoisted(() => ({
  fetchProfileMetadataEventMock: vi.fn(),
  publishProfileMetadataMock: vi.fn(),
  uploadProfileImageMock: vi.fn()
}));

vi.mock('../src/nostr/profile-metadata', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/profile-metadata')>(),
  fetchProfileMetadataEvent: fetchProfileMetadataEventMock,
  publishProfileMetadata: publishProfileMetadataMock
}));
vi.mock('../src/nostr/media-upload', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/media-upload')>(),
  uploadProfileImage: uploadProfileImageMock
}));

const PUBKEY = 'ab'.repeat(32);
const ADDRESS = `8${'B'.repeat(94)}`;
const OTHER = `4${'C'.repeat(94)}`;
const OLD_PICTURE = 'https://example.invalid/old.png';
const UPLOADED = 'https://image.example/uploaded.jpg';
const MANUAL = 'https://self.example/me.png';

function kind0(content: Record<string, unknown>): SignedNostrEvent {
  return { id: 'k0', pubkey: PUBKEY, kind: 0, created_at: 1, tags: [], content: JSON.stringify(content), sig: 's' };
}

const PROFILE = kind0({ name: 'settebello', display_name: 'Settebello', picture: OLD_PICTURE, about: 'kept' });

const signer = { getPublicKey: async () => PUBKEY, signEvent: vi.fn() } as unknown as Signer;

function harness(over: Partial<AppState> = {}) {
  localStorage.clear();
  const state = {
    pubkey: PUBKEY, npub: null, profileName: 'Settebello', profilePicture: OLD_PICTURE, profileNames: {},
    settings: { unit: 'kg', paymentMode: 'off', publicRelays: ['wss://relay.example'] },
    monero: { status: 'ready', address: ADDRESS, event: null },
    profile: emptyProfileEditor(),
    ...over
  } as unknown as AppState;
  document.body.innerHTML = `<div id="app"><div class="topbar-actions"></div>${profileCard(state)}</div>`;
  const root = document.getElementById('app') as HTMLElement;
  const toast = vi.fn();
  const moneroAddress = {
    refresh: vi.fn(async () => undefined),
    refreshIfNeeded: vi.fn(),
    publish: vi.fn(async (address: string) => { state.monero = { ...state.monero, address }; return { ok: true as const, address }; })
  };
  const controller = createProfileController({ root, state, toast, getSigner: async () => signer, moneroAddress });
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const click = (selector: string) => $(selector)!.click();
  const type = (selector: string, value: string) => {
    const field = $<HTMLInputElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const choose = (file: File) => {
    const input = $<HTMLInputElement>('#profile-photo-input')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const saveDisabled = () => $<HTMLButtonElement>('#profile-save')!.disabled;
  const status = () => $('#profile-status')?.textContent || '';
  return { state, root, toast, moneroAddress, controller, $, click, type, choose, saveDisabled, status };
}

async function loaded(over: Partial<AppState> = {}) {
  fetchProfileMetadataEventMock.mockResolvedValueOnce(PROFILE);
  const app = harness(over);
  app.controller.refreshIfNeeded();
  await vi.waitFor(() => expect(app.state.profile.status).toBe('ready'));
  return app;
}

function published(changes: Record<string, string>) {
  return { event: kind0({ ...JSON.parse(PROFILE.content), ...(changes.displayName !== undefined ? { display_name: changes.displayName } : {}), ...(changes.picture !== undefined ? { picture: changes.picture } : {}) }), okRelays: ['wss://relay.example'], failedRelays: [] };
}

describe('the Settings Profile card', () => {
  beforeEach(() => {
    fetchProfileMetadataEventMock.mockReset();
    publishProfileMetadataMock.mockReset();
    uploadProfileImageMock.mockReset();
    publishProfileMetadataMock.mockImplementation(async (_signer: Signer, changes: Record<string, string>) => published(changes));
  });

  describe('normal mode', () => {
    it('shows the avatar, name, short npub and short Monero address with visible text actions', async () => {
      const app = await loaded();
      expect(app.$('img.profile-avatar')?.getAttribute('src')).toBe(OLD_PICTURE);
      expect(app.$('.profile-name')?.textContent).toBe('Settebello');
      expect(app.$('.profile-npub')?.textContent).toMatch(/^npub1.+\.\.\..+/);
      expect(app.$('.profile-address')?.textContent).toBe(`${ADDRESS.slice(0, 12)}...${ADDRESS.slice(-9)}`);
      expect(app.$('#profile-edit')?.textContent?.trim()).toBe('Edit profile');
      expect(app.$('#profile-edit svg')).toBeTruthy();
      expect(app.$('#profile-refresh')?.textContent).toBe('Refresh profile');
    });

    it('says Not set when no address is published', async () => {
      const app = await loaded({ monero: { status: 'ready', address: '', event: null } } as Partial<AppState>);
      expect(app.$('.profile-address')?.textContent).toBe('Not set');
    });

    it('keeps the avatar a picture rather than a hidden action, and carries none of the removed extras', async () => {
      const app = await loaded();
      expect(app.$('img.profile-avatar')?.closest('button, a')).toBeNull();
      const text = app.$('#profile-card')!.textContent || '';
      for (const gone of ['PUBLISHED', 'Workstr wallet', 'External wallet', 'is public', 'Refresh from relays', 'About', 'NIP-05']) expect(text).not.toContain(gone);
      expect(app.$('#monero-address-refresh')).toBeNull();
      expect(app.$('input')).toBeNull();
    });

    it('offers only account creation when local-only', () => {
      const app = harness({ pubkey: null, profileName: null, profilePicture: null } as Partial<AppState>);
      expect(app.$('#profile-card')?.textContent).toContain('Local only');
      expect(app.$('#sign-in-settings')?.textContent).toBe('Create or restore account');
      expect(app.$('#profile-edit, #profile-photo-input, #profile-display-name, #profile-address')).toBeNull();
      app.controller.refreshIfNeeded();
      expect(fetchProfileMetadataEventMock).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    it('makes avatar, display name and address editable, npub read-only, and Advanced collapsed', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('edit');
      expect(app.$('#profile-photo-button')).toBeTruthy();
      expect(app.$('#profile-change-photo')?.textContent).toBe('Change photo');
      expect(app.$<HTMLInputElement>('#profile-photo-input')?.accept).toBe('image/*');
      expect(app.$<HTMLInputElement>('#profile-display-name')?.value).toBe('Settebello');
      expect(app.$<HTMLInputElement>('#profile-address')?.value).toBe(ADDRESS);
      expect(app.$('.profile-npub-full')?.tagName).toBe('CODE');
      expect(app.$('#profile-copy-npub')?.textContent).toBe('Copy');
      expect(app.$('#profile-advanced-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(app.$('#profile-advanced-panel')?.hidden).toBe(true);
      expect(app.saveDisabled()).toBe(true);
      expect(document.activeElement?.id).toBe('profile-display-name');
      // Only the three supported fields are editable.
      expect(app.root.querySelectorAll('#profile-card input:not([type="file"])')).toHaveLength(3);

      app.click('#profile-advanced-toggle');
      expect(app.$('#profile-advanced-toggle')?.getAttribute('aria-expanded')).toBe('true');
      expect(app.$('#profile-advanced-panel')?.hidden).toBe(false);
      expect(app.$<HTMLInputElement>('#profile-avatar-url')?.value).toBe(OLD_PICTURE);
    });

    it('cancels back to the loaded values without publishing', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Changed');
      expect(app.saveDisabled()).toBe(false);
      app.click('#profile-cancel');
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('view');
      expect(app.$('.profile-name')?.textContent).toBe('Settebello');
      app.click('#profile-edit');
      expect(app.$<HTMLInputElement>('#profile-display-name')?.value).toBe('Settebello');
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.moneroAddress.publish).not.toHaveBeenCalled();
    });

    it('copies the full npub and says so in the live region', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const app = await loaded();
      app.click('#profile-edit');
      app.click('#profile-copy-npub');
      await vi.waitFor(() => expect(app.status()).toBe('npub copied.'));
      expect((writeText.mock.calls[0] as unknown as string[])[0]).toMatch(/^npub1/);
    });
  });

  describe('dirty tracking and publishing', () => {
    it('publishes only kind:0 for a display-name change, leaving name and address alone', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', ' Coach ');
      await app.controller.save();
      expect(publishProfileMetadataMock).toHaveBeenCalledTimes(1);
      expect(publishProfileMetadataMock.mock.calls[0][1]).toEqual({ displayName: 'Coach' });
      expect(publishProfileMetadataMock.mock.calls[0][2].existing).toBe(PROFILE);
      expect(app.moneroAddress.publish).not.toHaveBeenCalled();
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('view');
      expect(app.status()).toBe('Profile updated.');
      expect(app.state.profileName).toBe('Coach');
    });

    it('publishes only kind:10133 for an address change', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-address', OTHER);
      await app.controller.save();
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.moneroAddress.publish).toHaveBeenCalledWith(OTHER);
      expect(app.status()).toBe('Profile updated.');
    });

    it('publishes one kind:0 and one kind:10133 when both groups changed', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      app.click('#profile-advanced-toggle');
      app.type('#profile-avatar-url', MANUAL);
      app.type('#profile-address', OTHER);
      await app.controller.save();
      expect(publishProfileMetadataMock).toHaveBeenCalledTimes(1);
      expect(publishProfileMetadataMock.mock.calls[0][1]).toEqual({ displayName: 'Coach', picture: MANUAL });
      expect(app.moneroAddress.publish).toHaveBeenCalledTimes(1);
    });

    it('treats a field typed back to its original, or padded with whitespace, as unchanged', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Other');
      expect(app.saveDisabled()).toBe(false);
      app.type('#profile-display-name', '  Settebello  ');
      app.type('#profile-address', ` ${ADDRESS} `);
      expect(app.saveDisabled()).toBe(true);
      await app.controller.save();
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.moneroAddress.publish).not.toHaveBeenCalled();
    });

    it('removes the address when the field is cleared and saved', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-address', '');
      await app.controller.save();
      expect(app.moneroAddress.publish).toHaveBeenCalledWith('');
      expect(app.$('.profile-address')?.textContent).toBe('Not set');
    });

    it('rejects a blank display name, an unsafe avatar URL and an invalid address', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', '   ');
      await app.controller.save();
      expect(app.status()).toContain('Enter a display name.');
      app.type('#profile-display-name', 'Coach');
      app.click('#profile-advanced-toggle');
      app.type('#profile-avatar-url', 'javascript:alert(1)');
      await app.controller.save();
      expect(app.status()).toContain('https://');
      app.type('#profile-avatar-url', MANUAL);
      app.type('#profile-address', 'not-an-address');
      await app.controller.save();
      expect(app.status()).toContain('does not look like a Monero address');
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.moneroAddress.publish).not.toHaveBeenCalled();
      // Errors are words, not only colour.
      expect(app.$('#profile-status .profile-status-mark')?.textContent).toBe('Error: ');
    });

    it('will not overwrite a profile it could not read', async () => {
      fetchProfileMetadataEventMock.mockRejectedValueOnce(new Error('no relay could be reached for the profile lookup'));
      const app = harness();
      app.controller.refreshIfNeeded();
      await vi.waitFor(() => expect(app.state.profile.status).toBe('error'));
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      await app.controller.save();
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.status()).toContain('could not be loaded');
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('edit');
    });
  });

  describe('partial publishing', () => {
    it('keeps only the address dirty when kind:0 lands and the address does not, and retries only it', async () => {
      const app = await loaded();
      app.moneroAddress.publish.mockResolvedValueOnce({ ok: false, message: 'Could not publish (blocked).' } as never);
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      app.type('#profile-address', OTHER);
      await app.controller.save();
      expect(app.status()).toContain('Avatar and display name updated. The Monero address could not be updated');
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('edit');
      expect(app.$<HTMLInputElement>('#profile-address')?.value).toBe(OTHER);

      await app.controller.save();
      expect(publishProfileMetadataMock).toHaveBeenCalledTimes(1);
      expect(app.moneroAddress.publish).toHaveBeenCalledTimes(2);
      expect(app.status()).toBe('Profile updated.');
    });

    it('keeps only the profile fields dirty when the address lands and kind:0 does not', async () => {
      const app = await loaded();
      publishProfileMetadataMock.mockRejectedValueOnce(new Error('no relay accepted the profile'));
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      app.type('#profile-address', OTHER);
      await app.controller.save();
      expect(app.status()).toContain('Monero address updated. The avatar or display name could not be updated');
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('edit');

      await app.controller.save();
      expect(publishProfileMetadataMock).toHaveBeenCalledTimes(2);
      expect(app.moneroAddress.publish).toHaveBeenCalledTimes(1);
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('view');
    });

    it('keeps everything dirty and the editor open when both fail', async () => {
      const app = await loaded();
      publishProfileMetadataMock.mockRejectedValueOnce(new Error('no relay accepted the profile'));
      app.moneroAddress.publish.mockResolvedValueOnce({ ok: false, message: 'Could not publish (blocked).' } as never);
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      app.type('#profile-address', OTHER);
      await app.controller.save();
      expect(app.status()).toContain('could not be updated');
      expect(app.saveDisabled()).toBe(false);
      expect(app.$<HTMLInputElement>('#profile-display-name')?.value).toBe('Coach');
      expect(app.toast).toHaveBeenCalledWith('Profile not fully updated', 'bad');
    });
  });

  describe('refresh', () => {
    it('reloads both events together, from one action', async () => {
      const app = await loaded();
      fetchProfileMetadataEventMock.mockResolvedValueOnce(kind0({ display_name: 'Fresh', picture: MANUAL }));
      app.click('#profile-refresh');
      await vi.waitFor(() => expect(app.$('.profile-name')?.textContent).toBe('Fresh'));
      expect(fetchProfileMetadataEventMock).toHaveBeenCalledTimes(2);
      expect(app.moneroAddress.refresh).toHaveBeenCalledTimes(1);
      expect(app.root.querySelectorAll('#profile-refresh')).toHaveLength(1);
    });

    it('asks before discarding unsaved changes, and replaces the draft once confirmed', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Unsaved');
      app.click('#profile-refresh');
      expect(app.$('.profile-confirm')?.textContent).toContain('discards your unsaved changes');
      expect(fetchProfileMetadataEventMock).toHaveBeenCalledTimes(1);

      app.click('#profile-refresh-keep');
      expect(app.$('.profile-confirm')).toBeNull();
      expect(app.$<HTMLInputElement>('#profile-display-name')?.value).toBe('Unsaved');

      fetchProfileMetadataEventMock.mockResolvedValueOnce(kind0({ display_name: 'Fresh' }));
      app.click('#profile-refresh');
      app.click('#profile-refresh-confirm');
      await vi.waitFor(() => expect(app.$<HTMLInputElement>('#profile-display-name')?.value).toBe('Fresh'));
      expect(app.saveDisabled()).toBe(true);
    });

    it('refreshes at once when nothing is dirty', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      fetchProfileMetadataEventMock.mockResolvedValueOnce(PROFILE);
      app.click('#profile-refresh');
      expect(app.$('.profile-confirm')).toBeNull();
      await vi.waitFor(() => expect(fetchProfileMetadataEventMock).toHaveBeenCalledTimes(2));
    });
  });

  describe('avatar upload', () => {
    const photo = () => new File([new Uint8Array(8)], 'me.jpg', { type: 'image/jpeg' });

    it('uploads a chosen photo into the draft and publishes nothing until Save changes', async () => {
      uploadProfileImageMock.mockResolvedValueOnce(UPLOADED);
      const app = await loaded();
      app.click('#profile-edit');
      app.choose(photo());
      await vi.waitFor(() => expect(app.$('img.profile-photo-image')?.getAttribute('src')).toBe(UPLOADED));
      expect(uploadProfileImageMock.mock.calls[0][1]).toBe(signer);
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      expect(app.$('img.profile-photo-image')?.getAttribute('alt')).toBe('Profile photo preview');
      expect(app.saveDisabled()).toBe(false);

      await app.controller.save();
      expect(publishProfileMetadataMock.mock.calls[0][1]).toEqual({ picture: UPLOADED });
    });

    it('blocks Save while the upload is running', async () => {
      let finish: (url: string) => void = () => undefined;
      uploadProfileImageMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      const app = await loaded();
      app.click('#profile-edit');
      app.type('#profile-display-name', 'Coach');
      app.choose(photo());
      await vi.waitFor(() => expect(app.status()).toBe('Uploading photo…'));
      expect(app.saveDisabled()).toBe(true);
      await app.controller.save();
      expect(publishProfileMetadataMock).not.toHaveBeenCalled();
      finish(UPLOADED);
      await vi.waitFor(() => expect(app.saveDisabled()).toBe(false));
    });

    it('keeps the published avatar and the editor after a failed upload', async () => {
      uploadProfileImageMock.mockRejectedValueOnce(new Error('network down'));
      const app = await loaded();
      app.click('#profile-edit');
      app.choose(photo());
      await vi.waitFor(() => expect(app.status()).toContain('Could not upload the photo'));
      expect(app.status()).toContain('Advanced');
      expect(app.state.profile.draft?.picture).toBe(OLD_PICTURE);
      expect(app.$('#profile-card')?.dataset.profileMode).toBe('edit');
      expect(app.saveDisabled()).toBe(true);
    });

    it('does not upload again when the kind:0 publish fails and is retried', async () => {
      uploadProfileImageMock.mockResolvedValueOnce(UPLOADED);
      publishProfileMetadataMock.mockRejectedValueOnce(new Error('no relay accepted the profile'));
      const app = await loaded();
      app.click('#profile-edit');
      app.choose(photo());
      await vi.waitFor(() => expect(app.state.profile.draft?.picture).toBe(UPLOADED));
      await app.controller.save();
      expect(app.$('img.profile-photo-image')?.getAttribute('src')).toBe(UPLOADED);
      await app.controller.save();
      expect(uploadProfileImageMock).toHaveBeenCalledTimes(1);
      expect(publishProfileMetadataMock.mock.calls[1][1]).toEqual({ picture: UPLOADED });
    });

    it('lets a manual URL override an upload, and a later upload override the URL', async () => {
      uploadProfileImageMock.mockResolvedValueOnce(UPLOADED).mockResolvedValueOnce(`${UPLOADED}?2`);
      const app = await loaded();
      app.click('#profile-edit');
      app.click('#profile-advanced-toggle');
      app.choose(photo());
      await vi.waitFor(() => expect(app.$<HTMLInputElement>('#profile-avatar-url')?.value).toBe(UPLOADED));
      app.type('#profile-avatar-url', MANUAL);
      expect(app.state.profile.draft?.picture).toBe(MANUAL);
      expect(app.$('img.profile-photo-image')?.getAttribute('src')).toBe(MANUAL);
      app.choose(photo());
      await vi.waitFor(() => expect(app.state.profile.draft?.picture).toBe(`${UPLOADED}?2`));
      expect(app.$<HTMLInputElement>('#profile-avatar-url')?.value).toBe(`${UPLOADED}?2`);
    });

    it('refuses a file that is not an image', async () => {
      const app = await loaded();
      app.click('#profile-edit');
      app.choose(new File(['x'], 'notes.txt', { type: 'text/plain' }));
      await vi.waitFor(() => expect(app.status()).toContain('Choose an image file.'));
      expect(uploadProfileImageMock).not.toHaveBeenCalled();
    });
  });
});
