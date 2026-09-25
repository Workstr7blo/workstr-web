// The Tip Jar backup controls, rendered into the Data & Sync card rather than a wallet card of
// their own (#261). Backing up the Tip Jar is the same job as backing up training - one card
// answers "can I get my things back" - but the two artifacts stay separate, because one is a
// training log and the other is spend authority.
//
// Markup only. The cryptography is in `wallet-backup.ts` and the workflow is in
// `src/app/tip-jar-backup-controller.ts`.
import { html } from '../../app/format';
import type { AppState } from '../../app/state';
import type { MoneroWalletUiState, TipJarBackupUiState } from './types';
import { TIP_JAR_BACKUP_EXTENSION, TIP_JAR_BACKUP_MIN_PASSWORD } from './wallet-backup';

const IDLE: TipJarBackupUiState = { panel: 'idle', advanced: false, busy: false };

export function tipJarBackupState(state: AppState): TipJarBackupUiState {
  return state.tipJarBackup ?? IDLE;
}

// Whether this account has a Tip Jar wallet to back up. `stored` is what the vault answered;
// until it has answered, neither exporting nor restoring is offered, because both would be
// guesses about something that holds money.
function storedWallet(wallet: MoneroWalletUiState | undefined): boolean {
  return Boolean(wallet?.stored || wallet?.snapshot);
}

function checked(wallet: MoneroWalletUiState | undefined): boolean {
  return wallet?.stored !== undefined || wallet?.status === 'missing';
}

// "Last exported 16 Sep 2026", never "protected". Workstr writes the file and then knows
// nothing more about it - whether it still exists, whether the password is remembered - so the
// copy reports the one fact it has.
export function lastExportLabel(iso: string | undefined): string {
  if (!iso) return 'Not backed up yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Not backed up yet';
  return `Last exported ${then.toLocaleDateString()}`;
}

function message(ui: TipJarBackupUiState): string {
  if (!ui.message) return '';
  return `<p class="section-help ${ui.messageKind === 'bad' ? 'bad' : ui.messageKind === 'ok' ? 'ok' : ''}" id="tip-jar-backup-message" role="status">${html(ui.message)}</p>`;
}

function exportForm(ui: TipJarBackupUiState): string {
  const busy = ui.busy ? ' disabled' : '';
  return `<form class="tip-jar-backup-form" id="tip-jar-backup-export-form">
    <p class="section-help">Choose a password for this backup file. You need it to restore the Tip Jar.</p>
    <label><span>Backup password</span><input id="tip-jar-backup-password" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" minlength="${TIP_JAR_BACKUP_MIN_PASSWORD}" aria-describedby="tip-jar-backup-password-help"${busy} /></label>
    <p class="section-help" id="tip-jar-backup-password-help">Use at least ${TIP_JAR_BACKUP_MIN_PASSWORD} characters. A passphrase of several words works well. This password cannot be recovered.</p>
    <label><span>Confirm password</span><input id="tip-jar-backup-password-confirm" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"${busy} /></label>
    <div class="settings-row-actions">
      <button class="button" type="submit"${busy}>Create encrypted backup</button>
      <button class="button quiet" type="button" id="tip-jar-backup-cancel"${busy}>Cancel</button>
    </div>
  </form>`;
}

function restoreForm(ui: TipJarBackupUiState, replacing: boolean): string {
  const busy = ui.busy ? ' disabled' : '';
  return `<form class="tip-jar-backup-form" id="tip-jar-backup-restore-form">
    <p class="section-help">${replacing
      ? 'Restoring replaces the Tip Jar wallet on this device. The file is decrypted here and never leaves it.'
      : 'Choose your backup file and enter its password. The file is decrypted on this device and never leaves it.'}</p>
    <div class="settings-row-actions tip-jar-backup-file-row">
      <button class="button" type="button" id="tip-jar-backup-choose"${busy}>Choose backup file</button>
      <span class="tip-jar-backup-file">${ui.fileName ? html(ui.fileName) : 'No file chosen'}</span>
    </div>
    <input id="tip-jar-backup-file" type="file" accept=".${TIP_JAR_BACKUP_EXTENSION},application/json" hidden />
    <label><span>Backup password</span><input id="tip-jar-backup-restore-password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"${busy} /></label>
    <div class="settings-row-actions">
      <button class="button" type="submit"${busy}>Restore</button>
      <button class="button quiet" type="button" id="tip-jar-backup-cancel"${busy}>Cancel</button>
    </div>
  </form>`;
}

