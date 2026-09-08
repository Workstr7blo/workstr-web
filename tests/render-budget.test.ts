// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderShell } from '../src/app/shell';
import type { ShellHandle } from '../src/app/shell-types';
import type { Exercise } from '../src/core/types';
import { fetchCanonExercises } from '../src/nostr/canon';
import { LOCAL_NAMESPACE } from '../src/db/adopt';
import { MY_EQUIPMENT } from '../src/core/equipment';
import { WorkstrStore } from '../src/db/store';

// This file is the floor #178 leaves behind. Every increment of that issue took a caller
// off the render path, and each was proved by a test of its own; what none of them could
// say is whether the work holds together - whether the app, taken as a whole, still redraws
// a page for something happening behind it.
//
// Two claims, and they are different. The count says how much is drawn. The identity
// assertions say what survives, and they are the ones that matter: a page can be redrawn
// with the same content and still have thrown away the image the reader was looking at,
// the modal they had open, or the set they were typing. Appearance would pass that. Node
// identity is the only assertion that fails it.
vi.mock('../src/nostr/zaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/zaps')>(),
  fetchMonthlyZapReceipts: vi.fn(async () => [])
}));
vi.mock('../src/nostr/canon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/canon')>(),
  fetchCanonExercises: vi.fn(async () => []),
  fetchCanonPrograms: vi.fn(async () => [])
}));
vi.mock('../src/nostr/profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/profile')>(),
  fetchProfile: vi.fn(async () => null)
}));

async function drainBoot(shell: ShellHandle): Promise<void> {
  await shell.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function catalogExercise(slug: string): Exercise {
  return {
    slug, name: slug, muscles: ['chest'], equipment: [], tags: [], instructions: [],
    image_url: `https://example.invalid/${slug}.png`,
    favourite: false, source_type: 'nostr', status: 'active',
    created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z'
  };
}

async function boot(options: Parameters<typeof renderShell>[1] = { skipCatalogRefresh: true }): Promise<{ root: HTMLElement; shell: ShellHandle }> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const shell = renderShell(root, options);
  await drainBoot(shell);
  return { root, shell };
}

async function cleanup(shell: ShellHandle): Promise<void> {
  for (const exercise of await (shell.state.store?.listExercises() ?? [])) {
    await shell.state.store?.deleteExercise(Number(exercise.id));
  }
  await drainBoot(shell);
}

// A relay answer landing behind the reader. Refreshing from the Discover panel is the one
// way to ask for one on demand; what is being measured is what its arrival costs, not the
// tap that asked for it, so the count is always taken after the tap.
async function catalogAnswer(root: HTMLElement, shell: ShellHandle, slugs: string[]): Promise<void> {
  vi.mocked(fetchCanonExercises).mockResolvedValueOnce(slugs.map(catalogExercise));
  shell.state.exerciseStatus = '';
  root.querySelector<HTMLElement>('#discover-refresh')?.click();
  await waitFor(() => shell.state.exerciseStatus.startsWith('loaded'), 'the catalog answer');
}

