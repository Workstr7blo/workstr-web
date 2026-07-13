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
  default_reps?: number;
  default_rest?: number;
  source_type: 'manual' | 'imported' | 'premium' | 'bundle';
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
  exercise_id: number;
  position: number;
  sets?: number;
  reps?: number;
  rest?: number;
  weight?: number;
}

export interface Session {
  id?: number;
  sheet_id?: number;
  started_at: ISODateTime;
  finished_at?: ISODateTime;
  notes?: string;
  summary_image_url?: string;
  nostr_event_id?: string;
}

export interface SessionSet {
  id?: number;
  session_id: number;
  exercise_id: number;
  set_number: number;
  reps: number;
  weight_kg?: number;
  rpe?: number;
  completed_at: ISODateTime;
}

export interface BodyWeightEntry {
  id?: number;
  date: string;
  weight_kg: number;
}

export interface WorkstrSettings {
  unit: WeightUnit;
  publicRelays: string[];
  paidRelay?: string;
  signerType?: 'nip07' | 'nip46' | 'idenstr';
  syncCursor?: number;
  starterExercisesSeeded?: boolean;
}
