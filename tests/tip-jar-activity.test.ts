// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  activityBackupRecords,
  addOutgoingMetadata,
  loadTipJarActivity,
  mergeWalletTxs,
  missingCreatorPubkeys,
  outgoingTipRecord,
  recentActivity,
  saveTipJarActivity,
  sortActivity,
  tipJarCreatorName,
  tipJarCreatorPicture,
  walletTxFromRuntime
} from '../src/features/monero/tip-jar-history';
import { activityDay, activityTime, tipJarActivityCard, updateTipJarActivity } from '../src/features/monero/tip-jar-history-view';
import { decryptTipJarBackup, encryptTipJarBackup, type TipJarBackupPayload } from '../src/features/monero/wallet-backup';
import { createTipJarActivityController } from '../src/app/tip-jar-activity-controller';
import type { AppState } from '../src/app/state';
import type { MoneroWalletRuntimeTx, TipJarActivity, TipJarIncomingRecord, TipJarOutgoingRecord, TipJarWalletTx } from '../src/features/monero/types';

const ACCOUNT = 'ab'.repeat(32);
const CREATOR = 'cd'.repeat(32);
const OTHER_CREATOR = 'ef'.repeat(32);
const CREATOR_ADDRESS = `8${'C'.repeat(94)}`;
const NOW = new Date(2026, 8, 18, 20, 0);

function profiles(overrides: Partial<Pick<AppState, 'authorProfiles' | 'profileNames'>> = {}): Pick<AppState, 'authorProfiles' | 'profileNames'> {
  return { authorProfiles: {}, profileNames: {}, ...overrides };
}

function tip(overrides: Partial<TipJarOutgoingRecord> = {}): TipJarOutgoingRecord {
  return {
    id: 'tx-out', txid: 'tx-out', direction: 'out', kind: 'tip', amountAtomic: '5000000000',
    createdAt: new Date(2026, 8, 18, 19, 42).toISOString(), state: 'confirmed',
    recipientPubkey: CREATOR, recipientAddress: CREATOR_ADDRESS, programName: '5x5 Strength', nameSnapshot: 'Settebello',
    ...overrides
  };
}

function received(overrides: Partial<TipJarIncomingRecord> = {}): TipJarIncomingRecord {
  return { id: 'tx-in', txid: 'tx-in', direction: 'in', amountAtomic: '12000000000', createdAt: new Date(2026, 8, 17, 15, 14).toISOString(), state: 'confirmed', ...overrides };
}

function runtimeTx(fields: { hash: string; incoming?: boolean; outgoing?: boolean; inAmount?: bigint; outAmount?: bigint; fee?: bigint; confirmed?: boolean; failed?: boolean; blockTime?: number; received?: number; confirmations?: number }): MoneroWalletRuntimeTx {
  return {
    getHash: () => fields.hash,
    getIsIncoming: () => fields.incoming,
    getIsOutgoing: () => fields.outgoing,
    getIncomingAmount: () => fields.inAmount,
    getOutgoingAmount: () => fields.outAmount,
    getFee: () => fields.fee,
    getIsConfirmed: () => fields.confirmed,
    getIsFailed: () => fields.failed,
    getNumConfirmations: () => fields.confirmations,
    getReceivedTimestamp: () => fields.received,
    getBlock: () => (fields.blockTime ? { getTimestamp: () => fields.blockTime } : undefined)
  };
}

function memoryVault() {
  const secrets = new Map<string, string>();
  return {
    secrets,
    isUnlocked: () => true,
    hasSecret: async (scope: string) => secrets.has(scope),
    getSecret: async (scope: string) => { const value = secrets.get(scope); if (value === undefined) throw new Error('missing'); return value; },
    putSecret: async (scope: string, value: string) => { secrets.set(scope, value); }
  };
}

function appState(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: ACCOUNT, profileNames: {}, authorProfiles: {},
    moneroWallet: { status: 'ready', stored: true, snapshot: { metadata: { id: 'wallet-1' }, balance: null, sync: null } },
    ...overrides
  } as unknown as AppState;
}

