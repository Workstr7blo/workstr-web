import type { BackupSettings } from '../../core/types';
import type { SyncProgress, SyncStatus } from '../../sync/engine';
import { html } from '../../app/format';

export interface BackupPanelState {
  signedIn: boolean;
  enabled: boolean;
  sync: SyncStatus;
  backup?: BackupSettings;
}

// Minutes, then hours, then the date. Nobody needs "backed up 4 days and 3 hours ago" —
// past a day the only useful question is which day.
export function lastSyncLabel(iso: string | undefined, now = new Date()): string {
  if (!iso) return 'not yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'not yet';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString();
}

// The day backup started holding this device's history, as a date. Unlike `lastSyncLabel`
// this never goes relative: it marks a boundary the user may need to reason about months
// later, and "3 months ago" is not something you can line up against a training log.
export function startedOnLabel(iso: string | undefined): string {
  if (!iso) return 'backup was switched on';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'backup was switched on';
  return then.toLocaleDateString();
}

export function statusPill(state: BackupPanelState): { label: string; ok: boolean } {
  if (!state.enabled) return { label: 'off', ok: false };
  if (state.sync.state === 'error') return state.sync.reconnecting
    ? { label: 'reconnecting', ok: true }
    : { label: 'needs attention', ok: false };
  if (state.sync.state === 'syncing') return { label: 'syncing', ok: true };
  return { label: state.sync.pending > 0 ? `${state.sync.pending} pending` : 'up to date', ok: true };
}

const PHASE_LABEL: Record<SyncProgress['phase'], string> = {
  restore: 'Checking encrypted sync…',
  prepare: 'Preparing local changes…',
  upload: 'Syncing local changes…'
};

const PHASE_DETAIL: Record<SyncProgress['phase'], string> = {
  restore: 'records checked',
  prepare: 'records queued',
  upload: 'records synced'
};

export function progressPercent(progress: SyncProgress): number {
  if (!Number.isFinite(progress.total) || progress.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)));
}

export function progressDetail(progress: SyncProgress): string {
  return `${progress.done} of ${progress.total} ${PHASE_DETAIL[progress.phase]}`;
}

// The one line that answers "is my training safe". The restore phase is deliberately named
// as a check: the app must decrypt unknown backup records before it can tell whether any of
// them actually restore data. "Restoring" is reserved for a completed pass that changed the
// local database.
export function statusLine(state: BackupPanelState): string {
  const { sync } = state;
  if (sync.progress) return PHASE_LABEL[sync.progress.phase];
  // A stalled signer with a retry seconds away is not something to hand the user a job
  // over: the connection is being rebuilt, which is the same thing tapping Sync now does.
  if (sync.state === 'error' && sync.reconnecting) return 'Reconnecting to your signer…';
  if (sync.state === 'error') return sync.lastError || 'Sync could not reach the relay. It will retry on its own.';
  if (sync.state === 'syncing') return 'Syncing now…';
  const pending = sync.pending > 0 ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync. ` : '';
  return `${pending}Last synced ${lastSyncLabel(sync.lastSyncAt)}.`;
}

function progressMarkup(progress: SyncProgress | undefined): string {
  if (!progress) return '';
  const width = progressPercent(progress);
  return `<div class="backup-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}">
      <span style="width:${width}%"></span>
    </div>
    <p class="backup-progress-detail">${html(progressDetail(progress))}</p>`;
}

export function backupPanel(state: BackupPanelState): string {
  const pill = statusPill(state);
  const localOnly = state.backup?.localOnlyHistoryCount ?? 0;
  const eraLine = state.signedIn && state.enabled && localOnly > 0
    ? `<div class="settings-subtle-row"><span>Local-only older workouts</span><strong>${localOnly}</strong></div>`
    : '';
  const syncCopy = !state.signedIn
    ? 'Sign in to sync across devices.'
    : state.enabled
      ? 'Encrypted across your devices.'
      : 'Keep training current across devices.';
  const syncAction = !state.signedIn
    ? '<span class="settings-muted-action">Use Account above</span>'
    : state.enabled
      ? `<label class="settings-switch"><input type="checkbox" id="auto-backup" checked />Auto-sync</label><button id="sync-now" class="button ghost" ${state.sync.state === 'syncing' ? 'disabled' : ''}>Sync now</button>`
      : '<button id="enable-sync" class="button primary">Turn on sync</button>';
  const live = state.enabled
    ? `<div class="backup-live" id="backup-status"><p class="section-help">${html(statusLine(state))}</p>${progressMarkup(state.sync.progress)}</div>${eraLine}`
    : '';
  const olderNote = state.signedIn && state.enabled && localOnly > 0
    ? `<p class="section-help">Those older workouts stay on this device and are included when you export JSON.</p>`
    : '';
  return `<div class="panel settings-card data-sync-card">
    <div class="panel-head"><span>Data &amp; Sync</span><span class="status-pill ${pill.ok ? 'ok' : ''}">${html(pill.label)}</span></div>
    <div class="settings-row-main">
      <div><strong>Encrypted sync</strong><small>${html(syncCopy)}</small></div>
      <div class="settings-row-actions">${syncAction}</div>
    </div>
    ${live}
    ${olderNote}
    <div class="settings-row-main manual-backup-row">
      <div><strong>Manual backup</strong><small>Export or import a full JSON archive.</small></div>
      <div class="settings-row-actions"><button id="export-data" class="button ghost">Export JSON</button><button id="import-data" class="button ghost">Import JSON…</button><input id="import-file" type="file" accept="application/json,.json" hidden /></div>
    </div>
  </div>`;
}
