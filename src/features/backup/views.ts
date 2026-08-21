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

export function statusPill(state: BackupPanelState): { label: string; ok: boolean } {
  if (!state.enabled) return { label: 'off', ok: false };
  if (state.sync.state === 'error') return { label: 'needs attention', ok: false };
  if (state.sync.state === 'syncing') return { label: 'syncing', ok: true };
  return { label: state.sync.pending > 0 ? `${state.sync.pending} pending` : 'up to date', ok: true };
}

const PHASE_LABEL: Record<SyncProgress['phase'], string> = {
  restore: 'Checking encrypted backup…',
  prepare: 'Preparing local changes…',
  upload: 'Backing up local changes…'
};

const PHASE_DETAIL: Record<SyncProgress['phase'], string> = {
  restore: 'records checked',
  prepare: 'records queued',
  upload: 'records backed up'
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
  if (sync.state === 'error') return sync.lastError || 'Backup could not reach the relay. It will retry on its own.';
  if (sync.state === 'syncing') return 'Syncing now…';
  const pending = sync.pending > 0 ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload. ` : '';
  return `${pending}Last backup ${lastSyncLabel(sync.lastSyncAt)}.`;
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
  const toggle = `<label class="equip-option"><input type="checkbox" id="auto-backup" ${state.enabled ? 'checked' : ''} />Auto-backup to the Workstr relay</label>`;
  // Only shown once it is on: an explanation of syncing is noise to someone who has not
  // turned it on, and a manual button is a fallback, not the normal path.
  const live = state.enabled
    ? `<div class="backup-live" id="backup-status"><p class="section-help">${html(statusLine(state))}</p>${progressMarkup(state.sync.progress)}</div>
    <div class="web-empty-actions"><button id="sync-now" class="button ghost" ${state.sync.state === 'syncing' ? 'disabled' : ''}>Sync now</button></div>`
    : '';
  const explainer = state.signedIn
    ? 'Encrypted backup protects new V2-era workouts from this device forward, plus programs, body log and preferences. Older workouts already on this device stay local and are still included in JSON export. Only your key can read relay records — the relay stores ciphertext it cannot open.'
    : 'Backup needs an identity: new V2-era records are encrypted to your own key and signed by it. Turning this on takes you through sign-in first.';
  const localOnly = state.backup?.localOnlyHistoryCount ?? 0;
  const era = state.backup?.v2StartedAt ? ` Backup era started ${html(lastSyncLabel(state.backup.v2StartedAt))}.` : '';
  const eraLine = state.signedIn
    ? `<p class="section-help">Relay-backed V2 workouts sync from this backup era forward.${localOnly ? ` Local-only older workouts on this device: ${localOnly}.` : ''}${era} Use JSON export for a full local archive.</p>`
    : '';
  return `<div class="panel">
    <div class="panel-head"><span>Backup</span><span class="status-pill ${pill.ok ? 'ok' : ''}">${html(pill.label)}</span></div>
    <p class="section-help">${html(explainer)}</p>
    ${eraLine}
    ${toggle}
    ${live}
    <p class="section-help">Or keep your own copy: export your whole library, programs, history, body log and settings to a JSON file, or restore from one. Import replaces everything in this account.</p>
    <div class="web-empty-actions"><button id="export-data" class="button ghost">Export data</button><button id="import-data" class="button ghost">Import data…</button><input id="import-file" type="file" accept="application/json,.json" hidden /></div>
  </div>`;
}
