// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { launchSignerUri, renderShell } from '../src/app/shell';
import { shellMarkup } from '../src/app/layout';
import type { ShellHandle } from '../src/app/shell-types';
import type { AppState } from '../src/app/state';
import type { Exercise } from '../src/core/types';
import { fetchCanonExercises } from '../src/nostr/canon';
import type { RelayProfile } from '../src/nostr/pool';
import { fetchProfile } from '../src/nostr/profile';
import { LOCAL_NAMESPACE } from '../src/db/adopt';
import { WorkstrStore } from '../src/db/store';
import { clearLocalSecret, LEGACY_LOCAL_KEY_STORAGE, loadLocalSecret } from '../src/signer/local-key-storage';

// Boot and settings-view rendering kick off background relay fetches unrelated to this file's
// assertions. `tests/setup.ts` now blocks every non-loopback socket, so an unmocked one fails
// fast and loudly instead of outliving the test and rendering into a torn-down jsdom. These
// mocks remain because these paths need to resolve with data, not merely be prevented — they
// are no longer the thing keeping the suite from flaking.
vi.mock('../src/nostr/zaps', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/zaps')>(),
  fetchMonthlyZapReceipts: vi.fn(async () => [])
}));
vi.mock('../src/nostr/canon', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/canon')>(),
  fetchCanonExercises: vi.fn(async () => []),
  fetchCanonPrograms: vi.fn(async () => [])
}));
// `renderShell` also fires a background kind-0 lookup whenever a session pubkey is present.
// Missing one used to be invisible until the run failed somewhere else; the guard makes that
// class of omission fail here instead.
vi.mock('../src/nostr/profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/profile')>(),
  fetchProfile: vi.fn(async () => null)
}));

// `renderShell` boots asynchronously and starts work it does not await. Left running, that
// chain reaches `render()` after vitest has torn the file's jsdom down, which fails the run
// at random with `document is not defined` on whichever file was unlucky. Every test that
// boots a shell drains it before returning: `ready` for the boot chain, one macrotask for
// the `void`ed continuations hanging off it.
async function drainBoot(shell: ShellHandle): Promise<void> {
  await shell.ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// fake-indexeddb resolves on its own timers, and the live session opens across several of
// them, so the session tests wait on the condition rather than on a fixed sleep.
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

// Two exercises, one set each, so logging a set starts a rest that auto-advances to the
// next one. Saved before boot because `renderShell` reads the programs it finds.
async function startGuardSession(name: string): Promise<{ root: HTMLElement; shell: ShellHandle; cleanup: () => Promise<void> }> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const store = await WorkstrStore.open(LOCAL_NAMESPACE);
  await store.saveSheet({
    name,
    exercises: [
      { position: 0, exercise_slug: 'bench-press', exercise_name: 'Bench Press', sets: 1, reps: '8', rest: 60 },
      { position: 1, exercise_slug: 'barbell-row', exercise_name: 'Barbell Row', sets: 1, reps: '8', rest: 60 }
    ]
  });
  store.close();
  const shell = renderShell(root, { skipCatalogRefresh: true });
  await shell.ready;
  root.querySelector<HTMLElement>('[data-view="workouts"]')?.click();
  const sheetId = Number(shell.state.sheets.find((sheet) => sheet.name === name)?.id);
  const address = `local:${sheetId}`;
  root.querySelector<HTMLElement>(`[data-toggle-program="${address}"]`)?.click();
  root.querySelector<HTMLElement>(`[data-start-program="${address}"]`)?.click();
  await waitFor(() => !!root.querySelector('[data-session-reps="0"]'), 'the live session overlay to open');
  return { root, shell, cleanup: () => endSession(root, shell, sheetId) };
}

// fake-indexeddb is global per file, so the fixture is removed rather than left for the
// tests that follow. Ending the session also stops the elapsed and rest intervals, which
// would otherwise tick into the next test's jsdom.
async function endSession(root: HTMLElement, shell: ShellHandle, sheetId: number): Promise<void> {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  root.querySelector<HTMLElement>('#session-close')?.click();
  await waitFor(() => !root.querySelector('#session-overlay')?.classList.contains('open'), 'the session overlay to close');
  confirm.mockRestore();
  await shell.state.store?.deleteSheet(sheetId);
  await drainBoot(shell);
}

// A relay catalog answer, as `fetchCanonExercises` hands it over.
function catalogExercise(slug: string): Exercise {
  return {
    slug, name: slug, muscles: [], equipment: [], tags: [], instructions: [],
    favourite: false, source_type: 'nostr', status: 'active',
    created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z'
  };
}

// fake-indexeddb is global per file, so a test that seeds the library clears it again for
// the tests that follow.
async function cleanupExercises(shell: ShellHandle): Promise<void> {
  for (const exercise of await (shell.state.store?.listExercises() ?? [])) {
    await shell.state.store?.deleteExercise(Number(exercise.id));
  }
  await drainBoot(shell);
}

