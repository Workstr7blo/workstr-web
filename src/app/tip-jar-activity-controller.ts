import { CANON_RELAYS } from '../nostr/canon';
import type { RelayProfile } from '../nostr/pool';
import { deviceVault as defaultVault, type DeviceVault } from '../security/device-vault';
import {
  addOutgoingMetadata,
  activityBackupRecords,
  loadTipJarActivity,
  mergeWalletTxs,
  missingCreatorPubkeys,
  outgoingTipRecord,
  recentActivity,
  saveTipJarActivity,
  type OutgoingTipInput
} from '../features/monero/tip-jar-history';
import type { TipJarActivity, TipJarOutgoingRecord, TipJarWalletTx } from '../features/monero/types';
import type { AppState } from './state';

export interface TipJarActivityControllerContext {
  state: AppState;
  // Activity changed, or a creator's profile arrived: the Tip Jar page patches its list.
  onChange(): void;
  fetchProfile(pubkey: string, relays: string[]): Promise<RelayProfile | null>;
  vault?: Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'getSecret' | 'putSecret'>;
  now?(): Date;
}

/**
 * Tip Jar activity: loads the account's stored records for the open wallet, joins each sync's
 * transaction list onto them, records a tip once it has been broadcast, and asks for the
 * profiles of creators on the visible rows. It publishes nothing: who was tipped, how much, and
 * for which program never leave this device except inside the encrypted Tip Jar backup.
 */
export function createTipJarActivityController(ctx: TipJarActivityControllerContext) {
  const { state } = ctx;
  const vault = ctx.vault ?? defaultVault;
  const now = ctx.now ?? (() => new Date());
  // Every read-modify-write runs in this chain, so a sync landing while a tip is being recorded
  // cannot write over it.
  let queue: Promise<unknown> = Promise.resolve();
  // Asked once per creator per session, whether or not the relays answered.
  const asked = new Set<string>();
  // Bumped by reset, so an update that started before a lock or account switch lands nowhere.
  let generation = 0;

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function records(pubkey: string, walletId: string): Promise<TipJarActivity[]> {
    const loaded = state.tipJarActivity;
    if (loaded?.pubkey === pubkey && loaded.walletId === walletId) return loaded.records;
    return loadTipJarActivity(vault, pubkey, walletId);
  }

  // Applies an update to the open wallet's records and stores the result. The account or wallet
  // may change while the vault is read; an update for one that is no longer shown is dropped.
  function update(walletId: string, change: (current: TipJarActivity[]) => TipJarActivity[], persist: boolean): Promise<void> {
    const pubkey = state.pubkey;
    const started = generation;
    if (!pubkey) return Promise.resolve();
    return serial(async () => {
      const stale = (): boolean => started !== generation || state.pubkey !== pubkey;
      if (stale()) return;
      const current = await records(pubkey, walletId);
      if (stale()) return;
      const next = change(current);
      if (persist && vault.isUnlocked()) await saveTipJarActivity(vault, pubkey, walletId, next);
      if (stale()) return;
      state.tipJarActivity = { pubkey, walletId, records: next };
      ctx.onChange();
      void resolveProfiles();
    });
  }

  function currentWalletId(): string | null {
    const loaded = state.tipJarActivity;
    return state.moneroWallet?.snapshot?.metadata.id ?? (loaded?.pubkey === state.pubkey ? loaded?.walletId : undefined) ?? null;
  }

  // Only the creators on the rows the page shows, only those not already cached, each once.
  async function resolveProfiles(): Promise<void> {
    const visible = recentActivity(state.tipJarActivity?.records);
    const pubkeys = missingCreatorPubkeys(visible, state).filter((pubkey) => !asked.has(pubkey));
    if (!pubkeys.length) return;
    pubkeys.forEach((pubkey) => asked.add(pubkey));
    const answers = await Promise.all(pubkeys.map(async (pubkey) => [pubkey, await ctx.fetchProfile(pubkey, CANON_RELAYS).catch(() => null)] as const));
    let changed = false;
    state.authorProfiles ||= {};
    for (const [pubkey, profile] of answers) {
      if (!profile) continue;
      state.authorProfiles[pubkey] = profile;
      if (profile.name) state.profileNames[pubkey] = profile.name;
      changed = true;
    }
    if (changed) ctx.onChange();
  }

  return {
    // From the wallet controller: after an open (txs null) the stored records are shown as they
    // were; after a sync the wallet's list is joined onto them.
    walletActivity(walletId: string, txs: TipJarWalletTx[] | null): Promise<void> {
      return update(walletId, (current) => (txs ? mergeWalletTxs(current, txs, now()) : current), Boolean(txs));
    },
    // Called by a send flow only after the wallet has broadcast the transaction and returned its
    // txid. Until then there is nothing true to record.
    recordOutgoing(input: Omit<OutgoingTipInput, 'now'>): Promise<void> {
      const walletId = currentWalletId();
      if (!walletId) return Promise.reject(new Error('Open the Tip Jar before recording a transfer.'));
      const record = outgoingTipRecord({ ...input, now: now() }, state);
      return update(walletId, (current) => addOutgoingMetadata(current, [record]), true);
    },
    // For the encrypted backup file: what Workstr knows that the chain does not.
    async backupRecords(storedWalletId?: string): Promise<TipJarOutgoingRecord[]> {
      const walletId = storedWalletId ?? currentWalletId();
      if (!state.pubkey || !walletId) return [];
      const pubkey = state.pubkey;
      return serial(async () => activityBackupRecords(await records(pubkey, walletId)));
    },
    // After a backup has restored the wallet: its creator context is attached to the restored
    // wallet's transactions as they are found.
    restoreFromBackup(activity: TipJarOutgoingRecord[] | undefined): Promise<void> {
      const walletId = currentWalletId();
      if (!activity?.length || !walletId) return Promise.resolve();
      return update(walletId, (current) => addOutgoingMetadata(current, activity), true);
    },
    resolveProfiles,
    // Account switch, lock or reset: nothing about the previous account's activity stays in memory.
    reset(): void {
      generation += 1;
      state.tipJarActivity = undefined;
    }
  };
}
