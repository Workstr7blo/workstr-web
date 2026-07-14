import { describe, expect, it } from 'vitest';
import { renderShell } from '../src/app/shell';

describe('shell', () => {
  it('renders the app chrome and all views without a signer', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    renderShell(root);
    expect(root.querySelector('.sidebar')).toBeTruthy();
    expect(root.querySelector('#page-exercises')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-library')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-discover')).toBeTruthy();
    // walk every nav view; each must render its page without throwing
    for (const view of ['workouts', 'statistics', 'settings', 'exercises']) {
      root.querySelector<HTMLElement>(`[data-view="${view}"]`)?.click();
      expect(root.querySelector('.page.active'), view).toBeTruthy();
    }
    expect(root.querySelector('#page-exercises')).toBeTruthy();
  });
});
