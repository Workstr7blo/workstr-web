import type { WeightUnit } from './units';

export type ISODateTime = string;
export type Slug = string;

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
  source_type: 'manual' | 'imported' | 'premium' | 'bundle' | 'nostr' | 'ai';
  status: 'active' | 'deleted';
  nostr_event_id?: string;
  nostr_pubkey?: string;
  nostr_address?: string;
  nostr_published_at?: ISODateTime;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Sheet {
  id?: number;
  slug: Slug;
  name: string;
  notes?: string;
  is_temporary: boolean;
  nostr_pubkey?: string;
  nostr_address?: string;
  nostr_event_id?: string;
  nostr_published_at?: ISODateTime;
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
  sheet_id?: number;
  sheet_name?: string;
  started_at: ISODateTime;
  finished_at?: ISODateTime;
  notes?: string;
  summary_image_url?: string;
  nostr_event_id?: string;
  exercises?: StoredSessionExercise[];
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
  completed_at: ISODateTime;
}

export interface BodyWeightEntry {
  id?: number;
  date: string;
  weight_kg: number;
  notes?: string;
}

export interface WorkstrSettings {
  unit: WeightUnit;
  publicRelays: string[];
  paidRelay?: string;
  signerType?: 'nip07' | 'nip46' | 'idenstr';
  syncCursor?: number;
  starterExercisesSeeded?: boolean;
  heightCm?: number;
  targetWeightKg?: number;
}
