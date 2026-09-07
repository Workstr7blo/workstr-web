import type { BackupSettings } from '../../core/types';
import type { SyncProgress, SyncStatus } from '../../sync/engine';
import type { AppState } from '../../app/state';
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

// The pill beside it already carries the state - this returned `statusPill().label`
// verbatim for every signed-in case, so the row said "off / OFF" and "3 pending / 3
// PENDING". The line says what the card is for instead, and the pill stays the one place
// the state is read from.
export function backupSummary(state: BackupPanelState): string {
  return state.signedIn
    ? 'Back up, sync, and move your training data'
    : 'Sign in to back up and sync this device';
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

// The card is written twice: as markup by `backupPanel`, and patched in place by
// `updateBackupStatus` when a status arrives. Both read the panel's inputs through here, or
// a patched card would drift from the rendered one.
export function backupPanelState(state: AppState): BackupPanelState {
  return {
    signedIn: Boolean(state.pubkey),
    enabled: Boolean(state.settings.backup?.enabled),
    sync: state.backup,
    backup: state.settings.backup
  };
}

export function backupPanel(state: BackupPanelState): string {
  const pill = statusPill(state);
  const summary = backupSummary(state);
  return `<details class="settings-category data-sync-card" data-settings-section="sync">
    <summary><span class="settings-category-copy"><strong>Data &amp; Sync</strong><small>${html(summary)}</small></span><span class="status-pill ${pill.ok ? 'ok' : ''}">${html(pill.label)}</span></summary>
    <div class="settings-category-body">${backupCardBody(state)}</div>
  </details>`;
}

// The body alone, so turning sync on or off can be written into the card that is already
// standing. Everything above it - the `<details>` element itself, and with it whether the
// reader had the card expanded - is not part of this.
export function backupCardBody(state: BackupPanelState): string {
  const localOnly = state.backup?.localOnlyHistoryCount ?? 0;
  const eraLine = state.signedIn && state.enabled && localOnly > 0
    ? `<div class="settings-subtle-row"><span>Local-only older workouts</span><strong>${localOnly}</strong></div>`
    : '';
  const syncCopy = !state.signedIn
    ? 'Sign in to protect new training across devices.'
    : state.enabled
      ? 'Encrypted backup for new training.'
      : 'Protect new training across devices.';
  const syncAction = !state.signedIn
    ? '<span class="settings-muted-action">Use Account above</span>'
    : state.enabled
      ? `<label class="settings-switch"><input type="checkbox" id="auto-backup" checked />Auto-sync</label><button id="sync-now" class="button" ${state.sync.state === 'syncing' ? 'disabled' : ''}>Sync now</button>`
      : '<button id="enable-sync" class="button primary">Turn on sync</button>';
  const live = state.enabled
    ? `<div class="backup-live" id="backup-status"><span class="settings-live-label">${html(statusLine(state))}</span>${progressMarkup(state.sync.progress)}</div>${eraLine}`
    : '';
  const olderNote = state.signedIn && state.enabled && localOnly > 0
    ? `<p class="section-help">Those older workouts stay on this device and are included when you export JSON.</p>`
    : '';
  return `
      <section class="settings-control-group sync-control-group" aria-label="Sync">
        <div class="settings-control-heading"><span><strong>Sync</strong><small>${html(syncCopy)}</small></span></div>
        <div class="settings-row-main sync-control-row"><div><strong>Auto-sync</strong><small>${state.enabled ? 'Keep this device current automatically.' : 'Turn on encrypted backup.'}</small></div><div class="settings-row-actions">${syncAction}</div></div>
        ${live}
        ${olderNote}
      </section>
      <section class="settings-control-group manual-backup-group" aria-label="Manual backup">
        <div class="settings-control-heading"><span><strong>Manual backup</strong><small>A portable archive for this device.</small></span></div>
        <div class="settings-row-main manual-backup-row">
          <div><strong>Export or import</strong><small>JSON includes all local training data.</small></div>
          <div class="settings-row-actions"><button id="export-data" class="button">Export JSON</button><button id="import-data" class="button">Import JSON…</button><input id="import-file" type="file" accept="application/json,.json" hidden /></div>
        </div>
      </section>`;
}

// Turning sync on or off changes which controls the card has, not only what they say, so
// the status patch above cannot carry it - but a render cannot either, because the reader
// is inside this card when they press the switch and a rebuilt page would close it under
// them. The body is written into the standing `<details>`, and the caller rebinds the
// controls it just replaced.
//
// False when the card is not mounted, which is every view except Settings.
export function updateBackupCard(root: ParentNode, state: BackupPanelState): boolean {
  const card = root.querySelector('.data-sync-card');
  const body = card?.querySelector(':scope > .settings-category-body');
  if (!card || !body) return false;
  const pill = statusPill(state);
  const pillEl = card.querySelector(':scope > summary .status-pill');
  if (pillEl) {
    pillEl.textContent = pill.label;
    pillEl.classList.toggle('ok', pill.ok);
  }
  const summary = card.querySelector(':scope > summary .settings-category-copy small');
  if (summary) summary.textContent = backupSummary(state);
  body.innerHTML = backupCardBody(state);
  return true;
}

// The sync engine reports a status for every phase and every step within it, so a single
// launch produces a stream of them. Each one used to redraw the root: the topbar, the
// avatar, the navigation, every exercise image and whichever page the user was actually on
// were all rebuilt so that one line of text inside one Settings card could change. Only the
// parts the status feeds are written here, and everything else on screen is left alone.
//
// False when the card is not mounted, which is every view except Settings. The state has
// already been updated by then and there is nothing on screen to correct; the card is built
// from that state the moment the reader navigates to it.
export function updateBackupStatus(root: ParentNode, state: BackupPanelState): boolean {
  const card = root.querySelector('.data-sync-card');
  if (!card) return false;
  const pill = statusPill(state);
  const pillEl = card.querySelector(':scope > summary .status-pill');
  if (pillEl) {
    pillEl.textContent = pill.label;
    pillEl.classList.toggle('ok', pill.ok);
  }
  const summary = card.querySelector(':scope > summary .settings-category-copy small');
  if (summary) summary.textContent = backupSummary(state);
  // The one control whose availability tracks the status rather than the settings.
  const syncNow = card.querySelector<HTMLButtonElement>('#sync-now');
  if (syncNow) syncNow.disabled = state.sync.state === 'syncing';
  // Absent while sync is off, which is also when there is no status worth reporting.
  const live = card.querySelector('#backup-status');
  if (live) live.innerHTML = `<span class="settings-live-label">${html(statusLine(state))}</span>${progressMarkup(state.sync.progress)}`;
  return true;
}