describe('outgoing tip records', () => {
  it('store the recipient pubkey, txid, amount, time and program, with a profile snapshot', () => {
    const record = outgoingTipRecord({
      txid: 'abc123', amountAtomic: '5000000000', feeAtomic: '30000000', recipientAddress: CREATOR_ADDRESS, recipientPubkey: CREATOR,
      program: { address: '33402:x:5x5', name: '5x5 Strength' }, now: NOW
    }, profiles({ authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: 'Settebello', picture: 'https://img/s.png' } } }));
    expect(record).toMatchObject({
      id: 'abc123', txid: 'abc123', direction: 'out', kind: 'tip', recipientPubkey: CREATOR, recipientAddress: CREATOR_ADDRESS,
      amountAtomic: '5000000000', feeAtomic: '30000000', createdAt: NOW.toISOString(), state: 'submitted',
      programAddress: '33402:x:5x5', programName: '5x5 Strength', nameSnapshot: 'Settebello', pictureSnapshot: 'https://img/s.png'
    });
  });

  it('record a generic send without a recipient pubkey or program', () => {
    const record = outgoingTipRecord({ txid: 'send-1', amountAtomic: '1', recipientAddress: CREATOR_ADDRESS, program: { name: 'ignored' }, now: NOW }, profiles());
    expect(record.kind).toBe('send');
    expect(record.recipientPubkey).toBeUndefined();
    expect(record.programName).toBeUndefined();
  });
});

describe('wallet transactions', () => {
  it('read incoming transfers without inventing a sender', () => {
    const tx = walletTxFromRuntime(runtimeTx({ hash: 'in-1', incoming: true, inAmount: 12_000_000_000n, confirmed: true, blockTime: 1_758_121_440, confirmations: 12 }));
    expect(tx).toEqual({ txid: 'in-1', direction: 'in', amountAtomic: '12000000000', state: 'confirmed', timestamp: new Date(1_758_121_440_000).toISOString(), confirmations: 12 });
    const [record] = mergeWalletTxs([], [tx as TipJarWalletTx], NOW);
    expect(Object.keys(record).sort()).toEqual(['amountAtomic', 'confirmations', 'createdAt', 'direction', 'id', 'state', 'txid']);
    expect(JSON.stringify(record)).not.toMatch(/sender|recipient|name|picture/i);
  });

  it('treat a send with change as a send, and take confirmation from the wallet', () => {
    expect(walletTxFromRuntime(runtimeTx({ hash: 'out-1', incoming: true, outgoing: true, inAmount: 9n, outAmount: 5n, fee: 1n, received: 1_758_000_000 }))).toMatchObject({ direction: 'out', amountAtomic: '5', feeAtomic: '1', state: 'submitted' });
    expect(walletTxFromRuntime(runtimeTx({ hash: 'x', outgoing: true, outAmount: 5n, failed: true }))?.state).toBe('failed');
    expect(walletTxFromRuntime(runtimeTx({ hash: '', incoming: true }))).toBeNull();
  });

  it('join Workstr metadata onto the wallet transaction by txid', () => {
    const stored = [tip({ txid: 'abc123', id: 'abc123', state: 'submitted', amountAtomic: '5000000000' })];
    const [joined] = mergeWalletTxs(stored, [{ txid: 'abc123', direction: 'out', amountAtomic: '4999000000', feeAtomic: '1000000', state: 'confirmed', timestamp: '2026-09-18T20:00:00.000Z' }], NOW) as TipJarOutgoingRecord[];
    // The wallet's amount and state win; Workstr's creator and program context stay.
    expect(joined).toMatchObject({ txid: 'abc123', kind: 'tip', recipientPubkey: CREATOR, programName: '5x5 Strength', amountAtomic: '4999000000', feeAtomic: '1000000', state: 'confirmed', createdAt: stored[0].createdAt });
  });

  it('never joins by address: two tips to the same address stay two transactions', () => {
    const merged = mergeWalletTxs([tip({ txid: 'a', id: 'a' })], [{ txid: 'b', direction: 'out', amountAtomic: '7', state: 'confirmed', timestamp: NOW.toISOString() }], NOW);
    expect(merged).toHaveLength(2);
    const other = merged.find((record) => record.txid === 'b') as TipJarOutgoingRecord;
    expect(other.kind).toBe('send');
    expect(other.recipientPubkey).toBeUndefined();
  });

  it('keeps the wallet state when a tip is recorded after the wallet already saw it', () => {
    const fromWallet = mergeWalletTxs([], [{ txid: 'abc', direction: 'out', amountAtomic: '9', state: 'confirmed', confirmations: 3 }], NOW);
    const [joined] = addOutgoingMetadata(fromWallet, [tip({ txid: 'abc', id: 'abc', state: 'submitted', amountAtomic: '10' })]) as TipJarOutgoingRecord[];
    expect(joined).toMatchObject({ kind: 'tip', recipientPubkey: CREATOR, state: 'confirmed', amountAtomic: '9', confirmations: 3 });
    // A note that says an incoming transaction was a tip is not applied.
    const incoming = mergeWalletTxs([], [{ txid: 'in', direction: 'in', amountAtomic: '1', state: 'confirmed' }], NOW);
    expect(addOutgoingMetadata(incoming, [tip({ txid: 'in', id: 'in' })])[0].direction).toBe('in');
  });

  it('sorts newest first and keeps the page list short', () => {
    const records: TipJarActivity[] = Array.from({ length: 8 }, (_, i) => received({ txid: `t${i}`, id: `t${i}`, createdAt: new Date(2026, 8, i + 1).toISOString() }));
    expect(sortActivity(records)[0].txid).toBe('t7');
    expect(recentActivity(records).map((record) => record.txid)).toEqual(['t7', 't6', 't5', 't4', 't3']);
  });
});

