import type { BodyWeightEntry, Session, SessionSet, WorkstrSettings } from '../core/types';
import type { SheetWithExercises } from '../db/store';
import { BODYWEIGHT_ADDRESS, SETTINGS_ADDRESS, sessionAddress, sheetAddress } from './addresses';

export interface RecordSnapshot<T = unknown> {
  address: string;
  updatedAt: string;
  payload: T;
}

// Preferences that describe the user, not the device. `workstrRelay` and `signerType` are
// how this browser reaches the network, `canonCache` is a re-fetchable catalog copy, and
// `backup` is this device's sync state — replicating any of them would fight the device
// it landed on rather than restore anything.
export const SYNCED_SETTINGS_KEYS = ['unit', 'paymentMode', 'publicRelays', 'heightCm', 'targetWeightKg', 'ownedEquipment', 'seedVersion'] as const;

export type SyncedSettings = Pick<WorkstrSettings, typeof SYNCED_SETTINGS_KEYS[number]>;

export function syncedSettings(settings: WorkstrSettings): SyncedSettings {
  const picked: Record<string, unknown> = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    if (settings[key] !== undefined) picked[key] = settings[key];
  }
  return picked as SyncedSettings;
}

// Autoincrement keys are meaningless on another device and actively harmful if restored,
// so every payload is stripped of them and rebuilt from its natural key on merge.
function withoutLocalKeys<T extends Record<string, unknown>>(row: T, ...keys: string[]): Omit<T, string> {
  const copy = { ...row };
  for (const key of ['id', ...keys]) delete copy[key];
  return copy;
}

export function sheetRecord(sheet: SheetWithExercises): RecordSnapshot {
  return {
    address: sheetAddress(sheet.slug),
    updatedAt: sheet.updated_at || sheet.created_at,
    payload: {
      ...withoutLocalKeys(sheet as unknown as Record<string, unknown>, 'exercises'),
      exercises: (sheet.exercises || []).map((row) => withoutLocalKeys(row as unknown as Record<string, unknown>, 'sheet_id', 'exercise_id'))
    }
  };
}

// A session has no `updated_at` column: it is written once at creation and then grows sets
// for as long as it runs. The newest thing that happened to it is its modification time.
export function sessionUpdatedAt(session: Session, sets: SessionSet[]): string {
  const stamps = [session.started_at, session.finished_at, ...sets.map((set) => set.completed_at)].filter(Boolean) as string[];
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest), stamps[0] || new Date().toISOString());
}

export function sessionRecord(session: Session, sets: SessionSet[]): RecordSnapshot {
  if (!session.uid) throw new Error('session has no uid; database upgrade did not run');
  return {
    address: sessionAddress(session.uid),
    updatedAt: sessionUpdatedAt(session, sets),
    payload: {
      ...withoutLocalKeys(session as unknown as Record<string, unknown>),
      sets: sets.map((set) => withoutLocalKeys(set as unknown as Record<string, unknown>, 'session_id', 'exercise_id'))
    }
  };
}

// Body weight and settings are one record each rather than one per row: they are small,
// always read as a whole, and a per-row address would leak the training calendar into
// cleartext `d` tags on an open relay.
export function bodyweightRecord(entries: BodyWeightEntry[], updatedAt: string): RecordSnapshot {
  return {
    address: BODYWEIGHT_ADDRESS,
    updatedAt,
    payload: { entries: entries.map((entry) => withoutLocalKeys(entry as unknown as Record<string, unknown>)) }
  };
}

export function settingsRecord(settings: WorkstrSettings, updatedAt: string): RecordSnapshot<SyncedSettings> {
  return { address: SETTINGS_ADDRESS, updatedAt, payload: syncedSettings(settings) };
}
