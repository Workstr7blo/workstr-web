import type { WorkstrStore, SheetWithExercises } from '../db/store';
import type { BodyWeightEntry, Exercise, WorkstrSettings } from '../core/types';
import type { RelayProgram } from '../nostr/canon';

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
  sets: SessionSetLog[];
}

export interface QwExercise { slug: string; name: string; muscleGroup: string; sets: number; reps: string; restSec: number; score?: number }

export interface AppState {
  pubkey: string | null;
  npub: string | null;
  profileName: string | null;
  profileNames: Record<string, string>;
  store: WorkstrStore | null;
  settings: WorkstrSettings;
  signerType: 'nip07' | 'nip46' | null;
  view: View;
  subState: { exercises: 'library' | 'discover'; workouts: 'programs' | 'discover' | 'history' | 'recovery'; statistics: 'training' | 'body' };
  exercises: Exercise[];
  programs: RelayProgram[];
  expandedSessionId: number | null;
  qw: { duration: number; exercises: QwExercise[]; pool: Record<string, QwExercise[]>; meta: string; visible: boolean };
  bodyEntries: BodyWeightEntry[];
  sheets: SheetWithExercises[];
  library: Exercise[];
  librarySelect: { active: boolean; slugs: Set<string> };
  discoverSelect: { active: boolean; addresses: Set<string> };
  discoverExercises: Exercise[];
  exFilter: { cat: string; muscle: string; diff: string };
  discoverFilter: { q: string; cat: string; muscle: string; diff: string };
  activeSession: ActiveSession | null;
  finishedSessions: ActiveSession[];
  publishingSessionId: number | null;
  publishingStatus: string | null;
  editingId: number | null;
  filter: string;
  programFilter: string;
  expandedProgramAddress: string | null;
  exerciseStatus: string;
  programStatus: string;
  signInStatus: string | null;
}

// Session-model helpers shared by more than one feature (features must not
// import each other, so these live with the ActiveSession type they act on).
export function sessionExercises(session: ActiveSession): SessionExercise[] { return session.exercises || []; }

export function completedSets(sessions: ActiveSession[]): SessionSetLog[] {
  return sessions.flatMap((session) => session.sets.filter((set) => set.done));
}
