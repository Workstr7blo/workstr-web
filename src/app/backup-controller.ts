import type { AppState } from './state';
import type { Signer } from '../signer/types';
import { createSyncEngine, type SyncEngine, type SyncStatus } from '../sync/engine';

// Survives the sign-in round trip, including a NIP-46 hop out to a signer app and back.
// The signed-out namespace is a different database from the one backup will run in, so
// the intent cannot be stored in either of them.
const INTENT_KEY = 'workstr.backup.pendingEnable';

export interface BackupControllerContext {
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

  const onStatus = (status: SyncStatus): void => {
    ctx.state.backup = status;
    ctx.render();
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
        ctx.toast('Auto-backup is on.');
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
        ctx.toast('Sign in to turn on backup.');
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