describe('creator display', () => {
  it('prefers the current Nostr profile over the stored snapshot', () => {
    const state = profiles({ authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: 'Sette (new)', picture: 'https://img/new.png' } } });
    expect(tipJarCreatorName(CREATOR, state, 'Settebello')).toBe('Sette (new)');
    expect(tipJarCreatorPicture(CREATOR, state, 'https://img/old.png')).toBe('https://img/new.png');
    expect(tipJarCreatorName(CREATOR, profiles({ profileNames: { [CREATOR]: 'From names' } }), 'Settebello')).toBe('From names');
  });

  it('falls back to the snapshot offline, then to the short pubkey', () => {
    expect(tipJarCreatorName(CREATOR, profiles(), 'Settebello')).toBe('Settebello');
    expect(tipJarCreatorPicture(CREATOR, profiles(), 'https://img/old.png')).toBe('https://img/old.png');
    expect(tipJarCreatorName(CREATOR, profiles())).toMatch(/^npub1.+…/);
    expect(tipJarCreatorPicture(CREATOR, profiles())).toBeUndefined();
  });

  it('asks only for creators whose profiles are missing, each once', () => {
    const records = [tip({ txid: '1' }), tip({ txid: '2' }), tip({ txid: '3', recipientPubkey: OTHER_CREATOR }), received()];
    expect(missingCreatorPubkeys(records, profiles())).toEqual([CREATOR, OTHER_CREATOR]);
    expect(missingCreatorPubkeys(records, profiles({ authorProfiles: { [CREATOR]: { pubkey: CREATOR } } }))).toEqual([OTHER_CREATOR]);
  });
});