describe('shell', () => {
  // The signed-out cold-start count lives in `tests/render-budget.test.ts`, which owns the
  // budget for #178. This one stays here because it is about what the chip does, not only
  // how many renders it costs.
  //
  // Signing in adds one, for the cached profile. The relay's answer used to add a second -
  // the flash a moment after launch that rebuilt the topbar, the navigation, every image
  // and the current page to change a name and a picture. It patches the chip now (#184).
  it('renders the page four times when a profile is restored and refreshed', async () => {
    const pubkey = 'a'.repeat(64);
    localStorage.setItem('workstr.currentPubkey', pubkey);
    vi.mocked(fetchProfile).mockResolvedValueOnce({ pubkey, name: 'Trainer', picture: 'https://example.invalid/a.png' } as RelayProfile);
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root);
    await drainBoot(shell);
    localStorage.removeItem('workstr.currentPubkey');

    expect(shell.renders.recent.map((record) => record.reason)).toEqual([
      'boot-first-paint',
      'store-reload',
      'profile-cached',
      'boot-account-open'
    ]);
    expect(shell.renders.rebuilds).toBe(4);
  });

  // The frame is mounted once and pages are written into it. Everything named here used to
  // be destroyed and rebuilt for any state change at all, which is what made an avatar
  // flicker, an image redraw and an open modal vanish.
  it('keeps the frame standing while pages change under it', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    const frame = {
      topbar: root.querySelector('.topbar'),
      chip: root.querySelector('#account-chip'),
      sidebar: root.querySelector('.sidebar'),
      content: root.querySelector('.content'),
      host: root.querySelector('#page-host'),
      session: root.querySelector('#session-overlay'),
      modal: root.querySelector('#modal'),
      toast: root.querySelector('#toast')
    };
    const page = root.querySelector('#page-exercises');

    for (const view of ['workouts', 'statistics', 'settings', 'exercises']) {
      root.querySelector<HTMLElement>(`.sidebar [data-view="${view}"]`)?.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.topbar')).toBe(frame.topbar);
    expect(root.querySelector('#account-chip')).toBe(frame.chip);
    expect(root.querySelector('.sidebar')).toBe(frame.sidebar);
    expect(root.querySelector('.content')).toBe(frame.content);
    expect(root.querySelector('#page-host')).toBe(frame.host);
    expect(root.querySelector('#session-overlay')).toBe(frame.session);
    expect(root.querySelector('#modal')).toBe(frame.modal);
    expect(root.querySelector('#toast')).toBe(frame.toast);
    // The page itself is the thing that changed.
    expect(root.querySelector('#page-exercises')).not.toBe(page);
    await drainBoot(shell);
  });

  it('patches the navigation rather than rebuilding it', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    const item = root.querySelector<HTMLElement>('.sidebar [data-view="statistics"]')!;

    item.click();

    expect(root.querySelector('.sidebar [data-view="statistics"]')).toBe(item);
    expect(item.classList.contains('active')).toBe(true);
    expect(root.querySelector('.sidebar [data-view="exercises"]')?.classList.contains('active')).toBe(false);
    await drainBoot(shell);
  });

  // Navigation is delegated from the root and bound once. Bound per render, as it was, the
  // handlers would stack one copy per page the reader had visited.
  it('does not stack navigation handlers as pages come and go', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    for (const view of ['workouts', 'statistics', 'settings', 'exercises', 'workouts']) {
      root.querySelector<HTMLElement>(`.sidebar [data-view="${view}"]`)?.click();
    }
    const rebuiltBefore = shell.renders.rebuilds;

    root.querySelector<HTMLElement>('.sidebar [data-view="statistics"]')?.click();

    expect(shell.renders.rebuilds).toBe(rebuiltBefore + 1);
    await drainBoot(shell);
  });

  // The modal host is part of the frame now, so background state cannot take an open modal
  // away - and the close button is bound once rather than once per modal opened.
  it('leaves an open modal alone when the page under it is rendered', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    root.querySelector<HTMLElement>('#account-chip')?.click();
    await waitFor(() => root.querySelector('#modal')?.classList.contains('open') === true, 'the account modal');
    const modal = root.querySelector('#modal');
    const content = root.querySelector('#modal-content')?.innerHTML;

    root.querySelector<HTMLElement>('.sidebar [data-view="statistics"]')?.click();

    expect(root.querySelector('#modal')).toBe(modal);
    expect(root.querySelector('#modal')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('#modal-content')?.innerHTML).toBe(content);
    await drainBoot(shell);
  });

  // #188. Typing used to rebuild the topbar, the navigation, the page, every card and every
  // image, then find the input it had just destroyed and put the caret back. The caret hack
  // was the symptom; these assert the cause is gone - the input is the same node, and no
  // page render happened at all.
  it('redraws the library grid as the reader types, not the application', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.upsertExercise({ slug: 'bench-press', name: 'Bench Press', muscles: [], equipment: [], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    await store.upsertExercise({ slug: 'barbell-row', name: 'Barbell Row', muscles: [], equipment: [], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    store.close();
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    const input = root.querySelector<HTMLInputElement>('#ex-search')!;
    const grid = root.querySelector('#ex-grid');
    const toolbar = root.querySelector('.program-toolbar');
    const rebuiltBefore = shell.renders.rebuilds;

    input.value = 'bench';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('#ex-search')).toBe(input);
    expect(root.querySelector('#ex-grid')).toBe(grid);
    expect(root.querySelector('.program-toolbar')).toBe(toolbar);
    expect(grid?.textContent).toContain('Bench Press');
    expect(grid?.textContent).not.toContain('Barbell Row');

    // The delete path, which the caret hack hid bugs in as readily as the typing path.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('#ex-search')).toBe(input);
    expect(root.querySelector('#ex-grid')?.textContent).toContain('Barbell Row');
    expect(root.querySelector<HTMLElement>('#ex-empty')?.style.display).toBe('none');
    await cleanupExercises(shell);
  });

  it('says nothing matched without rebuilding the page to say it', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.upsertExercise({ slug: 'bench-press', name: 'Bench Press', muscles: [], equipment: [], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    store.close();
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    const input = root.querySelector<HTMLInputElement>('#ex-search')!;
    const empty = root.querySelector<HTMLElement>('#ex-empty')!;
    const rebuiltBefore = shell.renders.rebuilds;

    input.value = 'nothing matches this';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('#ex-empty')).toBe(empty);
    expect(empty.style.display).toBe('block');
    expect(empty.textContent).toContain('No exercises match');
    expect(root.querySelector('#ex-grid')?.children.length).toBe(0);
    await cleanupExercises(shell);
  });

  // The program lists are written the same way, and their cards carry nine actions bound to
  // them. Losing those on a patched list is the failure this guards: the card still works.
  it('redraws a program list as the reader types, and its cards still work', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.saveSheet({ name: 'Push Day', exercises: [{ position: 0, exercise_slug: 'bench-press', exercise_name: 'Bench Press', sets: 3, reps: '8', rest: 60 }] });
    await store.saveSheet({ name: 'Pull Day', exercises: [{ position: 0, exercise_slug: 'barbell-row', exercise_name: 'Barbell Row', sets: 3, reps: '8', rest: 60 }] });
    store.close();
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    root.querySelector<HTMLElement>('.sidebar [data-view="workouts"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = root.querySelector<HTMLInputElement>('#program-filter')!;
    const list = root.querySelector('#programs-list');
    const rebuiltBefore = shell.renders.rebuilds;

    input.value = 'push';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('#program-filter')).toBe(input);
    expect(root.querySelector('#programs-list')).toBe(list);
    expect(list?.textContent).toContain('Push Day');
    expect(list?.textContent).not.toContain('Pull Day');

    // A card written by the patch, not by a page render: its header still expands it.
    root.querySelector<HTMLElement>('#programs-list [data-toggle-program]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('#programs-list .workout-card')?.classList.contains('expanded')).toBe(true);
    for (const sheet of shell.state.sheets) await shell.state.store?.deleteSheet(Number(sheet.id));
    await drainBoot(shell);
  });

  // Selection is the other thing that used to redraw everything per tap. The bar is patched
  // in place, so the button that was tapped keeps its listener and its count is current.
  it('patches the selection bar instead of rebuilding the page on every tap', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const store = await WorkstrStore.open(LOCAL_NAMESPACE);
    await store.upsertExercise({ slug: 'bench-press', name: 'Bench Press', muscles: [], equipment: [], tags: [], instructions: [], favourite: false, source_type: 'manual', status: 'active' });
    store.close();
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    root.querySelector<HTMLElement>('#lib-select-toggle')?.click();
    const remove = root.querySelector<HTMLButtonElement>('#lib-delete-selected')!;
    const rebuiltBefore = shell.renders.rebuilds;

    root.querySelector<HTMLElement>('#ex-grid [data-slug="bench-press"]')?.click();

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('#lib-delete-selected')).toBe(remove);
    expect(remove.textContent).toBe('Delete (1)');
    expect(remove.disabled).toBe(false);
    await cleanupExercises(shell);
  });

  // A catalog refresh runs on every launch and reports twice - once to say it is loading,
  // once with the answer. Both used to rebuild whatever page the reader was on, for cards
  // that page does not show.
  it('lands a catalog answer on Settings without rebuilding it', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    let land: (exercises: Exercise[]) => void = () => {};
    vi.mocked(fetchCanonExercises).mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
    const shell = renderShell(root);
    // Boot renders while the catalog request is still out; the reader arrives on Settings
    // after that has settled, which is the state the relay answer lands into.
    await waitFor(() => shell.renders.recent.some((record) => record.reason === 'boot-account-open'), 'boot to settle');
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const page = root.querySelector('.settings-page');
    const rebuiltBefore = shell.renders.rebuilds;

    land([catalogExercise('barbell-row')]);
    await drainBoot(shell);

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('.settings-page')).toBe(page);
    expect(shell.state.discoverExercises.map((exercise) => exercise.slug)).toEqual(['barbell-row']);
    expect(shell.state.exerciseStatus).toBe('loaded 1 Workstr exercises');
  });

  // The other half of the same rule: the reader looking at Discover gets the cards, written
  // into the grid rather than by rebuilding the app around it.
  it('writes a catalog answer into the Discover grid when it is the page on screen', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    vi.mocked(fetchCanonExercises).mockResolvedValueOnce([catalogExercise('barbell-row')]);
    // Arriving on Discover with nothing in it starts the refresh, the way a reader does.
    root.querySelector<HTMLElement>('[data-parent="exercises"][data-subtab="discover"]')?.click();
    const grid = root.querySelector('#discover-grid');
    const rebuiltBefore = shell.renders.rebuilds;

    await drainBoot(shell);

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('#discover-grid')).toBe(grid);
    expect(grid?.textContent).toContain('barbell-row');
    expect(root.querySelector('#discover-status')?.textContent).toBe('loaded 1 Workstr exercises');
  });

  // The bug: the reader has settled on a page, and several seconds after launch a relay
  // answers with a name and a picture. Everything they were looking at was rebuilt for it.
  it('writes an arriving profile into the chip without rebuilding the page under the reader', async () => {
    const pubkey = 'b'.repeat(64);
    localStorage.setItem('workstr.currentPubkey', pubkey);
    let land: (profile: RelayProfile) => void = () => {};
    vi.mocked(fetchProfile).mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await shell.ready;
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();
    // Opening Settings starts the funding fetch, which renders again when it answers. Let
    // that finish first, or the render being counted is that one and not the profile's.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const card = root.querySelector('.account-card') as HTMLDetailsElement;
    card.open = true;
    const page = root.querySelector('.settings-page');
    const rebuiltBefore = shell.renders.rebuilds;

    land({ pubkey, name: 'Trainer', picture: 'https://example.invalid/t.png' } as RelayProfile);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shell.renders.rebuilds).toBe(rebuiltBefore);
    expect(root.querySelector('.settings-page')).toBe(page);
    expect(card.open).toBe(true);
    expect(root.querySelector('.connection-chip-label')?.textContent).toBe('Trainer');
    expect(root.querySelector('img.connection-avatar')?.getAttribute('src')).toBe('https://example.invalid/t.png');
    expect(root.querySelector('.account-card .settings-account-identity strong')?.textContent).toBe('Trainer');
    localStorage.removeItem('workstr.currentPubkey');
    await drainBoot(shell);
  });

  it('renders the app chrome and all views without a signer', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root);
    expect(root.querySelector('.sidebar')).toBeTruthy();
    expect(root.querySelector('#page-exercises')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-library')).toBeTruthy();
    expect(root.querySelector('#sub-exercises-discover')).toBeTruthy();
    // walk every nav view; each must render its page without throwing
    for (const view of ['workouts', 'statistics', 'settings', 'exercises']) {
      root.querySelector<HTMLElement>(`[data-view="${view}"]`)?.click();
      expect(root.querySelector('.page.active'), view).toBeTruthy();
    }
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();
    const settings = root.querySelector('.settings-page') as HTMLElement;
    expect(settings?.textContent).toContain('Account');
    expect(settings?.textContent).toContain('Beast Mode');
    expect(settings?.textContent).toContain('Create 1 local program');
    expect(settings?.textContent).toContain('Complete 5 workouts');
    expect(settings?.textContent).toContain('Train on 3 distinct local days');
    expect(settings?.textContent).toContain('Signed-in Nostr profile has a picture');
    expect(settings?.textContent).toContain('Data & Sync');
    expect(settings?.textContent).toContain('Training Preferences');
    expect(settings?.textContent).toContain('Support Workstr');
    expect(settings?.textContent).toContain('Payment Mode');
    expect(settings?.textContent).toContain('Lightning zaps');
    expect(settings?.querySelector('.advanced-settings:not([open])')).toBeTruthy();
    expect(settings?.querySelectorAll('.settings-category:not([open])')).toHaveLength(8);
    expect(settings?.querySelector('.account-card summary')?.textContent).toContain('Local only');
    expect(settings?.querySelector('.beast-mode-card summary')?.textContent).toContain('0/4 objectives');
    expect(settings?.querySelector('.account-card .terminal-mini')).toBeNull();
    expect(settings?.querySelector('#sign-in-settings')).toBeTruthy();
    expect(settings?.querySelector('#create-account-settings')).toBeNull();
    expect(settings?.querySelector('#restore-account-settings')).toBeNull();
    expect(settings?.querySelector('#enable-sync')).toBeNull();
    expect(settings?.querySelector('#auto-backup')).toBeNull();
    expect(settings?.textContent).not.toContain('Create sync account');
    expect(settings?.textContent).toContain('Use Account above');
    expect(settings?.textContent).toContain('Manual backup');
    expect(settings?.textContent).toContain('0 selected');
    expect(settings?.querySelector('.beast-mode-card [data-beast-mode-state="locked"]')).toBeTruthy();
    await drainBoot(shell);
  });

  it('swaps the wallet card for the Monero payment address when the rail changes', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await shell.ready;
    root.querySelector<HTMLElement>('[data-view="settings"]')?.click();

    const rail = (value: string) => root.querySelector<HTMLInputElement>(`input[name="payment-mode"][value="${value}"]`);
    const selected = () => root.querySelector('.payment-rail-option.selected .payment-rail-copy strong')?.textContent;
    const pick = (value: string) => {
      const input = rail(value)!;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Lightning is the default rail, and it is a choice rather than an off state.
    expect(rail('lightning')?.checked).toBe(true);
    expect(rail('monero')?.checked).toBe(false);
    expect(selected()).toBe('Lightning zaps');
    expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false);

    pick('monero');
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-payment-mode')).toBe('monero'));
    expect(selected()).toBe('Monero tips');
    expect(root.querySelector('.payment-mode-card .status-pill.ok')?.textContent).toBe('MONERO');

    // The wallet card is replaced, not deleted: nothing about the stored NWC connection
    // changes, and the section that takes its place is a payment address rather than a wallet.
    expect(root.querySelector('.nwc-card')).toBeNull();
    expect(root.querySelector('#nwc-connect')).toBeNull();
    expect(root.querySelector('#monero-address-section')).toBeTruthy();
    expect(root.querySelector('.payment-mode-card[open]')).toBeTruthy();
    expect(root.querySelector('#open-nwc-zap')).toBeNull();

    pick('lightning');
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-payment-mode')).toBe(false));
    expect(selected()).toBe('Lightning zaps');
    expect(root.querySelector('.nwc-card')).toBeTruthy();
    expect(root.querySelector('#nwc-connect')).toBeTruthy();
    expect(root.querySelector('#monero-address-section')).toBeNull();
    expect(root.querySelector('#open-nwc-zap')).toBeTruthy();
  });

  // A live session keeps state nothing but the DOM has: the reps and load typed into the
  // current set, and a running rest countdown. Background work used to rebuild the whole
  // shell under it - `boot()` awaits a catalog refresh, and the PWA relaunches on a fresh
  // boot, so reopening the app mid-workout put that rebuild inside the same two seconds as
  // the user's first tap. These two cover the rebuild staying away and the session surviving.
  it('keeps reps and load typed into a live set through a background render', async () => {
    const { root, shell, cleanup } = await startGuardSession('Typed Set Guard');
    const reps = root.querySelector<HTMLInputElement>('[data-session-reps="0"]')!;
    const load = root.querySelector<HTMLInputElement>('[data-session-weight="0"]')!;
    reps.value = '11';
    load.value = '62.5';

    // Changing the workouts sub-tab refreshes the program catalog, and the status line that
    // refresh paints sits in a panel that is already mounted behind the overlay.
    root.querySelector<HTMLElement>('[data-parent="workouts"][data-subtab="discover"]')?.click();
    await waitFor(() => shell.state.programStatus.startsWith('loaded'), 'the program catalog refresh');

    expect(root.querySelector('#session-overlay')?.classList.contains('open')).toBe(true);
    expect(root.querySelector('[data-session-reps="0"]')).toBe(reps);
    expect(reps.value).toBe('11');
    expect(load.value).toBe('62.5');
    expect(root.querySelector('#program-status')?.textContent).toContain('loaded 0 Workstr and creator programs');

    root.querySelector<HTMLElement>('[data-session-log="bench-press"]')?.click();
    await waitFor(() => (shell.state.activeSession?.sets.length ?? 0) > 0, 'the set to be logged');
    expect(shell.state.activeSession?.sets[0]).toMatchObject({ exerciseSlug: 'bench-press', reps: 11, weight: 62.5 });

    await cleanup();
  });

  it('keeps a running rest countdown through a background render', async () => {
    const { root, shell, cleanup } = await startGuardSession('Rest Guard');
    const now = vi.spyOn(Date, 'now');
    const started = Date.now();
    now.mockReturnValue(started);
    try {
      root.querySelector<HTMLElement>('[data-session-log="bench-press"]')?.click();
      await waitFor(() => !!root.querySelector('#session-rest-overlay')?.classList.contains('show'), 'the rest overlay');
      expect(root.querySelector('#session-rest-val')?.textContent).toBe('60');

      // Returning to the app reconciles the countdown against the clock, so what follows is
      // a real position rather than the number the markup ships with.
      now.mockReturnValue(started + 20_000);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.querySelector('#session-rest-val')?.textContent).toBe('40');

      shell.state.exerciseStatus = '';
      root.querySelector<HTMLElement>('[data-view="exercises"]')?.click();
      await waitFor(() => shell.state.exerciseStatus.startsWith('loaded'), 'the exercise catalog refresh');

      expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(true);
      expect(root.querySelector('#session-rest-val')?.textContent).toBe('40');

      // Still the same timer underneath: the adjust buttons move it, and running it out
      // still auto-advances to the exercise the rest was resting for.
      root.querySelector<HTMLElement>('[data-rest-adjust="-15"]')?.click();
      expect(root.querySelector('#session-rest-val')?.textContent).toBe('25');
      now.mockReturnValue(started + 46_000);
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => root.querySelector('#session-meta')?.textContent?.includes('Exercise 2/2') === true, 'the auto-advance');
      expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(false);
      expect(root.querySelector('#session-body')?.textContent).toContain('Barbell Row');

      root.querySelector<HTMLElement>('[data-session-log="barbell-row"]')?.click();
      await waitFor(() => !!root.querySelector('#session-rest-overlay')?.classList.contains('show'), 'the second rest overlay');
      shell.state.exerciseStatus = '';
      root.querySelector<HTMLElement>('[data-view="workouts"]')?.click();
      root.querySelector<HTMLElement>('[data-view="exercises"]')?.click();
      await waitFor(() => shell.state.exerciseStatus.startsWith('loaded'), 'the second exercise catalog refresh');
      expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(true);
      root.querySelector<HTMLElement>('#rest-skip')?.click();
      expect(root.querySelector('#session-rest-overlay')?.classList.contains('show')).toBe(false);
    } finally {
      now.mockRestore();
    }

    await cleanup();
  });

  // #187. The two tests above passed while the render was being refused outright: the
  // session survived because nothing was drawn at all. This one is the difference. The
  // render is allowed to happen - the count goes up - and the overlay comes through it as
  // the same nodes, because a render writes the page host and the overlay is not in it.
  it('renders the page under a live session without touching the overlay', async () => {
    const { root, shell, cleanup } = await startGuardSession('Overlay Identity Guard');
    const overlay = root.querySelector('#session-overlay');
    const body = root.querySelector('#session-body');
    const footer = root.querySelector('#session-footer');
    const reps = root.querySelector<HTMLInputElement>('[data-session-reps="0"]')!;
    const renderedBefore = shell.renders.rebuilds;

    root.querySelector<HTMLElement>('[data-parent="workouts"][data-subtab="discover"]')?.click();
    await waitFor(() => shell.state.programStatus.startsWith('loaded'), 'the program catalog refresh');

    expect(shell.renders.rebuilds).toBeGreaterThan(renderedBefore);
    expect(root.querySelector('#session-overlay')).toBe(overlay);
    expect(root.querySelector('#session-body')).toBe(body);
    expect(root.querySelector('#session-footer')).toBe(footer);
    expect(root.querySelector('[data-session-reps="0"]')).toBe(reps);
    // The page behind it was genuinely redrawn rather than skipped, which is what the old
    // hold used to prevent - the session outlasted a stale screen it then had to catch up.
    expect(root.querySelector('#program-status')?.textContent).toContain('loaded');

    // And the runner still owns it: logging a set works on the DOM the render left alone.
    root.querySelector<HTMLElement>('[data-session-log="bench-press"]')?.click();
    await waitFor(() => (shell.state.activeSession?.sets.length ?? 0) > 0, 'the set to be logged');

    await cleanup();
  });

  // The builder holds a name and a description in the DOM until it is saved, so a render
  // that redrew the modal threw away whatever had been typed but not committed. The modal
  // host is part of the frame and nothing re-renders its content behind the reader now.
  it('keeps the program builder and its typed edits through a background render', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    root.querySelector<HTMLElement>('.sidebar [data-view="workouts"]')?.click();
    root.querySelector<HTMLElement>('#new-program')?.click();
    await waitFor(() => !!root.querySelector('#sheet-name'), 'the program builder');
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    const desc = root.querySelector<HTMLInputElement>('#sheet-desc')!;
    name.value = 'Pull Day';
    name.dispatchEvent(new Event('input'));
    desc.value = 'not saved yet';
    desc.dispatchEvent(new Event('input'));
    const renderedBefore = shell.renders.rebuilds;

    root.querySelector<HTMLElement>('[data-parent="workouts"][data-subtab="discover"]')?.click();
    await waitFor(() => shell.state.programStatus.startsWith('loaded'), 'the program catalog refresh');

    expect(shell.renders.rebuilds).toBeGreaterThan(renderedBefore);
    expect(root.querySelector('#modal')?.classList.contains('open')).toBe(true);
    // Node identity, not the value: the builder mirrors what is typed into its own state,
    // so a modal that was redrawn would come back reading 'Pull Day' out of a different
    // input - with the caret, the selection and any half-finished row gone with the old one.
    expect(root.querySelector('#sheet-name')).toBe(name);
    expect(root.querySelector('#sheet-desc')).toBe(desc);
    expect(name.value).toBe('Pull Day');
    expect(desc.value).toBe('not saved yet');

    root.querySelector<HTMLElement>('#modal-close')?.click();
    await drainBoot(shell);
  });

  // Content and listeners both: a modal that came through looking right but had lost its
  // handlers would fail as a dead button, which is the shape of bug this increment is
  // about. The close button is bound with the frame, the tabs inside it are not.
  it('keeps an open modal working through a background render', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root, { skipCatalogRefresh: true });
    await drainBoot(shell);
    root.querySelector<HTMLElement>('#account-chip')?.click();
    await waitFor(() => root.querySelector('#modal')?.classList.contains('open') === true, 'the account modal');
    const content = root.querySelector('#modal-content')!;
    const markup = content.innerHTML;
    const renderedBefore = shell.renders.rebuilds;

    shell.state.exerciseStatus = '';
    root.querySelector<HTMLElement>('.sidebar [data-view="exercises"]')?.click();
    await drainBoot(shell);

    expect(shell.renders.rebuilds).toBeGreaterThan(renderedBefore);
    expect(root.querySelector('#modal-content')).toBe(content);
    expect(root.querySelector('#modal-content')?.innerHTML).toBe(markup);

    root.querySelector<HTMLElement>('#modal-close')?.click();
    expect(root.querySelector('#modal')?.classList.contains('open')).toBe(false);
    await drainBoot(shell);
  });

  // One flow, not two tabs: creating an account and reaching one you already have are not
  // symmetrical choices, and the tabs presented them as if they were - which is also how
  // "use a signer" ended up filed under Create, where it never belonged.
  it('opens one account flow from the signed-out chip', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app') as HTMLElement;
    const shell = renderShell(root);

    root.querySelector<HTMLElement>('#account-chip')?.click();
    const modal = root.querySelector('#modal.open') as HTMLElement;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Workstr account');
    expect(modal.querySelector('.auth-tabs')).toBeNull();
    expect(modal.querySelector('#auth-tab-login')).toBeNull();
    expect(modal.querySelector('#auth-tab-create')).toBeNull();

    // Everything on one page, in the order it should be considered in.
    expect(modal.querySelector('#create-local-account')).toBeTruthy();
    expect(modal.querySelector('#pair-new-device')).toBeTruthy();
    expect(modal.querySelector('#restore-local-account')).toBeTruthy();
    expect(modal.querySelector('#connect-remote-signer')).toBeTruthy();
    expect(modal.querySelector('#continue-local')).toBeTruthy();
    await drainBoot(shell);
  });

  // The account pill carries two independent states — is this identity connected, and which
  // rail pays creators — so most of its tests differ from each other by one field.
  const signedIn = (overrides: Partial<AppState> = {}): AppState => ({
    pubkey: 'f'.repeat(64),
    npub: null,
    profileName: 'Settebello',
    profilePicture: 'https://example.com/avatar.png',
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    monero: { status: 'idle', address: '' },
    signerType: 'local',
    view: 'exercises',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
    programZapAttempts: [],
    activeSession: null,
    finishedSessions: [],
    publishingSessionId: null,
    publishingStatus: null,
    editingId: null,
    filter: '',
    programFilter: '',
    expandedProgramAddress: null,
    exerciseStatus: '',
    programStatus: '',
    signInStatus: null,
    backup: { state: 'off', pending: 0 },
    expandedSessionId: null,
    history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [],
    sheets: [],
    library: [],
    librarySelect: { active: false, slugs: new Set() },
    discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [],
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    ...overrides
  } as AppState);

  // The account chip's own row: avatar wrapper, then name, then the payment medallion, then
  // the chevron. Slicing to the button keeps `₿` assertions off the Settings rail selector,
  // which renders the same glyph further down the same markup.
  const accountChip = (markup: string): string =>
    markup.slice(markup.indexOf('id="account-chip"'), markup.indexOf('</header>'));

  it('renders a compact kind 0 identity chip when signed in', () => {
    const markup = shellMarkup(signedIn());

    expect(markup).toContain('class="connection-avatar" src="https://example.com/avatar.png"');
    expect(markup).toContain('>Settebello</span>');
    expect(markup).toContain('aria-label="Signed in"');
    expect(markup).not.toContain('>Connected</span>');
    expect(markup).not.toContain('connection-chip-label">Account');
  });

  it('badges the avatar with the signed-in dot instead of floating it beside the name', () => {
    const chip = accountChip(shellMarkup(signedIn()));

    expect(chip).toContain('class="connection-avatar-wrap"');
    expect(chip).toContain('class="connection-identity-status" role="img" aria-label="Signed in"');
    // The status badge is inside the avatar wrapper, and the name is not.
    expect(chip.indexOf('connection-identity-status')).toBeLessThan(chip.indexOf('connection-chip-main'));
    // The old bare dot beside the username is gone.
    expect(chip).not.toContain('<span class="connection-dot" aria-label="Signed in">');
  });

  it('keeps the broken-avatar fallback adjacent to the image it replaces', () => {
    const chip = accountChip(shellMarkup(signedIn()));
    // `onerror` reaches the fallback through `nextElementSibling`, so nothing may sit between
    // them. The status badge has to come after the fallback, not before it.
    expect(chip).toContain('onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="connection-avatar fallback" hidden>S</span><span class="connection-identity-status"');
  });

  it('falls back to the profile initial and still badges the avatar', () => {
    const chip = accountChip(shellMarkup(signedIn({ profilePicture: null })));

    expect(chip).toContain('<span class="connection-avatar fallback">S</span>');
    expect(chip).toContain('connection-identity-status');
    expect(chip).not.toContain('<img class="connection-avatar"');
  });

  it('marks the account pill with the Lightning rail by default', () => {
    const chip = accountChip(shellMarkup(signedIn()));

    expect(chip).toContain('class="connection-payment-mark" role="img" aria-label="Lightning payments"');
    expect(chip).toContain('title="Lightning payment mode"');
    expect(chip).toContain('₿');
    expect(chip).not.toContain('monero-mark');
    // Informational only: the pill stays one button, so no nested control appears.
    expect(chip).not.toContain('<button');
    // The rail sits between the name and the chevron.
    expect(chip.indexOf('connection-payment-mark')).toBeLessThan(chip.indexOf('connection-chip-chevron'));
  });

  it('swaps the account pill to the Monero rail without changing its structure', () => {
    const chip = accountChip(shellMarkup(signedIn({ settings: { unit: 'kg', publicRelays: [], paymentMode: 'monero' } })));

    expect(chip).toContain('class="connection-payment-mark" role="img" aria-label="Monero payments"');
    expect(chip).toContain('title="Monero payment mode"');
    expect(chip).toContain('monero-mark');
    expect(chip).not.toContain('₿');
    // Same component, same identity badge — only the rail changed.
    expect(chip).toContain('connection-identity-status');
    expect(chip).toContain('class="connection-avatar-wrap"');
  });

  it('leaves a local account unbadged and without a payment rail', () => {
    const chip = accountChip(shellMarkup(signedIn({ pubkey: null, profileName: null, profilePicture: null })));

    expect(chip).toContain('connection-chip-label">Account');
    expect(chip).toContain('>Local</span>');
    expect(chip).not.toContain('aria-label="Signed in"');
    expect(chip).not.toContain('connection-identity-status');
    expect(chip).not.toContain('connection-payment-mark');
  });

  it('renders Beast Mode as unlocked in Settings from objective local state', () => {
    const markup = shellMarkup({
      pubkey: 'f'.repeat(64),
      npub: null,
      profileName: 'Settebello',
      profilePicture: 'https://example.com/avatar.png',
      profileNames: {},
      authorProfiles: {},
      store: null,
      settings: { unit: 'kg', publicRelays: [] },
      support: { status: 'idle', receipts: [] },
      nwc: { active: false, status: 'idle' },
      monero: { status: 'idle', address: '' },
      signerType: 'local',
      view: 'settings',
      subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
      exercises: [],
      programs: [],
      programZapAttempts: [],
      activeSession: null,
      finishedSessions: [
        { id: 1, sheetName: 'A', startedAt: '2026-08-01T10:00:00', finishedAt: '2026-08-01T10:30:00', exercises: [], sets: [] },
        { id: 2, sheetName: 'B', startedAt: '2026-08-01T11:00:00', finishedAt: '2026-08-01T11:30:00', exercises: [], sets: [] },
        { id: 3, sheetName: 'C', startedAt: '2026-08-02T10:00:00', finishedAt: '2026-08-02T10:30:00', exercises: [], sets: [] },
        { id: 4, sheetName: 'D', startedAt: '2026-08-03T10:00:00', finishedAt: '2026-08-03T10:30:00', exercises: [], sets: [] },
        { id: 5, sheetName: 'E', startedAt: '2026-08-03T11:00:00', finishedAt: '2026-08-03T11:30:00', exercises: [], sets: [] }
      ],
      publishingSessionId: null,
      publishingStatus: null,
      editingId: null,
      filter: '',
      programFilter: '',
      expandedProgramAddress: null,
      exerciseStatus: '',
      programStatus: '',
      signInStatus: null,
      backup: { state: 'off', pending: 0 },
      expandedSessionId: null,
      history: { monthKey: null, selectedDate: null },
      qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
      bodyEntries: [],
      sheets: [{ id: 1, slug: 'push-day', name: 'Push Day', notes: '', difficulty: '', tags: [], is_temporary: false, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', exercises: [] }],
      library: [],
      librarySelect: { active: false, slugs: new Set() },
      discoverSelect: { active: false, addresses: new Set() },
      discoverExercises: [],
      exFilter: { cat: '', muscle: '', diff: '', equip: '' },
      discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' }
    } as AppState);

    expect(markup).toContain('data-beast-mode-state="unlocked"');
    expect(markup).toContain('>UNLOCKED</span>');
    expect(markup).toContain('4/4 objectives');
  });
});

