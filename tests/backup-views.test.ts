import { describe, expect, it } from 'vitest';
import { backupPanel, lastSyncLabel, progressDetail, progressPercent, statusLine, statusPill, type BackupPanelState } from '../src/features/backup/views';

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
    expect(statusLine(panelState({ sync }))).toBe('Backing up local changes…');
    expect(progressDetail(sync.progress)).toBe('12 of 400 records backed up');
    expect(progressPercent(sync.progress)).toBe(3);
  });

  it('names the check phase so decrypting unknown records is not mistaken for restoring data', () => {
    // Unknown encrypted events need signer decrypts before the app can know whether they
    // apply anything. The UI should describe that as checking, not restoring.
    expect(statusLine(panelState({ sync: { state: 'syncing', pending: 0, progress: { phase: 'restore', done: 3, total: 40 } } })))
      .toBe('Checking encrypted backup…');
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
    expect(line).toBe('Last backup just now.');
    expect(statusLine(panelState({ sync: { state: 'idle', pending: 1 } }))).toBe('1 change waiting to upload. Last backup not yet.');
  });
});

describe('the panel', () => {
  it('offers the toggle unchecked and hides sync controls when backup is off', () => {
    const html = backupPanel(panelState({ enabled: false }));
    expect(html).toContain('id="auto-backup"');
    expect(html).not.toContain('checked');
    expect(html).not.toContain('id="sync-now"');
    // Export and import are always there: data is never hostage to the relay.
    expect(html).toContain('id="export-data"');
    expect(html).toContain('id="import-data"');
  });

  it('tells a signed-out user that sign-in comes first', () => {
    expect(backupPanel(panelState({ signedIn: false, enabled: false }))).toContain('takes you through sign-in first');
  });

  it('shows the status line and sync-now once it is on', () => {
    const html = backupPanel(panelState({ sync: { state: 'idle', pending: 2 } }));
    expect(html).toContain('checked');
    expect(html).toContain('id="sync-now"');
    expect(html).toContain('2 changes waiting to upload');
  });

  it('renders active sync progress as a bar with secondary detail', () => {
    const html = backupPanel(panelState({ sync: { state: 'syncing', pending: 0, progress: { phase: 'restore', done: 2, total: 3 } } }));
    expect(html).toContain('Checking encrypted backup…');
    expect(html).toContain('class="backup-progress"');
    expect(html).toContain('aria-valuenow="67"');
    expect(html).toContain('2 of 3 records checked');
    expect(html).not.toContain('Restoring your training');
  });

  it('disables sync-now while a sync is already running', () => {
    expect(backupPanel(panelState({ sync: { state: 'syncing', pending: 0 } }))).toContain('id="sync-now" class="button ghost" disabled');
  });

  it('escapes a relay error rather than rendering it as markup', () => {
    const html = backupPanel(panelState({ sync: { state: 'error', pending: 1, lastError: '<img src=x onerror=alert(1)>' } }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
