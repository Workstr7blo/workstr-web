import { describe, expect, it } from 'vitest';
import { isSafeAvatarUrl, paymentAddressChanged, profileChanged, profileDirty, profileDraftError } from '../src/app/profile-editor';

const ADDRESS = `8${'B'.repeat(94)}`;
const base = { displayName: 'Settebello', picture: 'https://example.invalid/a.png', address: ADDRESS };

describe('the Profile draft', () => {
  it('splits changes by the event that carries them', () => {
    expect(profileChanged(base, { ...base, displayName: 'Coach' })).toBe(true);
    expect(paymentAddressChanged(base, { ...base, displayName: 'Coach' })).toBe(false);
    expect(profileChanged(base, { ...base, picture: 'https://example.invalid/b.png' })).toBe(true);
    expect(profileDirty({ status: 'ready', editing: true, baseline: base, draft: { ...base, address: '' } })).toEqual({ profile: false, address: true });
  });

  it('ignores whitespace nobody can see', () => {
    expect(profileDirty({ status: 'ready', editing: true, baseline: base, draft: { displayName: ' Settebello ', picture: ` ${base.picture}`, address: `${ADDRESS} ` } })).toEqual({ profile: false, address: false });
  });

  it('judges only the fields that changed', () => {
    expect(profileDraftError({ ...base, displayName: '' }, { ...base, displayName: '' })).toBeNull();
    expect(profileDraftError(base, { ...base, displayName: '  ' })).toBe('Enter a display name.');
    expect(profileDraftError(base, { ...base, address: '' })).toBeNull();
    expect(profileDraftError(base, { ...base, address: 'nope' })).toContain('Monero address');
  });

  it('accepts only https avatar URLs', () => {
    expect(isSafeAvatarUrl('https://example.invalid/a.png')).toBe(true);
    for (const bad of ['http://example.invalid/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '']) expect(isSafeAvatarUrl(bad), bad).toBe(false);
  });
});
