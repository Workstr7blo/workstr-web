import {
  assertBackupPassword,
  decryptTipJarBackup,
  encryptTipJarBackup,
  tipJarBackupFilename,
  TipJarBackupError,
  type TipJarBackupPayload
} from '../features/monero/wallet-backup';
import { tipJarBackupState, updateTipJarBackupSection } from '../features/monero/wallet-backup-view';
import type { MoneroWalletRestoreRequest, TipJarBackupUiState } from '../features/monero/types';
import type { AppState } from './state';

// Device-local and never synced: it records when this device last wrote a backup file, which
// is the only thing Workstr can honestly say about it. Whether the file still exists, or the
// password is still remembered, is not knowable from here.
const EXPORTED_AT_KEY = 'workstr.tipjar.exportedAt';

export interface TipJarBackupControllerContext {
  root: HTMLElement;
  state: AppState;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  wallet: {
    restore(request: MoneroWalletRestoreRequest): Promise<boolean>;
    toggleRecoveryPhrase(): Promise<void>;
    hideRecoveryPhrase?(): void;
    backupPayload(): Promise<TipJarBackupPayload>;
  };
  // Hands a restored backup's creator context back to Tip Jar activity.
  activity?: { restoreFromBackup(records: TipJarBackupPayload['activity']): Promise<void> };
  // Replacing a wallet that already holds money is never a side effect of picking a file.
  confirmReplace?(): boolean;
  now?(): Date;
  // Opens a save dialog for the finished file. Replaced in tests, which have no download.
  save?(filename: string, contents: string): void;
}

function downloadFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function reason(error: unknown): string {
  if (error instanceof TipJarBackupError) return error.message;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return raw.split('\n')[0].trim().slice(0, 140) || 'Something went wrong.';
}