describe('Tip Jar activity storage', () => {
  it('keeps records per account and wallet in the vault', async () => {
    const vault = memoryVault();
    await saveTipJarActivity(vault, ACCOUNT, 'wallet-1', [tip()]);
    expect([...vault.secrets.keys()]).toEqual([`monero.tip-jar-activity.${ACCOUNT}`]);
    expect(await loadTipJarActivity(vault, ACCOUNT, 'wallet-1')).toEqual([tip()]);
    // A replaced wallet's history does not show under the new one.
    expect(await loadTipJarActivity(vault, ACCOUNT, 'wallet-2')).toEqual([]);
  });

  it('survives the encrypted Tip Jar backup, and older files without activity still restore', async () => {
    const base: TipJarBackupPayload = { network: 'mainnet', seed: 'seed words', restoreHeight: 3_763_633, creatorSubaddressIndex: 1, creatorSubaddress: 'x', primaryAddress: 'y', createdAt: '' };
    const activity = activityBackupRecords([tip(), received(), tip({ txid: 'wallet-only', id: 'wallet-only', kind: 'send', recipientPubkey: undefined, recipientAddress: undefined })]);
    expect(activity.map((record) => record.txid)).toEqual(['tx-out']);
    const file = await encryptTipJarBackup({ ...base, activity }, 'a long enough password');
    expect(JSON.stringify(file)).not.toContain(CREATOR);
    const restored = await decryptTipJarBackup(JSON.stringify(file), 'a long enough password');
    expect(restored.activity).toEqual([tip()]);
    const old = await encryptTipJarBackup(base, 'a long enough password');
    expect((await decryptTipJarBackup(JSON.stringify(old), 'a long enough password')).activity).toEqual([]);
  });
});

describe('Tip Jar activity controller', () => {
  it('joins a sync onto stored records, saves them, and asks for missing creator profiles', async () => {
    const vault = memoryVault();
    await saveTipJarActivity(vault, ACCOUNT, 'wallet-1', [tip({ state: 'submitted' })]);
    const state = appState();
    const onChange = vi.fn();
    const fetchProfile = vi.fn(async (pubkey: string) => ({ pubkey, name: 'Settebello', picture: 'https://img/s.png' }));
    const ctrl = createTipJarActivityController({ state, vault, onChange, fetchProfile, now: () => NOW });
    await ctrl.walletActivity('wallet-1', [
      { txid: 'tx-out', direction: 'out', amountAtomic: '5000000000', state: 'confirmed' },
      { txid: 'tx-in', direction: 'in', amountAtomic: '12000000000', state: 'confirmed', timestamp: received().createdAt }
    ]);
    expect(state.tipJarActivity?.records.map((record) => [record.txid, record.state])).toEqual([['tx-out', 'confirmed'], ['tx-in', 'confirmed']]);
    expect((await loadTipJarActivity(vault, ACCOUNT, 'wallet-1')).length).toBe(2);
    await vi.waitFor(() => expect(state.authorProfiles?.[CREATOR]?.name).toBe('Settebello'));
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    await ctrl.resolveProfiles();
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('records a broadcast tip and hands it to the backup', async () => {
    const vault = memoryVault();
    const state = appState({ authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: 'Settebello' } } });
    const ctrl = createTipJarActivityController({ state, vault, onChange: vi.fn(), fetchProfile: vi.fn(async () => null), now: () => NOW });
    await ctrl.recordOutgoing({ txid: 'new-tip', amountAtomic: '5000000000', recipientPubkey: CREATOR, recipientAddress: CREATOR_ADDRESS, program: { name: '5x5 Strength' } });
    const [record] = await ctrl.backupRecords('wallet-1');
    expect(record).toMatchObject({ txid: 'new-tip', recipientPubkey: CREATOR, nameSnapshot: 'Settebello', programName: '5x5 Strength', state: 'submitted' });
  });

  it('drops an update that finishes after a lock', async () => {
    const vault = memoryVault();
    const state = appState();
    const ctrl = createTipJarActivityController({ state, vault, onChange: vi.fn(), fetchProfile: vi.fn(async () => null), now: () => NOW });
    const pending = ctrl.walletActivity('wallet-1', [{ txid: 'late', direction: 'in', amountAtomic: '1', state: 'confirmed' }]);
    ctrl.reset();
    await pending;
    expect(state.tipJarActivity).toBeUndefined();
  });
});

