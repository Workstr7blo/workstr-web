// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { profileCard } from '../src/app/profile-view';
import type { AppState } from '../src/app/state';

const PUBKEY = 'ab'.repeat(32);
const HOSTILE = '"><img src=x onerror=alert(1)>';

function render(over: Partial<AppState> = {}): HTMLElement {
  const state = {
    pubkey: PUBKEY, profileName: 'Trainer', profilePicture: null,
    monero: { status: 'ready', address: '' },
    profile: { status: 'ready', editing: false },
    ...over
  } as unknown as AppState;
  document.body.innerHTML = `<div id="app">${profileCard(state)}</div>`;
  return document.getElementById('app') as HTMLElement;
}

describe('the Profile card markup', () => {
  it('is always open, labelled by the name it shows', () => {
    const card = render().querySelector('#profile-card')!;
    expect(card.tagName).toBe('SECTION');
    expect(card.getAttribute('aria-labelledby')).toBe('profile-card-title');
    expect(card.querySelector('#profile-card-title')?.textContent).toBe('Trainer');
  });

  it('gives the editor labelled controls, a disclosure with its state, and a live region', () => {
    const root = render({ profile: { status: 'ready', editing: true, baseline: { displayName: 'Trainer', picture: '', address: '' }, draft: { displayName: 'Trainer', picture: '', address: '' } } } as Partial<AppState>);
    expect(root.querySelector('#profile-photo-button')?.getAttribute('aria-label')).toBe('Change photo');
    expect(root.querySelector('#profile-display-name')?.closest('label')?.textContent).toContain('Display name');
    expect(root.querySelector('#profile-address')?.closest('label')?.textContent).toContain('Monero payment address');
    expect(root.querySelector('#profile-advanced-toggle')?.getAttribute('aria-controls')).toBe('profile-advanced-panel');
    expect(root.querySelector('#profile-status')?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.profile-photo-image[role="img"]')?.getAttribute('aria-label')).toBe('No profile photo');
  });

  it('renders hostile profile text as text', () => {
    const root = render({ profileName: HOSTILE, profile: { status: 'ready', editing: true, baseline: { displayName: HOSTILE, picture: '', address: '' }, draft: { displayName: HOSTILE, picture: `https://x.example/${HOSTILE}`, address: '' } } } as Partial<AppState>);
    expect(root.querySelectorAll('img[src="x"]')).toHaveLength(0);
    expect(root.querySelector<HTMLInputElement>('#profile-display-name')?.value).toBe(HOSTILE);
    const view = render({ profileName: HOSTILE });
    expect(view.querySelector('.profile-name')?.textContent).toBe(HOSTILE);
    expect(view.querySelectorAll('img[src="x"]')).toHaveLength(0);
  });
});
