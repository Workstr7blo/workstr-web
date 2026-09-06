import type { AppState } from './state';
import type { Signer } from '../signer/types';
import { backupPanelState, updateBackupStatus } from '../features/backup/views';
import { createSyncEngine, type SyncEngine, type SyncStatus } from '../sync/engine';

// Survives the sign-in round trip, including a NIP-46 hop out to a signer app and back.
// The signed-out namespace is a different database from the one backup will run in, so
// the intent cannot be stored in either of them.
const INTENT_KEY = 'workstr.backup.pendingEnable';

export interface BackupControllerContext {
  // The Data & Sync card is patched in place for a status, so the controller needs the tree
  // it lives in. The other controllers take the same handle.
  root: ParentNode;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  getSigner(): Promise<Signer | null>;
  // Drops the cached signer so the next pass builds a fresh connection to it.
  onSignerStalled?(): void;
  // A restore has written records into the database. What the screen draws was read when
  // the namespace opened, so it has to be read again or the restored training is on the
  // device and invisible.
  onRestored?(): void;
  requestSignIn(): void;
  relayUrl?: string;
}

export interface BackupController {
  resume(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  syncNow(): Promise<void>;
  stop(): void;
}

export function createBackupController(ctx: BackupControllerContext): BackupController {
  let engine: SyncEngine | null = null;

  // Settings is the only surface that shows sync status, and the engine reports one for
  // every phase and step of a pass. Rebuilding the root for each of them collapsed open
  // Settings categories and visibly redrew the page the user was on, throughout the first
  // seconds after every launch. Turning sync on or off still renders: that changes which
  // controls the card has, not just what they say.
  const onStatus = (status: SyncStatus): void => {
    ctx.state.backup = status;
    updateBackupStatus(ctx.root, backupPanelState(ctx.state));
  };

  const engineFor = (): SyncEngine | null => {
    const store = ctx.state.store;
    if (!store) return null;
    if (!engine) engine = createSyncEngine({ store, getSigner: ctx.getSigner, onStatus, relayUrl: ctx.relayUrl, onSignerStalled: ctx.onSignerStalled, onRestored: ctx.onRestored });
    return engine;
  };

  const stop = (): void => {
    engine?.stop();
    engine = null;
    ctx.state.backup = { state: 'off', pending: 0 };
  };

  async function enable(): Promise<void> {
    const store = ctx.state.store;
    if (!store) return;
    ctx.state.settings.backup = await store.saveBackupState({ enabled: true });
    ctx.render();
    await engineFor()?.start();
  }

  return {
    // Called whenever a namespace opens. The engine belongs to one store, so a sign-in,
    // sign-out or account switch tears the old one down before anything starts.
    async resume(): Promise<void> {
      stop();
      if (!ctx.state.pubkey || !ctx.state.store) return;
      if (localStorage.getItem(INTENT_KEY)) {
        localStorage.removeItem(INTENT_KEY);
        await enable();
        ctx.toast('Auto-sync is on.');
        return;
      }
      if (ctx.state.settings.backup?.enabled) await engineFor()?.start();
    },

    async setEnabled(enabled: boolean): Promise<void> {
      if (!enabled) {
        const store = ctx.state.store;
        engine?.stop();
        engine = null;
        if (store) ctx.state.settings.backup = await store.saveBackupState({ enabled: false });
        ctx.render();
        return;
      }
      // The one unavoidable step: records are encrypted to the user's own key and signed
      // by it, so there is nothing to back up to until there is an identity.
      if (!ctx.state.pubkey) {
        localStorage.setItem(INTENT_KEY, '1');
        ctx.render();
        ctx.toast('Sign in to turn on sync.');
        ctx.requestSignIn();
        return;
      }
      await enable();
    },

    async syncNow(): Promise<void> {
      const active = engineFor();
      if (!active) return;
      const status = await active.syncNow();
      // Not while a retry is seconds away: the panel says it is reconnecting, and a red
      // toast telling the user to go and open their signer app contradicts it.
      if (status.state === 'error' && !status.reconnecting) {
        ctx.toast(status.lastError || 'Backup could not reach the relay.', 'bad');
      }
    },

    stop
  };
}