describe('Recent activity card', () => {
  function card(records: TipJarActivity[], overrides: Partial<AppState> = {}): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = tipJarActivityCard(appState({ tipJarActivity: { pubkey: ACCOUNT, walletId: 'wallet-1', records }, ...overrides }), NOW);
    return host;
  }

  it('shows an outgoing tip with an up-right arrow, the creator, amount and program', () => {
    const row = card([tip()], { authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: 'Settebello', picture: 'https://img/s.png' } } }).querySelector('.tip-jar-activity-row')!;
    expect(row.getAttribute('data-direction')).toBe('out');
    expect(row.querySelector('.tip-jar-activity-arrow path')?.getAttribute('d')).toBe('M7 17 17 7');
    expect(row.querySelector('img')?.getAttribute('src')).toBe('https://img/s.png');
    expect(row.querySelector('.tip-jar-activity-name')?.textContent).toBe('Settebello');
    expect(row.querySelector('.tip-jar-activity-amount')?.textContent).toBe('0.005 XMR');
    expect(row.querySelector('.tip-jar-activity-context')?.textContent).toBe('Tip for 5x5 Strength');
    expect(row.querySelector('.tip-jar-activity-when')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Today 7:42 PM');
    expect(row.querySelector('.sr-only')?.textContent).toBe('Sent 0.005 XMR to Settebello for 5x5 Strength, today at 7:42 PM.');
  });

  it('shows an incoming transfer as Received with a down-left arrow and no sender', () => {
    const row = card([received()]).querySelector('.tip-jar-activity-row')!;
    expect(row.querySelector('.tip-jar-activity-arrow path')?.getAttribute('d')).toBe('M17 7 7 17');
    expect(row.querySelector('.tip-jar-activity-name')?.textContent).toBe('Received');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.tip-jar-activity-context')).toBeNull();
    expect(row.querySelector('.sr-only')?.textContent).toBe('Received 0.012 XMR, yesterday at 3:14 PM.');
  });

  it('falls back to the initial when there is no picture, and to Sent for a generic send', () => {
    const root = card([tip({ nameSnapshot: 'Settebello' }), tip({ txid: 's', id: 's', kind: 'send', recipientPubkey: undefined, createdAt: new Date(2026, 8, 1).toISOString() })]);
    const [creator, send] = root.querySelectorAll('.tip-jar-activity-row');
    expect(creator.querySelector('.tip-jar-activity-avatar-fallback')?.textContent).toBe('S');
    expect(send.querySelector('.tip-jar-activity-name')?.textContent).toBe('Sent');
    expect(send.querySelector('.tip-jar-activity-avatar.is-generic')).toBeTruthy();
  });

  it('marks a pending transfer lightly, without block counts or txids', () => {
    const root = card([tip({ state: 'submitted', confirmations: 0 })]);
    expect(root.querySelector('.tip-jar-activity-state')?.textContent).toBe('Pending');
    expect(root.textContent).not.toContain('tx-out');
    expect(root.textContent).not.toMatch(/confirmations|fee/i);
  });

  it('says so in one line when there is no activity, and patches in place when some arrives', () => {
    const state = appState();
    const host = document.createElement('div');
    host.innerHTML = tipJarActivityCard(state, NOW);
    expect(host.querySelector('.tip-jar-activity-empty')?.textContent).toBe('No Tip Jar activity yet.');
    const cardEl = host.querySelector('#tip-jar-activity');
    state.tipJarActivity = { pubkey: ACCOUNT, walletId: 'wallet-1', records: [received()] };
    updateTipJarActivity(host, state, NOW);
    expect(host.querySelector('#tip-jar-activity')).toBe(cardEl);
    expect(host.querySelectorAll('.tip-jar-activity-row')).toHaveLength(1);
  });

  it('never shows another account’s activity', () => {
    expect(card([received()], { pubkey: OTHER_CREATOR }).querySelector('.tip-jar-activity-row')).toBeNull();
  });

  it('formats compact days and times', () => {
    expect(activityDay(new Date(2026, 8, 18, 1), NOW).shown).toBe('Today');
    expect(activityDay(new Date(2026, 8, 17, 23), NOW).shown).toBe('Yesterday');
    expect(activityDay(new Date(2026, 8, 15), NOW)).toEqual({ shown: 'Sep 15', spoken: 'September 15' });
    expect(activityDay(new Date(2025, 11, 31), NOW).shown).toBe('Dec 31, 2025');
    expect(activityTime(new Date(2026, 8, 18, 0, 5))).toBe('12:05 AM');
    expect(activityTime(new Date(2026, 8, 18, 15, 14))).toBe('3:14 PM');
  });
});
