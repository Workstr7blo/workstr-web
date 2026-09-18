// Tip Jar activity: the wallet's transactions, joined by txid to what Workstr remembers about
// the ones it made.
//
// The wallet is the source of truth for amount, confirmation and failure. Workstr adds only
// what the chain cannot say: which creator a tip was for (their Nostr pubkey, the durable
// identity), which program it was for, and a name and picture snapshot to fall back on when no
// current profile is at hand. Incoming transfers carry no sender at all - Monero does not
// reveal one, and a guess would be a fabrication.
//
// Nothing here is published. The records live in the device vault under the account's own
// scope, and leave the device only inside the encrypted Tip Jar backup.
import { displayPubkey } from '../../app/format';
import type { AppState } from '../../app/state';
import type { DeviceVault } from '../../security/device-vault';
import { tipJarActivityScope } from './wallet-storage';
import type {
  MoneroWalletRuntimeTx,
  TipJarActivity,
  TipJarIncomingRecord,
  TipJarOutgoingRecord,
  TipJarTransactionState,
  TipJarWalletTx
} from './types';

// How many rows the Tip Jar page shows. The page is balance, receive, send and a glance at
// what moved - not a wallet history.
export const TIP_JAR_RECENT_LIMIT = 5;
const STORE_VERSION = 1;
const STATES: ReadonlyArray<TipJarTransactionState> = ['submitted', 'confirmed', 'failed'];

type ProfileState = Pick<AppState, 'authorProfiles' | 'profileNames'>;