describe('the render budget', () => {
  // The baseline from #183, and the number every increment was measured against. It goes
  // down when work is removed and is updated here when it does. Rising is the regression.
  it('renders the page three times during a local cold start', async () => {
    const { shell } = await boot();
    expect(shell.renders.recent.map((record) => record.reason)).toEqual([
      'boot-first-paint',
      'store-reload',
      'boot-account-open'
    ]);
    expect(shell.renders.rebuilds).toBe(3);
    // Nothing on the boot path may render without saying why, or the baseline stops being
    // readable the moment it changes.
    expect(shell.renders.recent.filter((record) => record.reason === 'unattributed')).toEqual([]);
  });

  it('draws a catalog answer without rendering the page', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('[data-parent="exercises"][data-subtab="discover"]')?.click();
    const before = shell.renders.rebuilds;

    await catalogAnswer(root, shell, ['bench-press', 'barbell-row']);

    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelectorAll('#discover-grid [data-address]').length).toBeGreaterThan(0);
    await cleanup(shell);
  });

  // Reading the zap receipts starts when Settings opens and answers twice - once to say it
  // is reading, once with the month. Both used to redraw the page the reader was on.
  it('draws the funding answer without rendering the page', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('.sidebar [data-view="settings"]')?.click();
    const before = shell.renders.rebuilds;
    await waitFor(() => shell.state.support.status === 'ready', 'the funding answer');

    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelector('.support-panel #support-funding')).toBeTruthy();
    await drainBoot(shell);
  });

  // Turning sync on or off replaces the controls in the card rather than only their wording,
  // so it is the one Settings change a status patch cannot carry - and the reader is inside
  // that card when they press it.
  it('writes the sync card without rendering the page', async () => {
    // The switch only exists once there is an identity to encrypt to; signed out the card
    // points at Account instead.
    localStorage.setItem('workstr.currentPubkey', 'ab'.repeat(32));
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('.sidebar [data-view="settings"]')?.click();
    await waitFor(() => shell.state.support.status === 'ready', 'the funding answer');
    const card = root.querySelector<HTMLDetailsElement>('.data-sync-card')!;
    card.open = true;
    const before = shell.renders.rebuilds;

    expect(root.querySelector('#enable-sync')).toBeTruthy();
    root.querySelector<HTMLElement>('#enable-sync')?.click();
    await waitFor(() => shell.state.settings.backup?.enabled === true, 'sync to be turned on');

    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelector('.data-sync-card')).toBe(card);
    expect(card.open).toBe(true);
    // The switch replaced the button, and it works - which is what rebinding the patched
    // card is for. A card written without that is the failure this guards.
    expect(root.querySelector('#auto-backup')).toBeTruthy();
    localStorage.removeItem('workstr.currentPubkey');
    await drainBoot(shell);
  });

  // #204. Every case above is a background answer arriving behind the reader. These two are
  // the foreground version of the same failure: the reader's own click on a preference used
  // to rebuild the Settings page and take the card they clicked in with it.
  //
  // The equipment options come from the library, so a kit needs an exercise carrying one -
  // the starter seed is body weight, which is free and never offered.
  // Settings live in the shared local namespace and outlive a case, so the baseline is
  // written rather than assumed - otherwise these two read each other's leftovers.
  async function settingsWithKit(): Promise<{ root: HTMLElement; shell: ShellHandle }> {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.upsertExercise({ slug: 'db-row', name: 'Dumbbell Row', muscles: ['back'], equipment: ['Dumbbells'], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    await store.saveSettings({ unit: 'kg', paymentMode: 'lightning', publicRelays: [], ownedEquipment: [] });
    store.close();
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('.sidebar [data-view="settings"]')?.click();
    return { root, shell };
  }

  it('writes the unit preference without rendering the page', async () => {
    const { root, shell } = await settingsWithKit();
    const card = root.querySelector<HTMLDetailsElement>('.training-preferences-card')!;
    card.open = true;
    const before = shell.renders.rebuilds;

    const select = root.querySelector<HTMLSelectElement>('#unit-select')!;
    select.value = 'lbs';
    select.dispatchEvent(new Event('change'));
    // The saver assigns state before awaiting the write, so waiting on state would race the
    // patcher. The rendered text is the thing under test and is the honest thing to wait for.
    await waitFor(() => card.querySelector('summary .settings-category-copy small')?.textContent?.startsWith('Pounds') === true, 'the summary to say Pounds');

    expect(shell.renders.rebuilds).toBe(before);
    // The same node, not a new one that happens to be open: a patcher that rebuilt the card
    // and reopened it would pass on `open` alone and still be the bug.
    expect(root.querySelector('.training-preferences-card')).toBe(card);
    expect(card.open).toBe(true);
    expect(card.querySelector('summary .settings-category-copy small')?.textContent).toBe('Pounds \u00b7 0 equipment');
    await cleanup(shell);
  });

  it('writes the equipment kit without rendering the page', async () => {
    const { root, shell } = await settingsWithKit();
    const card = root.querySelector<HTMLDetailsElement>('.training-preferences-card')!;
    card.open = true;
    const chips = card.querySelector('.equip-options')!;
    const box = root.querySelector<HTMLInputElement>('.equip-toggle')!;
    const before = shell.renders.rebuilds;

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await waitFor(() => card.querySelector('.training-preference-block .status-pill')?.textContent === '1 selected', 'the pill to say 1 selected');

    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelector('.training-preferences-card')).toBe(card);
    expect(card.open).toBe(true);
    // The chips are not rebuilt either, so the box the reader ticked is the box they see.
    expect(card.querySelector('.equip-options')).toBe(chips);
    expect(root.querySelector('.equip-toggle')).toBe(box);
    expect(box.checked).toBe(true);
    expect(card.querySelector('.training-preference-block .status-pill')?.textContent).toBe('1 selected');
    expect(card.querySelector('summary .settings-category-copy small')?.textContent).toBe('Kilograms \u00b7 1 equipment');

    // Emptying the kit still clears a filter pointing at it. That filter belongs to
    // Exercises, which is not mounted here - the state change is the whole job, and dropping
    // the render must not drop it. Untested before #204, and the failure would be a filter
    // silently matching nothing.
    shell.state.exFilter.equip = MY_EQUIPMENT;
    shell.state.discoverFilter.equip = MY_EQUIPMENT;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await waitFor(() => card.querySelector('.training-preference-block .status-pill')?.textContent === '0 selected', 'the pill to say 0 selected');

    expect(shell.state.exFilter.equip).toBe('');
    expect(shell.state.discoverFilter.equip).toBe('');
    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelector('.training-preferences-card')).toBe(card);
    expect(card.open).toBe(true);
    await cleanup(shell);
  });
});

