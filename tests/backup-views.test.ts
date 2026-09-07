// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { backupPanel, backupSummary, lastSyncLabel, progressDetail, progressPercent, statusLine, statusPill, updateBackupStatus, type BackupPanelState } from '../src/features/backup/views';
import { createBackupController } from '../src/app/backup-controller';
import type { AppState } from '../src/app/state';
import type { SyncEngineContext, SyncStatus } from '../src/sync/engine';

// The controller only reaches a status through the engine it builds, so the engine is
// replaced with one that hands its `onStatus` back to the test.
const engines: SyncEngineContext[] = [];
vi.mock('../src/sync/engine', () => ({
  createSyncEngine: (ctx: SyncEngineContext) => {
    engines.push(ctx);
    return { start: async () => ctx, stop: () => {}, syncNow: async () => ({ state: 'idle', pending: 0 }), status: () => ({ state: 'idle', pending: 0 }) };
  }
}));

const panelState = (overrides: Partial<BackupPanelState> = {}): BackupPanelState => ({
  signedIn: true,
  enabled: true,
  sync: { state: 'idle', pending: 0 },
  ...overrides
});

describe('last sync label', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('reads in the unit that matters at each distance', () => {
    expect(lastSyncLabel(undefined, now)).toBe('not yet');
    expect(lastSyncLabel('2026-08-20T11:59:40.000Z', now)).toBe('just now');
    expect(lastSyncLabel('2026-08-20T11:45:00.000Z', now)).toBe('15 min ago');
    expect(lastSyncLabel('2026-08-20T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(lastSyncLabel('2026-08-20T04:00:00.000Z', now)).toBe('8 hours ago');
    // Past a day the only useful question is which day.
    expect(lastSyncLabel('2026-08-14T12:00:00.000Z', now)).toBe(new Date('2026-08-14T12:00:00.000Z').toLocaleDateString());
  });

  it('does not present a damaged timestamp as a time', () => {
    expect(lastSyncLabel('not a date', now)).toBe('not yet');
  });
});

describe('status pill', () => {
  it('keeps the collapsed data summary meaningful before account setup', () => {
    expect(backupSummary(panelState({ signedIn: false, enabled: false }))).toBe('Local only');
    expect(backupSummary(panelState({ sync: { state: 'idle', pending: 3 } }))).toBe('3 pending');
  });

  it('says off before it says anything else', () => {
    expect(statusPill(panelState({ enabled: false, sync: { state: 'error', pending: 4, lastError: 'boom' } })))
      .toEqual({ label: 'off', ok: false });
  });

  it('distinguishes up to date, pending work, syncing and trouble', () => {
    expect(statusPill(panelState())).toEqual({ label: 'up to date', ok: true });
    expect(statusPill(panelState({ sync: { state: 'idle', pending: 3 } }))).toEqual({ label: '3 pending', ok: true });
    expect(statusPill(panelState({ sync: { state: 'syncing', pending: 3 } }))).toEqual({ label: 'syncing', ok: true });
    expect(statusPill(panelState({ sync: { state: 'error', pending: 1, lastError: 'boom' } }))).toEqual({ label: 'needs attention', ok: false });
  });
});

describe('status line', () => {
  it('reports progress with calm phase names instead of a falling pending count', () => {
    // 400 pending falling to zero reads like a fault; the bar/detail reads like progress.
    const sync = { state: 'syncing' as const, pending: 388, progress: { phase: 'upload' as const, done: 12, total: 400 } };
    expect(statusLine(panelState({ sync }))).toBe('Syncing local changes…');
    expect(progressDetail(sync.progress)).toBe('12 of 400 records synced');
    expect(progressPercent(sync.progress)).toBe(3);
  });

  it('names the check phase so decrypting unknown records is not mistaken for restoring data', () => {
    // Unknown encrypted events need signer decrypts before the app can know whether they
    // apply anything. The UI should describe that as checking, not restoring.
    expect(statusLine(panelState({ sync: { state: 'syncing', pending: 0, progress: { phase: 'restore', done: 3, total: 40 } } })))
      .toBe('Checking encrypted sync…');
    expect(progressDetail({ phase: 'restore', done: 3, total: 40 })).toBe('3 of 40 records checked');
    expect(statusLine(panelState({ sync: { state: 'syncing', pending: 0, progress: { phase: 'prepare', done: 5, total: 9 } } })))
      .toBe('Preparing local changes…');
  });

  it('shows the error the engine reported', () => {
    expect(statusLine(panelState({ sync: { state: 'error', pending: 1, reconnecting: true, lastError: 'Your signer did not respond. Open your signer app, then tap Sync now.' } })))
      .toBe('Reconnecting to your signer…');
    expect(statusPill(panelState({ sync: { state: 'error', pending: 1, reconnecting: true } })))
      .toEqual({ label: 'reconnecting', ok: true });
    expect(statusLine(panelState({ sync: { state: 'error', pending: 2, lastError: 'Relay rejected 1 record(s)' } })))
      .toBe('Relay rejected 1 record(s)');
  });

  it('always answers when the last backup happened', () => {
    const line = statusLine(panelState({ sync: { state: 'idle', pending: 0, lastSyncAt: new Date().toISOString() } }));
    expect(line).toBe('Last synced just now.');
    expect(statusLine(panelState({ sync: { state: 'idle', pending: 1 } }))).toBe('1 change waiting to sync. Last synced not yet.');
  });
});

describe('the panel', () => {
  it('offers a turn-on action and hides sync controls when sync is off', () => {
    const html = backupPanel(panelState({ enabled: false }));
    expect(html).toContain('id="enable-sync"');
    expect(html).toContain('Turn on sync');
    expect(html).not.toContain('id="auto-backup"');
    expect(html).not.toContain('id="sync-now"');
    // Export and import are always there: data is never hostage to the relay.
    expect(html).toContain('id="export-data"');
    expect(html).toContain('id="import-data"');
    expect(html).toContain('Manual backup');
  });

  it('tells a signed-out user that sign-in comes first', () => {
    const html = backupPanel(panelState({ signedIn: false, enabled: false }));
    expect(html).toContain('Sign in to protect new training');
    expect(html).not.toContain('id="auto-backup"');
  });

  it('shows the status line and sync-now once it is on', () => {
    const html = backupPanel(panelState({ sync: { state: 'idle', pending: 2 } }));
    expect(html).toContain('checked');
    expect(html).toContain('id="sync-now"');
    expect(html).toContain('2 changes waiting to sync');
  });

  it('renders active sync progress as a bar with secondary detail', () => {
    const html = backupPanel(panelState({ sync: { state: 'syncing', pending: 0, progress: { phase: 'restore', done: 2, total: 3 } } }));
    expect(html).toContain('Checking encrypted sync…');
    expect(html).toContain('class="backup-progress"');
    expect(html).toContain('aria-valuenow="67"');
    expect(html).toContain('2 of 3 records checked');
    expect(html).not.toContain('Restoring your training');
  });

  it('disables sync-now while a sync is already running', () => {
    expect(backupPanel(panelState({ sync: { state: 'syncing', pending: 0 } }))).toContain('id="sync-now" class="button" disabled');
  });

  it('escapes a relay error rather than rendering it as markup', () => {
    const html = backupPanel(panelState({ sync: { state: 'error', pending: 1, lastError: '<img src=x onerror=alert(1)>' } }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('patching the status into a mounted card', () => {
  const mount = (state: BackupPanelState): HTMLElement => {
    document.body.innerHTML = `<div id="app"><div class="page settings-page">
      <img id="unrelated" alt="">
      ${backupPanel(state)}
    </div></div>`;
    return document.getElementById('app') as HTMLElement;
  };

  it('rewrites the pill, the collapsed summary and the status line', () => {
    const root = mount(panelState());
    expect(root.querySelector('.data-sync-card .status-pill')?.textContent).toBe('up to date');
    updateBackupStatus(root, panelState({ sync: { state: 'syncing', pending: 3 } }));
    expect(root.querySelector('.data-sync-card .status-pill')?.textContent).toBe('syncing');
    expect(root.querySelector('.data-sync-card summary .settings-category-copy small')?.textContent).toBe('syncing');
    expect(root.querySelector('#backup-status')?.textContent).toContain('Syncing now…');
  });

  // The bug this guards: a status arriving while the reader has Data & Sync open used to
  // rebuild the root, and the card they were reading closed under them.
  it('leaves an expanded card open and every other node in place', () => {
    const root = mount(panelState());
    const card = root.querySelector<HTMLDetailsElement>('.data-sync-card')!;
    const image = root.querySelector('#unrelated')!;
    card.open = true;
    updateBackupStatus(root, panelState({ sync: { state: 'syncing', pending: 1, progress: { phase: 'upload', done: 2, total: 8 } } }));
    expect(card.open).toBe(true);
    expect(root.querySelector('.data-sync-card')).toBe(card);
    expect(root.querySelector('#unrelated')).toBe(image);
  });

  it('draws progress while a phase runs and takes it away when it ends', () => {
    const root = mount(panelState());
    updateBackupStatus(root, panelState({ sync: { state: 'syncing', pending: 1, progress: { phase: 'upload', done: 2, total: 8 } } }));
    expect(root.querySelector('.backup-progress')?.getAttribute('aria-valuenow')).toBe('25');
    expect(root.querySelector('.backup-progress-detail')?.textContent).toBe('2 of 8 records synced');
    updateBackupStatus(root, panelState({ sync: { state: 'idle', pending: 0, lastSyncAt: '2026-09-06T12:00:00.000Z' } }));
    expect(root.querySelector('.backup-progress')).toBeNull();
  });

  it('keeps sync-now unavailable for exactly as long as a sync is running', () => {
    const root = mount(panelState());
    updateBackupStatus(root, panelState({ sync: { state: 'syncing', pending: 1 } }));
    expect(root.querySelector<HTMLButtonElement>('#sync-now')?.disabled).toBe(true);
    updateBackupStatus(root, panelState());
    expect(root.querySelector<HTMLButtonElement>('#sync-now')?.disabled).toBe(false);
  });

  it('escapes a relay error rather than patching it in as markup', () => {
    const root = mount(panelState());
    updateBackupStatus(root, panelState({ sync: { state: 'error', pending: 0, lastError: '<img src=x onerror="alert(1)">' } }));
    expect(root.querySelector('#backup-status img')).toBeNull();
    expect(root.querySelector('#backup-status')?.textContent).toContain('<img src=x');
  });

  it('reports that there was nothing on screen when Settings is not the current view', () => {
    document.body.innerHTML = '<div id="app"><div class="page library-page"></div></div>';
    expect(updateBackupStatus(document.getElementById('app') as HTMLElement, panelState())).toBe(false);
  });
});

describe('what a sync status redraws', () => {
  // The status arrives many times per pass. Redrawing the root for each one was what
  // collapsed Settings categories and visibly refreshed the page the user was on.
  it('patches the mounted card instead of rebuilding the root', async () => {
    engines.length = 0;
    document.body.innerHTML = `<div id="app"><div class="page settings-page">${backupPanel(panelState())}</div></div>`;
    const root = document.getElementById('app') as HTMLElement;
    const card = root.querySelector<HTMLDetailsElement>('.data-sync-card')!;
    card.open = true;
    const render = vi.fn();
    const state = {
      pubkey: 'ab'.repeat(32),
      store: {} as never,
      settings: { backup: { enabled: true } },
      backup: { state: 'off', pending: 0 }
    } as unknown as AppState;
    const controller = createBackupController({
      root, state, render, toast: vi.fn(), getSigner: async () => null, requestSignIn: vi.fn(), bindCard: vi.fn()
    });
    await controller.resume();

    const status: SyncStatus = { state: 'syncing', pending: 4, progress: { phase: 'upload', done: 1, total: 4 } };
    engines.at(-1)!.onStatus(status);

    expect(state.backup).toBe(status);
    expect(render).not.toHaveBeenCalled();
    expect(root.querySelector('.data-sync-card')).toBe(card);
    expect(card.open).toBe(true);
    expect(root.querySelector('.data-sync-card .status-pill')?.textContent).toBe('syncing');
    expect(root.querySelector('#backup-status')?.textContent).toContain('Syncing local changes…');
  });
});
