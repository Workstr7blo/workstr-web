import type { WorkstrStore, SheetWithExercises } from '../db/store';
import type { BodyWeightEntry, Exercise, TrainingBlock, WorkstrSettings, WorkoutProgramZapAttempt } from '../core/types';
import type { RelayProgram } from '../nostr/canon';
import type { ProgramZapTotals } from '../nostr/zaps';
import type { RelayProfile } from '../nostr/pool';
import type { SupportState } from '../features/support/views';
import type { SyncStatus } from '../sync/engine';

export interface NwcViewState {
  active: boolean;
  walletLabel?: string;
  relayLabel?: string;
  savedAt?: number;
  status: 'idle' | 'connecting' | 'paying' | 'success' | 'error';
  message?: string;
}

export type View = 'exercises' | 'workouts' | 'statistics' | 'settings';
export type SubView = 'library' | 'discover' | 'programs' | 'history' | 'recovery' | 'training' | 'body';

export interface SessionExercise {
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

export interface SessionSetLog {
  exerciseSlug: string;
  exerciseName?: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  durationSec?: number;
  blockIndex?: number;
  roundIndex?: number;
  intervalIndex?: number;
  stepIndex?: number;
  done: boolean;
  completedAt: string;
}

export interface ActiveSession {
  id: number;
  sheetName: string;
  startedAt: string;
  finishedAt?: string;
  nostrEventId?: string;
  summaryImageUrl?: string;
  exercises: SessionExercise[];
  blocks?: TrainingBlock[];
  emomStartedAt?: string;
  emomPositionSec?: number;
  emomActiveSec?: number;
  emomRunningSince?: string;
  sets: SessionSetLog[];
}

export interface QwExercise { slug: string; name: string; muscleGroup: string; sets: number; reps: string; restSec: number; score?: number }

export interface AppState {
  pubkey: string | null;
  npub: string | null;
  profileName: string | null;
  profilePicture?: string | null;
  profileNames: Record<string, string>;
  authorProfiles?: Record<string, RelayProfile>;
  store: WorkstrStore | null;
  settings: WorkstrSettings;
  support: SupportState;
  nwc: NwcViewState;
  signerType: 'nip07' | 'nip46' | 'local' | null;
  view: View;
  subState: { exercises: 'library' | 'discover'; workouts: 'programs' | 'discover' | 'history' | 'recovery'; statistics: 'training' | 'body' };
  exercises: Exercise[];
  programs: RelayProgram[];
  programZapTotals?: Record<string, ProgramZapTotals>;
  programZapAttempts: WorkoutProgramZapAttempt[];
  expandedSessionId: number | null;
  // Calendar navigation is transient on purpose: month and day selection reset with the
  // session rather than persisting as a setting. Null month means "the current month".
  history: { monthKey: string | null; selectedDate: string | null };
  qw: { duration: number; exercises: QwExercise[]; pool: Record<string, QwExercise[]>; meta: string; visible: boolean };
  bodyEntries: BodyWeightEntry[];
  sheets: SheetWithExercises[];
  library: Exercise[];
  librarySelect: { active: boolean; slugs: Set<string> };
  discoverSelect: { active: boolean; addresses: Set<string> };
  discoverExercises: Exercise[];
  exFilter: { cat: string; muscle: string; diff: string; equip: string };
  discoverFilter: { q: string; cat: string; muscle: string; diff: string; equip: string };
  activeSession: ActiveSession | null;
  finishedSessions: ActiveSession[];
  publishingSessionId: number | null;
  publishingStatus: string | null;
  editingId: number | null;
  filter: string;
  programFilter: string;
  programFilters?: { goal: string; focus: string; format: string; equipment: string };
  expandedProgramAddress: string | null;
  exerciseStatus: string;
  programStatus: string;
  signInStatus: string | null;
  // Live backup status, mirrored from the sync engine so the Settings panel renders from
  // state like every other view rather than reaching into the engine.
  backup: SyncStatus;
}

// Session-model helpers shared by more than one feature (features must not
// import each other, so these live with the ActiveSession type they act on).
export function sessionExercises(session: ActiveSession): SessionExercise[] { return session.exercises || []; }

export function completedSets(sessions: ActiveSession[]): SessionSetLog[] {
  return sessions.flatMap((session) => session.sets.filter((set) => set.done));
}