describe('what a background answer must not replace', () => {
  it('leaves the account chip and its avatar standing', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('[data-parent="exercises"][data-subtab="discover"]')?.click();
    const chip = root.querySelector('#account-chip');
    const avatar = root.querySelector('#account-chip .avatar-face');

    await catalogAnswer(root, shell, ['bench-press']);

    expect(root.querySelector('#account-chip')).toBe(chip);
    expect(root.querySelector('#account-chip .avatar-face')).toBe(avatar);
    await cleanup(shell);
  });

  // The image is the visible one. A rebuilt card re-fetches its photo, which on a phone is
  // a blank tile and a second download of something already on screen.
  it('leaves an exercise photo already on screen standing', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('[data-parent="exercises"][data-subtab="discover"]')?.click();
    await catalogAnswer(root, shell, ['bench-press']);
    const card = root.querySelector('#discover-grid [data-address]');
    const image = root.querySelector('#discover-grid img');
    expect(image).toBeTruthy();

    // A second answer carrying the same exercise: the state is rewritten, the screen is not.
    await catalogAnswer(root, shell, ['bench-press']);

    expect(root.querySelector('#discover-grid [data-address]')).toBe(card);
    expect(root.querySelector('#discover-grid img')).toBe(image);
    await cleanup(shell);
  });

  // What `settings-disclosure.ts` used to capture and put back. The category stays open
  // because nothing threw it away, not because something reopened it.
  it('leaves an open Settings category open while the funding answer lands', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('.sidebar [data-view="settings"]')?.click();
    const account = root.querySelector<HTMLDetailsElement>('.account-card')!;
    account.open = true;
    const support = root.querySelector<HTMLDetailsElement>('.support-panel')!;

    await waitFor(() => shell.state.support.status === 'ready', 'the funding answer');

    expect(root.querySelector('.account-card')).toBe(account);
    expect(account.open).toBe(true);
    expect(root.querySelector('.support-panel')).toBe(support);
    await drainBoot(shell);
  });

  it('leaves an open modal alone', async () => {
    const { root, shell } = await boot();
    root.querySelector<HTMLElement>('[data-parent="exercises"][data-subtab="discover"]')?.click();
    root.querySelector<HTMLElement>('#account-chip')?.click();
    await waitFor(() => root.querySelector('#modal')?.classList.contains('open') === true, 'the account modal');
    const content = root.querySelector('#modal-content')!;
    const markup = content.innerHTML;

    await catalogAnswer(root, shell, ['bench-press']);

    expect(root.querySelector('#modal-content')).toBe(content);
    expect(root.querySelector('#modal-content')?.innerHTML).toBe(markup);
    expect(root.querySelector('#modal')?.classList.contains('open')).toBe(true);
    await cleanup(shell);
  });

  it('leaves a search field the reader is typing in alone', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.upsertExercise({ slug: 'bench-press', name: 'Bench Press', muscles: [], equipment: [], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    store.close();
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    const input = root.querySelector<HTMLInputElement>('#ex-search')!;
    const before = shell.renders.rebuilds;

    input.value = 'bench';
    input.dispatchEvent(new Event('input'));

    expect(shell.renders.rebuilds).toBe(before);
    expect(root.querySelector('#ex-search')).toBe(input);
    await cleanup(shell);
  });
});