// Quiet by design: a closed line of text, not a second card and not a warning panel. The
// phrase behind it is the one thing in Workstr that can move money on its own, so opening the
// disclosure is not enough to show it - that takes a second, deliberate tap.
function advancedRecovery(state: AppState, ui: TipJarBackupUiState, stored: boolean): string {
  const wallet = state.moneroWallet;
  const busy = ui.busy ? ' disabled' : '';
  const phrase = wallet?.backup;
  const seedRows = stored
    ? `<div class="settings-subtle-row"><span>Recovery phrase</span><button class="button small" type="button" id="tip-jar-reveal-phrase"${busy}>${phrase ? 'Hide' : 'Reveal'}</button></div>
    ${phrase ? `<div class="tip-jar-recovery-phrase">
      <p class="section-help bad">Anyone with these words can spend this Tip Jar. Write them down offline and hide them when you are done.</p>
      <code>${html(phrase.seed)}</code>
    </div>` : ''}
    <div class="settings-subtle-row"><span>Restore height</span><strong>${html(String(phrase?.restoreHeight ?? wallet?.snapshot?.metadata.restoreHeight ?? '—'))}</strong></div>`
    : '';
  return `<details class="settings-inline-advanced tip-jar-recovery"${ui.advanced ? ' open' : ''}>
    <summary>Advanced recovery</summary>
    <div class="tip-jar-recovery-body">
      <p class="section-help">These details can restore your Tip Jar in any compatible Monero wallet.</p>
      ${seedRows}
      <form class="tip-jar-backup-form" id="tip-jar-seed-restore-form">
        <label><span>Restore from recovery phrase</span><textarea id="tip-jar-seed" rows="3" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Monero recovery phrase"${busy}></textarea></label>
        <label><span>Restore height</span><input id="tip-jar-seed-height" type="number" min="0" step="1" inputmode="numeric" placeholder="blank scans from the start"${busy} /></label>
        <p class="section-help">Leave the height blank if you do not know it. The whole chain is scanned then, so no earlier payment is missed, and it can take a long time.</p>
        <div class="settings-row-actions"><button class="button" type="submit"${busy}>${stored ? 'Replace and restore' : 'Restore from phrase'}</button></div>
      </form>
    </div>
  </details>`;
}

export function tipJarBackupBody(state: AppState): string {
  const ui = tipJarBackupState(state);
  if (state.deviceVault !== 'unlocked') {
    return '<p class="section-help">Unlock Workstr to back up or restore your Tip Jar.</p>';
  }
  const stored = storedWallet(state.moneroWallet);
  if (!stored && !checked(state.moneroWallet)) return '<p class="section-help">Checking this device for a Tip Jar…</p>';
  const actions = stored
    ? `<button class="data-sync-row data-sync-nav-row" type="button" id="tip-jar-backup-export"><span class="data-sync-row-copy"><strong>Create encrypted backup</strong><small>Save Tip Jar information to an encrypted ${TIP_JAR_BACKUP_EXTENSION} file.</small></span><span class="data-sync-chevron" aria-hidden="true">›</span></button><button class="data-sync-row data-sync-nav-row" type="button" id="tip-jar-backup-restore"><span class="data-sync-row-copy"><strong>Restore from backup</strong><small>Choose an encrypted Tip Jar backup file.</small></span><span class="data-sync-chevron" aria-hidden="true">›</span></button>`
    : '<button class="data-sync-row data-sync-nav-row" type="button" id="tip-jar-backup-restore"><span class="data-sync-row-copy"><strong>Restore from backup</strong><small>Choose an encrypted Tip Jar backup file.</small></span><span class="data-sync-chevron" aria-hidden="true">›</span></button>';
  const panel = ui.panel === 'export' && stored ? exportForm(ui) : ui.panel === 'restore' ? restoreForm(ui, stored) : '';
  const intro = stored ? html(lastExportLabel(ui.exportedAt).replace('Last exported', 'Last backup:')) : 'Restore one from a backup file or a recovery phrase.';
  return `<p class="section-help">Create or restore an encrypted backup of your Tip Jar information.</p>
    <div class="data-sync-detail-actions">${actions}</div>
    <p class="section-help">${intro}</p>
    ${panel}
    ${message(ui)}
    ${advancedRecovery(state, ui, stored)}`;
}

export function tipJarBackupSection(state: AppState): string {
  return `<section class="data-sync-detail tip-jar-backup-group" id="data-sync-tip-jar-detail" data-sync-view="tip-jar" aria-labelledby="data-sync-tip-jar-title" hidden>
        <button class="data-sync-back" type="button" data-sync-back data-sync-return="tip-jar">‹ Data &amp; Sync</button>
        <h3 id="data-sync-tip-jar-title" tabindex="-1">Tip Jar data</h3>
        <div id="tip-jar-backup-body">${tipJarBackupBody(state)}</div>
      </section>`;
}

// Written into the standing section rather than rendered, for the same reason the rest of this
// card is: the reader is inside these controls when the wallet finishes a sync. False when the
// section is not mounted, which is every view except Settings.
export function updateTipJarBackupSection(root: ParentNode, state: AppState): boolean {
  const body = root.querySelector('#tip-jar-backup-body');
  if (!body) return false;
  body.innerHTML = tipJarBackupBody(state);
  return true;
}
