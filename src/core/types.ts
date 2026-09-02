import type { WeightUnit } from './units';

export type ISODateTime = string;
export type Slug = string;

export interface TrainingStep {
  exerciseSlug: string;
  exerciseName?: string;
  targetReps?: string;
  targetDurationSec?: number;
  weight?: number | null;
  notes?: string;
}

export interface StraightBlock {
  type: 'straight';
  rounds: number;
  steps: TrainingStep[];
  restAfterRoundSec?: number;
}

export interface EmomInterval {
  durationSec: number;
  steps: TrainingStep[];
}

export interface EmomBlock {
  type: 'emom';
  rounds: number;
  intervals: EmomInterval[];
}

export type TrainingBlock = StraightBlock | EmomBlock;

export interface Exercise {
  id?: number;
  slug: Slug;
  name: string;
  description?: string;
  category?: string;
  muscle_group?: string;
  muscles: string[];
  equipment: string[];
  difficulty?: string;
  tags: string[];
  instructions: string[];
  image_url?: string;
  favourite: boolean;
  default_sets?: number;
  default_reps?: number | string;
  default_rest?: number;
  source_type: 'manual' | 'imported' | 'bundle' | 'nostr' | 'ai';
  status: 'active' | 'deleted';
  nostr_event_id?: string;
  nostr_pubkey?: string;
  nostr_address?: string;
  nostr_published_at?: ISODateTime;
  // created_at (unix seconds) of the origin canon event this row was imported
  // from; newer remote created_at on the same address = update available.
  origin_created_at?: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Sheet {
  id?: number;
  slug: Slug;
  name: string;
  notes?: string;
  difficulty?: string;
  tags?: string[];
  blocks?: TrainingBlock[];
  is_temporary: boolean;
  // 'bundle' marks an untouched starter program. Cleared the moment the user
  // saves an edit, exactly like the nostr fields, so an edited starter counts
  // as their own work.
  source_type?: 'bundle';
  nostr_pubkey?: string;
  nostr_address?: string;
  nostr_event_id?: string;
  nostr_published_at?: ISODateTime;
  // created_at (unix seconds) of the origin canon event this sheet was imported
  // from; newer remote created_at on the same address = update available.
  origin_created_at?: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SheetExercise {
  id?: number;
  sheet_id: number;
  exercise_id?: number;
  exercise_slug?: string;
  exercise_name?: string;
  muscle_group?: string;
  image_url?: string;
  position: number;
  sets?: number;
  reps?: number | string;
  rest?: number;
  weight?: number | null;
  notes?: string;
}

export interface StoredSessionExercise {
  exerciseSlug: string;
  exerciseName: string;
  muscleGroup?: string;
  imageUrl?: string;
  sets: number;
  reps: string;
  restSec: number;
  weight?: number | string | null;
  notes?: string;
  instructions?: string[];
}

export interface Session {
  id?: number;
  // Device-independent identity. `id` is an autoincrement key, so it collides across
  // devices and cannot address a session on a relay. Backfilled for older rows at
  // database version 3.
  uid?: string;
  // V2 encrypted sync starts fresh from this app version. Older local rows stay on the
  // device and are deliberately not uploaded unless created/restored as V2 records.
  backup_version?: 1 | 2;
  sheet_id?: number;
  sheet_name?: string;
  started_at: ISODateTime;
  finished_at?: ISODateTime;
  notes?: string;
  summary_image_url?: string;
  nostr_event_id?: string;
  exercises?: StoredSessionExercise[];
  blocks?: TrainingBlock[];
  emom_started_at?: ISODateTime;
  emom_position_sec?: number;
  emom_active_sec?: number;
  emom_running_since?: ISODateTime;
}

export interface SessionSet {
  id?: number;
  session_id: number;
  exercise_id?: number;
  exercise_slug?: string;
  exercise_name?: string;
  set_number: number;
  reps: number | null;
  weight_kg?: number | null;
  rpe?: number;
  duration_sec?: number;
  block_index?: number;
  round_index?: number;
  interval_index?: number;
  step_index?: number;
  completed_at: ISODateTime;
}

export interface BodyWeightEntry {
  id?: number;
  date: string;
  weight_kg: number;
  notes?: string;
  // When this entry was last written. Body weight travels in the append-only log now,
  // and an entry with no modification time cannot be compared against another device's.
  updated_at?: ISODateTime;
}

// Raw nostr event snapshot persisted for offline Discover (structurally the
// same shape as nostr-tools Event; kept local so core/ stays dependency-free).
export interface CanonCachedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface CanonCache {
  fetchedAt: number;
  events: CanonCachedEvent[];
}

// Device-local backup state. Deliberately excluded from the synced settings record: it
// describes this device's relationship to the relay, not a user preference to replicate.
export interface BackupSettings {
  enabled: boolean;
  // V2 encrypted-sync record format. V1 monthly bundles are obsolete on the relay; older local
  // history stays local unless manually exported as JSON.
  recordFormat?: number;
  // The account's backup key, unwrapped, base64. Cached so routine launches cost the
  // signer nothing: every record is sealed and opened locally with this, and only the
  // event signature still goes to the signer. It sits beside a database that is already
  // readable on this device, so caching it exposes no workout data that was not already
  // there — but it does travel in a JSON export, which is what lets an exported archive
  // be restored and keep reading the relay.
  key?: string;
  // This device's own id, and the chunk it is currently appending to. A device only ever
  // writes its own sequence, which is what removes any contention between devices: two of
  // them can append at the same moment without ever writing the same address.
  device?: string;
  logOpenSeq?: number;
  bodyOpenSeq?: number;
  v2StartedAt?: string;
  localOnlyHistoryCount?: number;
  // Index into the deterministic backfill list, so an interrupted first run resumes
  // instead of re-uploading everything it already sent.
  backfillCursor?: number;
  backfillTotal?: number;
  lastSyncAt?: string;
  lastError?: string;
}

// Which payment surface Settings, Discover, and program cards show for creator support.
// 'lightning' is the compatibility default: NIP-57 zaps and NWC stay exactly as they are
// today. 'monero' is consumed by later NIP-A3 phases; this flag alone changes no payment
// behavior.
export type PaymentMode = 'lightning' | 'monero';

export function normalizePaymentMode(value: unknown): PaymentMode {
  return value === 'monero' ? 'monero' : 'lightning';
}

export type WorkoutProgramZapStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

// Device-local payment attempt history for workout program zaps. It gives the UI/calling
// layer a durable status handle without syncing wallet activity or NWC credentials.
export interface WorkoutProgramZapAttempt {
  id: string;
  status: WorkoutProgramZapStatus;
  programAddress: string;
  programName: string;
  programEventId?: string;
  programPubkey?: string;
  amountSats: number;
  comment?: string;
  recipientPubkey?: string;
  recipientLnurl?: string;
  invoice?: string;
  paymentHash?: string;
  feesPaidMsat?: number;
  errorCode?: string;
  errorMessage?: string;
  nwcCode?: string;
  nwcKind?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
}

// Device-local NWC wallet state. The connection string itself is a spending credential
// stored only by src/nostr/nwc-storage.ts; settings may keep non-secret local zap status
// and are still excluded from syncedSettings/manual exports as defense in depth.
export interface NwcSettings {
  programZapAttempts?: WorkoutProgramZapAttempt[];
}

export interface WorkstrSettings {
  unit: WeightUnit;
  paymentMode?: PaymentMode;
  publicRelays: string[];
  workstrRelay?: string;
  signerType?: 'nip07' | 'nip46' | 'idenstr' | 'local';
  syncCursor?: number;
  // Highest starter-seed version applied to this namespace; see db/seed.ts.
  seedVersion?: number;
  heightCm?: number;
  targetWeightKg?: number;
  // Normalized equipment keys the user owns. Drives the "My equipment" filter
  // option and keeps Quick Workout from proposing exercises you cannot do.
  ownedEquipment?: string[];
  canonCache?: CanonCache;
  backup?: BackupSettings;
  nwc?: NwcSettings;
}