export interface OutgoingTipInput {
  txid: string;
  amountAtomic: string;
  feeAtomic?: string;
  recipientAddress?: string;
  // Present for a creator tip; absent for a send to an arbitrary address.
  recipientPubkey?: string;
  program?: { address?: string; name?: string };
  now: Date;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const atomic = (value: unknown): string | undefined => (typeof value === 'string' && /^\d+$/.test(value) ? value : undefined);
const isPubkey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

// Written only once the transaction has been broadcast and the wallet returned its txid. A
// record written before that would claim a payment that may never have left the wallet.
export function outgoingTipRecord(input: OutgoingTipInput, profiles: ProfileState): TipJarOutgoingRecord {
  const pubkey = isPubkey(input.recipientPubkey) ? input.recipientPubkey : undefined;
  const profile = pubkey ? profiles.authorProfiles?.[pubkey] : undefined;
  const record: TipJarOutgoingRecord = {
    id: input.txid,
    txid: input.txid,
    direction: 'out',
    kind: pubkey ? 'tip' : 'send',
    amountAtomic: input.amountAtomic,
    createdAt: input.now.toISOString(),
    state: 'submitted'
  };
  if (input.feeAtomic) record.feeAtomic = input.feeAtomic;
  if (input.recipientAddress) record.recipientAddress = input.recipientAddress;
  if (pubkey) {
    record.recipientPubkey = pubkey;
    const name = profile?.name || profiles.profileNames?.[pubkey];
    if (name) record.nameSnapshot = name;
    if (profile?.picture) record.pictureSnapshot = profile.picture;
    if (input.program?.address) record.programAddress = input.program.address;
    if (input.program?.name) record.programName = input.program.name;
  }
  return record;
}

// monero-ts reports seconds; anything already in milliseconds is left alone.
function isoFromSeconds(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

// One runtime transaction as the activity list needs it. A transfer that is both incoming and
// outgoing (a send with change, or to this wallet's own address) is the send it was.
export function walletTxFromRuntime(tx: MoneroWalletRuntimeTx): TipJarWalletTx | null {
  const txid = tx.getHash();
  if (!txid) return null;
  const outgoing = Boolean(tx.getIsOutgoing?.());
  if (!outgoing && !tx.getIsIncoming?.()) return null;
  const amount = outgoing ? tx.getOutgoingAmount?.() : tx.getIncomingAmount?.();
  const state: TipJarTransactionState = tx.getIsFailed?.() ? 'failed' : tx.getIsConfirmed?.() ? 'confirmed' : 'submitted';
  const result: TipJarWalletTx = { txid, direction: outgoing ? 'out' : 'in', amountAtomic: (amount ?? 0n).toString(), state };
  const fee = outgoing ? tx.getFee?.() : undefined;
  if (fee !== undefined) result.feeAtomic = fee.toString();
  const timestamp = isoFromSeconds(tx.getBlock?.()?.getTimestamp?.()) ?? isoFromSeconds(tx.getReceivedTimestamp?.());
  if (timestamp) result.timestamp = timestamp;
  const confirmations = tx.getNumConfirmations?.();
  if (typeof confirmations === 'number' && confirmations >= 0) result.confirmations = confirmations;
  return result;
}

function byNewest(a: TipJarActivity, b: TipJarActivity): number {
  return b.createdAt.localeCompare(a.createdAt) || a.txid.localeCompare(b.txid);
}

export function sortActivity(records: TipJarActivity[]): TipJarActivity[] {
  return [...records].sort(byNewest);
}

export function recentActivity(records: TipJarActivity[] | undefined, limit = TIP_JAR_RECENT_LIMIT): TipJarActivity[] {
  return sortActivity(records ?? []).slice(0, limit);
}

// Adds what Workstr knows about outgoing transfers - freshly broadcast, or read back from a
// backup - to the list, by txid. Where the wallet has already reported the same transaction,
// its amount, fee, state and confirmations stay; only creator and program context is added.
export function addOutgoingMetadata(records: TipJarActivity[], additions: TipJarOutgoingRecord[]): TipJarActivity[] {
  const byTxid = new Map(records.map((record) => [record.txid, record]));
  for (const record of additions) {
    const existing = byTxid.get(record.txid);
    if (!existing) { byTxid.set(record.txid, record); continue; }
    // The wallet says this transaction came in; a note claiming otherwise is not applied.
    if (existing.direction !== 'out') continue;
    const merged: TipJarOutgoingRecord = { ...existing, ...record, amountAtomic: existing.amountAtomic, state: existing.state };
    const feeAtomic = existing.feeAtomic ?? record.feeAtomic;
    if (feeAtomic) merged.feeAtomic = feeAtomic;
    if (existing.confirmations !== undefined) merged.confirmations = existing.confirmations;
    byTxid.set(record.txid, merged);
  }
  return sortActivity([...byTxid.values()]);
}

// Joins the wallet's view onto the stored records by txid - never by address, which a creator
// reuses across tips and may change. The wallet's amount, fee and state win; Workstr's creator,
// program and snapshot fields are kept. A record the wallet does not list (a tip it has not
// picked up yet) is kept as it was.
export function mergeWalletTxs(records: TipJarActivity[], txs: TipJarWalletTx[], now: Date): TipJarActivity[] {
  const byTxid = new Map(records.map((record) => [record.txid, record]));
  for (const tx of txs) {
    const existing = byTxid.get(tx.txid);
    const base = {
      id: tx.txid,
      txid: tx.txid,
      amountAtomic: tx.amountAtomic,
      // When Workstr sent it, for its own sends; when the chain saw it, for everything else.
      createdAt: (tx.direction === 'out' ? existing?.createdAt ?? tx.timestamp : tx.timestamp ?? existing?.createdAt) ?? now.toISOString(),
      state: tx.state,
      ...(tx.confirmations !== undefined ? { confirmations: tx.confirmations } : {})
    };
    if (tx.direction === 'in') {
      byTxid.set(tx.txid, { ...base, direction: 'in' } satisfies TipJarIncomingRecord);
      continue;
    }
    const known = existing?.direction === 'out' ? existing : undefined;
    const out: TipJarOutgoingRecord = { ...known, ...base, direction: 'out', kind: known?.kind ?? 'send' };
    if (tx.feeAtomic) out.feeAtomic = tx.feeAtomic;
    byTxid.set(tx.txid, out);
  }
  return sortActivity([...byTxid.values()]);
}

// Current profile first, then the name the relays last answered, then the snapshot taken when
// the tip was sent, then the key itself. The pubkey is the identity; names are only labels.
export function tipJarCreatorName(pubkey: string, state: ProfileState, snapshot?: string): string {
  return state.authorProfiles?.[pubkey]?.name || state.profileNames?.[pubkey] || snapshot || displayPubkey(pubkey);
}

export function tipJarCreatorPicture(pubkey: string, state: ProfileState, snapshot?: string): string | undefined {
  return state.authorProfiles?.[pubkey]?.picture || snapshot || undefined;
}

// Creators on the visible rows whose profiles are not cached, each asked for once.
export function missingCreatorPubkeys(records: TipJarActivity[], state: ProfileState): string[] {
  const pubkeys = records.flatMap((record) => (record.direction === 'out' && record.recipientPubkey ? [record.recipientPubkey] : []));
  return [...new Set(pubkeys)].filter((pubkey) => !state.authorProfiles?.[pubkey]);
}

// What the encrypted backup carries: Workstr's own knowledge about outgoing transfers. Incoming
// transfers come back from the chain when the restored wallet syncs, so they are not copied.
export function activityBackupRecords(records: TipJarActivity[] | undefined): TipJarOutgoingRecord[] {
  return (records ?? []).filter((record): record is TipJarOutgoingRecord => record.direction === 'out' && Boolean(record.recipientPubkey || record.recipientAddress));
}

// Accepts only well-formed records, from the vault or from a backup file, and drops sender
// fields an incoming record must never have.
export function parseActivityRecords(value: unknown): TipJarActivity[] {
  if (!Array.isArray(value)) return [];
  const records: TipJarActivity[] = [];
  for (const raw of value as Array<Record<string, unknown> | null>) {
    if (!raw || typeof raw !== 'object') continue;
    const txid = text(raw.txid);
    const amountAtomic = atomic(raw.amountAtomic);
    const createdAt = text(raw.createdAt);
    if (!txid || !amountAtomic || !createdAt || Number.isNaN(Date.parse(createdAt))) continue;
    const state = STATES.includes(raw.state as TipJarTransactionState) ? raw.state as TipJarTransactionState : 'submitted';
    const base = { id: txid, txid, amountAtomic, createdAt, state, ...(typeof raw.confirmations === 'number' ? { confirmations: raw.confirmations } : {}) };
    if (raw.direction === 'in') { records.push({ ...base, direction: 'in' }); continue; }
    if (raw.direction !== 'out') continue;
    const pubkey = isPubkey(raw.recipientPubkey) ? raw.recipientPubkey : undefined;
    const out: TipJarOutgoingRecord = { ...base, direction: 'out', kind: pubkey && raw.kind !== 'send' ? 'tip' : 'send' };
    const optional = { recipientAddress: text(raw.recipientAddress), feeAtomic: atomic(raw.feeAtomic), programAddress: text(raw.programAddress), programName: text(raw.programName), nameSnapshot: text(raw.nameSnapshot), pictureSnapshot: text(raw.pictureSnapshot) };
    if (pubkey) out.recipientPubkey = pubkey;
    for (const [key, field] of Object.entries(optional)) if (field) (out as unknown as Record<string, string>)[key] = field;
    records.push(out);
  }
  return sortActivity(records);
}

type ActivityVault = Pick<DeviceVault, 'isUnlocked' | 'hasSecret' | 'getSecret' | 'putSecret'>;

interface StoredActivity {
  version: typeof STORE_VERSION;
  // Records belong to one wallet. A restore creates a new wallet id, so a replaced wallet's
  // history does not appear under the new one.
  walletId: string;
  records: TipJarActivity[];
}

// Missing, unreadable, or another wallet's: all mean "no activity yet".
export async function loadTipJarActivity(vault: ActivityVault, pubkey: string, walletId: string): Promise<TipJarActivity[]> {
  if (!vault.isUnlocked()) return [];
  const scope = tipJarActivityScope(pubkey);
  try {
    if (!await vault.hasSecret(scope)) return [];
    const stored = JSON.parse(await vault.getSecret(scope)) as Partial<StoredActivity> | null;
    if (!stored || stored.version !== STORE_VERSION || stored.walletId !== walletId) return [];
    return parseActivityRecords(stored.records);
  } catch {
    return [];
  }
}

export async function saveTipJarActivity(vault: ActivityVault, pubkey: string, walletId: string, records: TipJarActivity[]): Promise<void> {
  if (!vault.isUnlocked()) throw new Error('Unlock Workstr before saving Tip Jar activity.');
  const stored: StoredActivity = { version: STORE_VERSION, walletId, records: sortActivity(records) };
  await vault.putSecret(tipJarActivityScope(pubkey), JSON.stringify(stored));
}