describe('signer app launch', () => {
  it('reuses the current context on mobile instead of opening a blank tab', () => {
    document.body.innerHTML = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.target).toBe('');
      expect(this.href).toBe('nostrconnect://example');
    });
    launchSignerUri('nostrconnect://example', true);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a')).toBeNull();
    click.mockRestore();
  });

  it('keeps the desktop signer flow in a separate tab', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.target).toBe('_blank');
    });
    launchSignerUri('nostrconnect://example', false);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe('boot migrates a pre-encryption recovery key', () => {
  it('moves the plaintext key out of localStorage without anyone asking for a signer', async () => {
    // Regression guard for a real gap: migration used to run only when something wanted a
    // signer, so opening the app to look at history left the plaintext key on disk. Boot
    // has to do it, whether or not the person signs in or syncs.
    const secret = 'ab'.repeat(32);
    localStorage.clear();
    await clearLocalSecret();
    localStorage.setItem(LEGACY_LOCAL_KEY_STORAGE, secret);

    document.body.innerHTML = '<div id="app"></div>';
    const shell = renderShell(document.getElementById('app') as HTMLElement, { skipCatalogRefresh: true });

    await vi.waitFor(() => expect(localStorage.getItem(LEGACY_LOCAL_KEY_STORAGE)).toBeNull());
    expect(await loadLocalSecret()).toBe(secret);
    await clearLocalSecret();
    await drainBoot(shell);
  });
});