export function createTipJarBackupController(ctx: TipJarBackupControllerContext) {
  const { root, state, toast } = ctx;
  const now = ctx.now ?? (() => new Date());
  const save = ctx.save ?? downloadFile;
  const confirmReplace = ctx.confirmReplace ?? (() => window.confirm(
    'Restoring this backup replaces the Tip Jar wallet stored on this device. Anything still in the current Tip Jar is only recoverable from its own recovery phrase. Replace it?'
  ));

  function exportedAtKey(): string {
    return `${EXPORTED_AT_KEY}.${state.pubkey ?? 'local'}`;
  }

  function readExportedAt(): string | undefined {
    try {
      return localStorage.getItem(exportedAtKey()) || undefined;
    } catch {
      return undefined;
    }
  }

  // Never rebuilds the Settings page: the reader is standing inside these controls.
  function set(next: Partial<TipJarBackupUiState>): void {
    const current = tipJarBackupState(state);
    state.tipJarBackup = { ...current, exportedAt: current.exportedAt ?? readExportedAt(), ...next };
    updateTipJarBackupSection(root, state);
  }

  function openPanel(panel: TipJarBackupUiState['panel']): void {
    set({ panel, busy: false, message: undefined, messageKind: undefined, fileName: undefined, fileText: undefined });
  }

  function field(id: string): string {
    return root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '';
  }

  async function exportBackup(): Promise<void> {
    const password = field('tip-jar-backup-password');
    const confirmation = field('tip-jar-backup-password-confirm');
    // Read before the panel is repainted: the inputs are replaced by the busy state below.
    set({ busy: true, message: 'Encrypting your Tip Jar backup…', messageKind: undefined });
    try {
      assertBackupPassword(password, confirmation);
      const payload = await ctx.wallet.backupPayload();
      const file = await encryptTipJarBackup(payload, password, now());
      save(tipJarBackupFilename(now()), JSON.stringify(file, null, 2));
      const exportedAt = file.exportedAt;
      try {
        localStorage.setItem(exportedAtKey(), exportedAt);
      } catch {
        // A browser with storage blocked still gets the file; it just cannot remember when.
      }
      set({ panel: 'idle', busy: false, exportedAt, message: 'Backup exported. Keep the file and its password somewhere safe.', messageKind: 'ok' });
      toast('Tip Jar backup exported');
    } catch (error) {
      set({ busy: false, message: reason(error), messageKind: 'bad' });
    }
  }

  async function chooseFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      set({ fileName: file.name, fileText: await file.text(), message: undefined, messageKind: undefined });
    } catch {
      set({ fileName: undefined, fileText: undefined, message: 'That file could not be read.', messageKind: 'bad' });
    }
  }

  // Nothing is written until the file has decrypted: a wrong password, a damaged file or an
  // unsupported version all fail with the stored wallet untouched.
  async function restoreBackup(): Promise<void> {
    const ui = tipJarBackupState(state);
    const password = field('tip-jar-backup-restore-password');
    if (!ui.fileText) return set({ message: 'Choose a Workstr Tip Jar backup file first.', messageKind: 'bad' });
    const replacing = Boolean(state.moneroWallet?.stored || state.moneroWallet?.snapshot);
    set({ busy: true, message: 'Opening your backup…', messageKind: undefined });
    let restore: MoneroWalletRestoreRequest;
    let activity: TipJarBackupPayload['activity'];
    try {
      const payload = await decryptTipJarBackup(ui.fileText, password);
      restore = { seed: payload.seed, restoreHeight: payload.restoreHeight, replace: replacing };
      activity = payload.activity;
    } catch (error) {
      return set({ busy: false, message: reason(error), messageKind: 'bad' });
    }
    if (replacing && !confirmReplace()) return set({ busy: false, message: 'Restore cancelled. The Tip Jar on this device is unchanged.' });
    if (await applyRestore(restore, 'Tip Jar restored.')) await ctx.activity?.restoreFromBackup(activity).catch(() => undefined);
  }

  // Blank means "scan from the start"; anything else must be a whole non-negative block number,
  // so a typo is reported rather than silently becoming a different height.
  function seedHeight(): number | undefined | null {
    const raw = root.querySelector<HTMLInputElement>('#tip-jar-seed-height')?.value.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  async function restoreFromSeed(): Promise<void> {
    const seed = root.querySelector<HTMLTextAreaElement>('#tip-jar-seed')?.value.trim() || '';
    if (!seed) return set({ advanced: true, message: 'Paste a Monero recovery phrase to restore.', messageKind: 'bad' });
    const height = seedHeight();
    // A toast rather than a repaint, which would wipe the phrase the user just pasted.
    if (height === null) return toast('Restore height must be a whole block number, or blank', 'bad');
    const replacing = Boolean(state.moneroWallet?.stored || state.moneroWallet?.snapshot);
    if (replacing && !confirmReplace()) return;
    set({ advanced: true, busy: true, message: 'Restoring from your recovery phrase…', messageKind: undefined });
    await applyRestore({ seed, restoreHeight: height, replace: replacing }, 'Tip Jar restored from your recovery phrase.');
  }

  async function applyRestore(request: MoneroWalletRestoreRequest, done: string): Promise<boolean> {
    const ok = await ctx.wallet.restore(request);
    set({
      panel: 'idle',
      busy: false,
      fileName: undefined,
      fileText: undefined,
      message: ok ? done : state.moneroWallet?.message || 'The Tip Jar could not be restored.',
      messageKind: ok ? 'ok' : 'bad'
    });
    return ok;
  }

  // Delegated from the root once. The section is rewritten in place on every wallet change, so
  // anything bound to its controls directly would be dead by the next sync tick.
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || !target.closest('.tip-jar-backup-group')) return;
    if (target.id === 'tip-jar-backup-export') openPanel('export');
    else if (target.id === 'tip-jar-backup-restore') openPanel('restore');
    else if (target.id === 'tip-jar-backup-cancel') openPanel('idle');
    else if (target.id === 'tip-jar-backup-choose') root.querySelector<HTMLInputElement>('#tip-jar-backup-file')?.click();
    else if (target.id === 'tip-jar-reveal-phrase') void ctx.wallet.toggleRecoveryPhrase();
  });

  root.addEventListener('toggle', (event) => {
    const details = event.target as HTMLElement;
    if (details instanceof HTMLDetailsElement && details.classList.contains('tip-jar-recovery')) {
      const current = tipJarBackupState(state);
      if (current.advanced !== details.open) state.tipJarBackup = { ...current, advanced: details.open };
      if (!details.open) ctx.wallet.hideRecoveryPhrase?.();
    }
  }, true);

  root.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === 'tip-jar-backup-file') void chooseFile(input);
  });

  root.addEventListener('submit', (event) => {
    const form = event.target as HTMLElement;
    if (form.id === 'tip-jar-backup-export-form') { event.preventDefault(); void exportBackup(); }
    else if (form.id === 'tip-jar-backup-restore-form') { event.preventDefault(); void restoreBackup(); }
    else if (form.id === 'tip-jar-seed-restore-form') { event.preventDefault(); void restoreFromSeed(); }
  });

  return {
    // Called when Settings opens, so the section shows this device's last export without
    // waiting for the reader to touch anything.
    refresh(): void {
      const current = tipJarBackupState(state);
      state.tipJarBackup = { ...current, exportedAt: readExportedAt() };
      updateTipJarBackupSection(root, state);
    },
    // Leaving Settings closes whatever panel was open; a password box does not survive a trip
    // to another page and come back half filled in.
    reset(): void {
      state.tipJarBackup = { panel: 'idle', advanced: false, busy: false, exportedAt: readExportedAt() };
    }
  };
}
