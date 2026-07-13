import { nip19, SimplePool } from 'nostr-tools';
import { renderSVG } from 'uqr';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { slugify } from '../core/ids';
import { CANONICAL_REGIONS, canonMuscle } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft, type SheetWithExercises } from '../db/store';
import starterExercises from '../data/starter-exercises.json';
import type { BodyWeightEntry, Exercise, Session, SessionSet, WorkstrSettings } from '../core/types';
import { displayWeightKg, formatWeightKg, normalizeWeightUnit, storeWeightInput, type WeightUnit } from '../core/units';
import { fetchRelayExercises, fetchRelayPrograms, WORKSTR_LIBRARY_RELAY, type RelayProgram } from '../nostr/powrLibrary';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://purplepag.es', 'wss://user.kindpag.es', 'wss://relay.nostr.band'];
const DEFAULT_SETTINGS: WorkstrSettings = { unit: 'kg', publicRelays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'] };

const RECOVERY_BODY_SVG = `<svg viewBox="0 0 230 230" xmlns="http://www.w3.org/2000/svg">
              <!-- FRONT (anterior) -->
              <g transform="translate(0,0)">
              <!-- Head (decorative) -->
              <polygon points="42.4489796,2.85714286 40,11.8367347 42.0408163,19.5918367 46.122449,23.2653061 49.7959184,25.3061224 54.6938776,22.4489796 57.5510204,19.1836735 59.1836735,10.2040816 57.1428571,2.44897959 49.7959184,0" fill="#ede7dc" stroke="#d8cfc4" stroke-width="0.5"/>
              <!-- Upper traps (front) — fold into Back, matching the back-view traps and the Traps->Back alias -->
              <polygon points="55.5102041,23.6734694 50.6122449,33.4693878 50.6122449,39.1836735 61.6326531,40 70.6122449,44.8979592 69.3877551,36.7346939 63.2653061,35.1020408 58.3673469,30.6122449" data-muscle="Back" fill="#ede7dc"/>
              <polygon points="28.9795918,44.8979592 30.2040816,37.1428571 36.3265306,35.1020408 41.2244898,30.2040816 44.4897959,24.4897959 48.9795918,33.877551 48.5714286,39.1836735 37.9591837,39.5918367" data-muscle="Back" fill="#ede7dc"/>
              <!-- Shoulders -->
              <polygon points="78.3673469,53.0612245 79.5918367,47.755102 79.1836735,41.2244898 75.9183673,37.9591837 71.0204082,36.3265306 72.244898,42.8571429 71.4285714,47.3469388" data-muscle="Shoulders" fill="#ede7dc"/>
              <polygon points="28.1632653,47.3469388 21.2244898,53.0612245 20,47.755102 20.4081633,40.8163265 24.4897959,37.1428571 28.5714286,37.1428571 26.9387755,43.2653061" data-muscle="Shoulders" fill="#ede7dc"/>
              <!-- Chest -->
              <polygon points="51.8367347,41.6326531 51.0204082,55.1020408 57.9591837,57.9591837 67.755102,55.5102041 70.6122449,47.3469388 62.0408163,41.6326531" data-muscle="Chest" fill="#ede7dc"/>
              <polygon points="29.7959184,46.5306122 31.4285714,55.5102041 40.8163265,57.9591837 48.1632653,55.1020408 47.755102,42.0408163 37.5510204,42.0408163" data-muscle="Chest" fill="#ede7dc"/>
              <!-- Core (abs) -->
              <polygon points="56.3265306,59.1836735 57.9591837,64.0816327 58.3673469,77.9591837 58.3673469,92.6530612 56.3265306,98.3673469 55.1020408,104.081633 51.4285714,107.755102 51.0204082,84.4897959 50.6122449,67.3469388 51.0204082,57.1428571" data-muscle="Core" fill="#ede7dc"/>
              <polygon points="43.6734694,58.7755102 48.5714286,57.1428571 48.9795918,67.3469388 48.5714286,84.4897959 48.1632653,107.346939 44.4897959,103.673469 40.8163265,91.4285714 40.8163265,78.3673469 41.2244898,64.4897959" data-muscle="Core" fill="#ede7dc"/>
              <!-- Core (obliques) -->
              <polygon points="68.5714286,63.2653061 67.3469388,57.1428571 58.7755102,59.5918367 60,64.0816327 60.4081633,83.2653061 65.7142857,78.7755102 66.5306122,69.7959184" data-muscle="Core" fill="#ede7dc"/>
              <polygon points="33.877551,78.3673469 33.0612245,71.8367347 31.0204082,63.2653061 32.244898,57.1428571 40.8163265,59.1836735 39.1836735,63.2653061 39.1836735,83.6734694" data-muscle="Core" fill="#ede7dc"/>
              <!-- Biceps -->
              <polygon points="16.7346939,68.1632653 17.9591837,71.4285714 22.8571429,66.122449 28.9795918,53.877551 27.755102,49.3877551 20.4081633,55.9183673" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="71.4285714,49.3877551 70.2040816,54.6938776 76.3265306,66.122449 81.6326531,71.8367347 82.8571429,68.9795918 78.7755102,55.5102041" data-muscle="Biceps" fill="#ede7dc"/>
              <!-- Triceps -->
              <polygon points="69.3877551,55.5102041 69.3877551,61.6326531 75.9183673,72.6530612 77.5510204,70.2040816 75.5102041,67.3469388" data-muscle="Triceps" fill="#ede7dc"/>
              <polygon points="22.4489796,69.3877551 29.7959184,55.5102041 29.7959184,60.8163265 22.8571429,73.0612245" data-muscle="Triceps" fill="#ede7dc"/>
              <!-- Forearms -->
              <polygon points="6.12244898,88.5714286 10.2040816,75.1020408 14.6938776,70.2040816 16.3265306,74.2857143 19.1836735,73.4693878 4.48979592,97.5510204 0,100" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="84.4897959,69.7959184 83.2653061,73.4693878 80,73.0612245 95.1020408,98.3673469 100,100.408163 93.4693878,89.3877551 89.7959184,76.3265306" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="77.5510204,72.244898 77.5510204,77.5510204 80.4081633,84.0816327 85.3061224,89.7959184 92.244898,101.22449 94.6938776,99.5918367" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="6.93877551,101.22449 13.4693878,90.6122245 18.7755102,84.0816327 21.6326531,77.1428571 21.2244898,71.8367347 4.89795918,98.7755102" data-muscle="Biceps" fill="#ede7dc"/>
              <!-- Quadriceps -->
              <polygon points="34.6938776,98.7755102 37.1428571,108.163265 37.1428571,127.755102 34.2857143,137.142857 31.0204082,132.653061 29.3877551,120 28.1632653,111.428571 29.3877551,100.816327 32.244898,94.6938776" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="63.2653061,105.714286 64.4897959,100 66.9387755,94.6938776 70.2040816,101.22449 71.0204082,111.836735 68.1632653,133.061224 65.3061224,137.55102 62.4489796,128.571429 62.0408163,111.428571" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="38.7755102,129.387755 38.3673469,112.244898 41.2244898,118.367347 44.4897959,129.387755 42.8571429,135.102041 40,146.122449 36.3265306,146.530612 35.5102041,140" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="59.5918367,145.714286 55.5102041,128.979592 60.8163265,113.877551 61.2244898,130.204082 64.0816327,139.591837 62.8571429,146.530612" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="32.6530612,138.367347 26.5306122,145.714286 25.7142857,136.734694 25.7142857,127.346939 26.9387755,114.285714 29.3877551,133.469388" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="71.8367347,113.061224 73.877551,124.081633 73.877551,140.408163 72.6530612,145.714286 66.5306122,138.367347 70.2040816,133.469388" data-muscle="Quadriceps" fill="#ede7dc"/>
              <!-- Quadriceps (abductors) -->
              <polygon points="52.6530612,110.204082 54.2857143,124.897959 60,110.204082 62.0408163,100 64.8979592,94.2857143 60,92.6530612 56.7346939,104.489796" data-muscle="Quadriceps" fill="#ede7dc"/>
              <polygon points="47.755102,110.612245 44.8979592,125.306122 42.0408163,115.918367 40.4081633,113.061224 39.5918367,107.346939 37.9591837,102.44898 34.6938776,93.877551 39.5918367,92.244898 41.6326531,99.1836735 43.6734694,105.306122" data-muscle="Quadriceps" fill="#ede7dc"/>
              <!-- Knees (decorative) -->
              <polygon points="33.877551,140 34.6938776,143.265306 35.5102041,147.346939 36.3265306,151.020408 35.1020408,156.734694 29.7959184,156.734694 27.3469388,152.653061 27.3469388,147.346939 30.2040816,144.081633" fill="#ede7dc"/>
              <polygon points="65.7142857,140 72.244898,147.755102 72.244898,152.244898 69.7959184,157.142857 64.8979592,156.734694 62.8571429,151.020408" fill="#ede7dc"/>
              <!-- Calves -->
              <polygon points="71.4285714,160.408163 73.4693878,153.469388 76.7346939,161.22449 79.5918367,167.755102 78.3673469,187.755102 79.5918367,195.510204 74.6938776,195.510204" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="24.8979592,194.693878 27.755102,164.897959 28.1632653,160.408163 26.122449,154.285714 24.8979592,157.55102 22.4489796,161.632653 20.8163265,167.755102 22.0408163,188.163265 20.8163265,195.510204" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="72.6530612,195.102041 69.7959184,159.183673 65.3061224,158.367347 64.0816327,162.44898 64.0816327,165.306122 65.7142857,177.142857" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="35.5102041,158.367347 35.9183673,162.44898 35.9183673,166.938776 35.1020408,172.244898 35.1020408,176.734694 32.244898,182.040816 30.6122449,187.346939 26.9387755,194.693878 27.3469388,187.755102 28.1632653,180.408163 28.5714286,175.510204 28.9795918,169.795918 29.7959184,164.081633 30.2040816,158.77551" data-muscle="Calves" fill="#ede7dc"/>
              </g>
              <!-- BACK (posterior) -->
              <g transform="translate(130,0)">
              <!-- Head (decorative) -->
              <polygon points="50.6382979,0 45.9574468,0.85106383 40.8510638,5.53191489 40.4255319,12.7659574 45.106383,20 55.7446809,20 59.1489362,13.6170213 59.5744681,4.68085106 55.7446809,1.27659574" fill="#ede7dc" stroke="#d8cfc4" stroke-width="0.5"/>
              <!-- Traps -->
              <polygon points="44.6808511,21.7021277 47.6595745,21.7021277 47.2340426,38.2978723 47.6595745,64.6808511 38.2978723,53.1914894 35.3191489,40.8510638 31.0638298,36.5957447 39.1489362,33.1914894 43.8297872,27.2340426" data-muscle="Back" fill="#ede7dc"/>
              <polygon points="52.3404255,21.7021277 55.7446809,21.7021277 56.5957447,27.2340426 60.8510638,32.7659574 68.9361702,36.5957447 64.6808511,40.4255319 61.7021277,53.1914894 52.3404255,64.6808511 53.1914894,38.2978723" data-muscle="Back" fill="#ede7dc"/>
              <!-- Shoulders (back deltoids) -->
              <polygon points="29.3617021,37.0212766 22.9787234,39.1489362 17.4468085,44.2553191 18.2978723,53.6170213 24.2553191,49.3617021 27.2340426,46.3829787" data-muscle="Shoulders" fill="#ede7dc"/>
              <polygon points="71.0638298,37.0212766 78.2978723,39.5744681 82.5531915,44.6808511 81.7021277,53.6170213 74.893617,48.9361702 72.3404255,45.106383" data-muscle="Shoulders" fill="#ede7dc"/>
              <!-- Back (upper back) -->
              <polygon points="31.0638298,38.7234043 28.0851064,48.9361702 28.5106383,55.3191489 34.0425532,75.3191489 47.2340426,71.0638298 47.2340426,66.3829787 36.5957447,54.0425532 33.6170213,41.2765957" data-muscle="Back" fill="#ede7dc"/>
              <polygon points="68.9361702,38.7234043 71.9148936,49.3617021 71.4893617,56.1702128 65.9574468,75.3191489 52.7659574,71.0638298 52.7659574,66.3829787 63.4042553,54.4680851 66.3829787,41.7021277" data-muscle="Back" fill="#ede7dc"/>
              <!-- Triceps -->
              <polygon points="26.8085106,49.787234 17.8723404,55.7446809 14.4680851,72.3404255 16.5957447,81.7021277 21.7021277,63.8297872 26.8085106,55.7446809" data-muscle="Triceps" fill="#ede7dc"/>
              <polygon points="73.6170213,50.212766 82.1276596,55.7446809 85.9574468,73.1914894 83.4042553,82.1276596 77.8723404,62.9787234 73.1914894,55.7446809" data-muscle="Triceps" fill="#ede7dc"/>
              <polygon points="26.8085106,58.2978723 26.8085106,68.5106383 22.9787234,75.3191489 19.1489362,77.4468085 22.5531915,65.5319149" data-muscle="Triceps" fill="#ede7dc"/>
              <polygon points="72.7659574,58.2978723 77.0212766,64.6808511 80.4255319,77.4468085 76.5957447,75.3191489 72.7659574,68.9361702" data-muscle="Triceps" fill="#ede7dc"/>
              <!-- Lower Back -->
              <polygon points="47.6595745,72.7659574 34.4680851,77.0212766 35.3191489,83.4042553 49.3617021,102.12766 46.8085106,82.9787234" data-muscle="Back" fill="#ede7dc"/>
              <polygon points="52.3404255,72.7659574 65.5319149,77.0212766 64.6808511,83.4042553 50.6382979,102.12766 53.1914894,83.8297872" data-muscle="Back" fill="#ede7dc"/>
              <!-- Forearms -->
              <polygon points="86.3829787,75.7446809 91.0638298,83.4042553 93.1914894,94.0425532 100,106.382979 96.1702128,104.255319 88.0851064,89.3617021 84.2553191,83.8297872" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="13.6170213,75.7446809 8.93617021,83.8297872 6.80851064,93.6170213 0,106.382979 3.82978723,104.255319 12.3404255,88.5106383 15.7446809,82.9787234" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="81.2765957,79.5744681 77.4468085,77.8723404 79.1489362,84.6808511 91.0638298,103.829787 93.1914894,108.93617 94.4680851,104.680851" data-muscle="Biceps" fill="#ede7dc"/>
              <polygon points="18.7234043,79.5744681 22.1276596,77.8723404 20.8510638,84.2553191 9.36170213,102.978723 6.80851064,108.510638 5.10638298,104.680851" data-muscle="Biceps" fill="#ede7dc"/>
              <!-- Glutes -->
              <polygon points="44.6808511,99.5744681 30.212766,108.510638 29.787234,118.723404 31.4893617,125.957447 47.2340426,121.276596 49.3617021,114.893617" data-muscle="Glutes" fill="#ede7dc"/>
              <polygon points="55.3191489,99.1489362 51.0638298,114.468085 52.3404255,120.851064 68.0851064,125.957447 69.787234,119.148936 69.3617021,108.510638" data-muscle="Glutes" fill="#ede7dc"/>
              <!-- Hamstrings -->
              <polygon points="28.9361702,122.12766 31.0638298,129.361702 36.5957447,125.957447 35.3191489,135.319149 34.4680851,150.212766 29.3617021,158.297872 28.9361702,146.808511 27.6595745,141.276596 27.2340426,131.489362" data-muscle="Hamstrings" fill="#ede7dc"/>
              <polygon points="71.4893617,121.702128 69.3617021,128.93617 63.8297872,125.957447 65.5319149,136.595745 66.3829787,150.212766 71.0638298,158.297872 71.4893617,147.659574 72.7659574,142.12766 73.6170213,131.914894" data-muscle="Hamstrings" fill="#ede7dc"/>
              <polygon points="38.7234043,125.531915 44.2553191,145.957447 40.4255319,166.808511 36.1702128,152.765957 37.0212766,135.319149" data-muscle="Hamstrings" fill="#ede7dc"/>
              <polygon points="61.7021277,125.531915 63.4042553,136.170213 64.2553191,153.191489 60,166.808511 56.1702128,146.382979" data-muscle="Hamstrings" fill="#ede7dc"/>
              <!-- Hamstrings (abductors) -->
              <polygon points="48.0851064,122.978723 44.6808511,122.978723 41.2765957,125.531915 45.106383,144.255319 48.5106383,135.744681 48.9361702,129.361702" data-muscle="Hamstrings" fill="#ede7dc"/>
              <polygon points="51.9148936,122.553191 55.7446809,123.404255 59.1489362,125.957447 54.893617,144.255319 51.9148936,136.170213 51.0638298,129.361702" data-muscle="Hamstrings" fill="#ede7dc"/>
              <!-- Knees (decorative) -->
              <polygon points="34.4680851,153.191489 31.0638298,159.148936 33.6170213,166.382979 37.4468085,162.553191" fill="#ede7dc"/>
              <polygon points="66.3829787,153.617021 62.9787234,162.978723 66.8085106,166.382979 69.3617021,159.148936" fill="#ede7dc"/>
              <!-- Calves -->
              <polygon points="29.3617021,160.425532 28.5106383,167.234043 24.6808511,179.574468 23.8297872,192.765957 25.5319149,197.021277 28.5106383,193.191489 29.787234,180 31.9148936,171.06383 31.9148936,166.808511" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="37.4468085,165.106383 35.3191489,167.659574 33.1914894,171.914894 31.0638298,180.425532 30.212766,191.914894 34.0425532,200 38.7234043,190.638298 39.1489362,168.93617" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="62.9787234,165.106383 61.2765957,168.510638 61.7021277,190.638298 66.3829787,199.574468 70.6382979,191.914894 68.9361702,179.574468 66.8085106,170.212766" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="70.6382979,160.425532 72.3404255,168.510638 75.7446809,179.148936 76.5957447,192.765957 74.4680851,196.595745 72.3404255,193.617021 70.6382979,179.574468 68.0851064,168.085106" data-muscle="Calves" fill="#ede7dc"/>
              <!-- Soleus (calves) -->
              <polygon points="28.5106383,195.744681 30.212766,195.744681 33.6170213,201.702128 30.6382979,220 28.5106383,213.617021 26.8085106,198.297872" data-muscle="Calves" fill="#ede7dc"/>
              <polygon points="69.787234,195.744681 71.9148936,195.744681 73.6170213,198.297872 71.9148936,213.191489 70.212766,219.574468 67.2340426,202.12766" data-muscle="Calves" fill="#ede7dc"/>
              </g>
              </svg>`;

type View = 'exercises' | 'workouts' | 'statistics' | 'settings';
type SubView = 'library' | 'discover' | 'programs' | 'history' | 'recovery' | 'training' | 'body';

interface SessionExercise {
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

interface SessionSetLog {
  exerciseSlug: string;
  exerciseName?: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  done: boolean;
  completedAt: string;
}

interface ActiveSession {
  id: number;
  sheetName: string;
  startedAt: string;
  finishedAt?: string;
  exercises: SessionExercise[];
  sets: SessionSetLog[];
}

interface AppState {
  pubkey: string | null;
  npub: string | null;
  profileName: string | null;
  profileNames: Record<string, string>;
  store: WorkstrStore | null;
  settings: WorkstrSettings;
  signerType: 'nip07' | 'nip46' | 'demo' | null;
  view: View;
  subState: { exercises: 'library' | 'discover'; workouts: 'programs' | 'discover' | 'history' | 'recovery'; statistics: 'training' | 'body' };
  exercises: Exercise[];
  programs: RelayProgram[];
  expandedSessionId: number | null;
  qw: { duration: number; exercises: QwExercise[]; pool: Record<string, QwExercise[]>; meta: string; visible: boolean };
  bodyEntries: BodyWeightEntry[];
  sheets: SheetWithExercises[];
  activeSession: ActiveSession | null;
  finishedSessions: ActiveSession[];
  editingId: number | null;
  filter: string;
  programFilter: string;
  expandedProgramAddress: string | null;
  exerciseStatus: string;
  programStatus: string;
  signInStatus: string | null;
}

const navItems: Array<{ view: View; label: string; icon: string }> = [
  { view: 'exercises', label: 'Exercises', icon: '<path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/>' },
  { view: 'workouts', label: 'Workouts', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>' },
  { view: 'statistics', label: 'Statistics', icon: '<path d="M18 20V10M12 20V4M6 20v-6"/>' },
  { view: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' }
];

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
}

function displayNpub(pubkey: string): string {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  return shortNpub(pubkey);
}

function displayIdentity(state: AppState): string {
  if (!state.pubkey) return '';
  if (state.profileName) return state.profileName;
  return displayNpub(state.pubkey);
}

async function fetchProfileName(pubkey: string): Promise<string | null> {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  const pool = new SimplePool();
  try {
    const event = await Promise.race([
      pool.get(PROFILE_RELAYS, { kinds: [0], authors: [pubkey] }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000))
    ]);
    if (!event) return null;
    const profile = JSON.parse(event.content) as { display_name?: string; displayName?: string; name?: string; username?: string; nip05?: string };
    return profile.display_name?.trim() || profile.displayName?.trim() || profile.name?.trim() || profile.username?.trim() || profile.nip05?.trim() || null;
  } catch {
    return null;
  } finally {
    pool.close(PROFILE_RELAYS);
  }
}

function displayPubkey(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey).slice(0, 12) + '…' + nip19.npubEncode(pubkey).slice(-8);
  } catch {
    return pubkey.slice(0, 8) + '…';
  }
}

function html(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function sourceBadge(exercise: Exercise): string {
  if (exercise.nostr_address) return 'workstr';
  return exercise.source_type;
}

function shellMarkup(state: AppState): string {
  return `
    <div class="noise"></div>
    <div class="cyber-grid"></div>
    <header class="topbar">
      <div class="logo-zone">
        <div class="glyph">W</div>
        <div class="logo-text">
          <div class="logo-mark">Work<span>str</span></div>
          <div class="logo-tagline">sovereign training</div>
        </div>
      </div>
      <div class="topbar-actions">
        ${state.pubkey
          ? `<small id="live-status">${html(displayIdentity(state))}</small><button id="sign-out" class="button small ghost">Switch</button>`
          : '<button id="sign-in" class="button small primary">Sign in</button>'}
      </div>
    </header>
    <nav class="sidebar">
      <div class="nav-items">
        ${navItems.map((item, index) => `${index === navItems.length - 1 ? '<div class="nav-bottom">' : ''}<div class="nav-item ${state.view === item.view ? 'active' : ''}" data-view="${item.view}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg><span>${item.label}</span></div>${index === navItems.length - 1 ? '</div>' : ''}`).join('')}
      </div>
    </nav>
    <main class="content">
      ${appView(state)}
    </main>
    ${sessionOverlayMarkup(state)}
    <div id="modal" class="modal"><div class="modal-card"><button id="modal-close" class="modal-close" type="button">×</button><div id="modal-content"></div></div></div>
    <div id="toast"></div>
    <div id="toast"></div>`;
}


function sessionOverlayMarkup(state: AppState): string {
  return `<div id="session-overlay" class="session-overlay ${state.activeSession ? 'open' : ''}">
    <div class="session-bg"></div>
    <div class="session-header">
      <div class="session-head-main">
        <div class="session-eyebrow">Live session</div>
        <div id="session-title" class="session-title">Workout</div>
        <div class="session-meta-line"><span id="session-meta" class="session-meta">Exercise 1 of 1</span><span class="session-elapsed-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span id="session-elapsed" class="session-elapsed">00:00</span></span></div>
      </div>
      <button id="session-close" class="session-close-btn" type="button">End</button>
    </div>
    <div class="session-progress"><div id="session-progress-fill" class="session-progress-fill"></div></div>
    <div id="session-ex-nav" class="session-ex-nav"></div>
    <div id="pr-toast" class="pr-toast"></div>
    <div id="session-body" class="session-body"></div>
    <div id="session-footer" class="session-footer"></div>
    <div id="session-rest-overlay" class="session-rest-overlay">
      <div class="rest-label">Rest</div>
      <div class="rest-timer-wrap"><svg class="rest-ring" viewBox="0 0 120 120"><circle class="rest-ring-bg" cx="60" cy="60" r="54" stroke-width="8"/><circle id="rest-ring-fg" class="rest-ring-fg" cx="60" cy="60" r="54" stroke-width="8" stroke-dasharray="339.3" stroke-dashoffset="0"/></svg><div id="session-rest-val" class="rest-timer-val">90</div></div>
      <div id="rest-nextup" class="rest-nextup"></div>
      <div class="rest-adjust-btns"><button class="rest-adjust-btn" data-rest-adjust="-15" type="button">-15s</button><button class="rest-skip-btn" id="rest-skip" type="button">Skip Rest</button><button class="rest-adjust-btn" data-rest-adjust="15" type="button">+15s</button></div>
    </div>
  </div>`;
}

function appView(state: AppState): string {
  if (state.view === 'workouts') return workoutsView(state);
  if (state.view === 'statistics') return statisticsView(state);
  if (state.view === 'settings') return settingsView(state);
  return exercisesView(state);
}

function authNotice(state: AppState): string {
  if (state.pubkey) return '';
  return `<div class="panel web-status-note"><div class="panel-head"><span>Signer required</span><span class="status-pill bad">not signed in</span></div><p class="section-help">Sign in with your Nostr signer to open the local IndexedDB namespace for your training data. Keys stay in your signer.</p>${state.signInStatus ? `<div class="terminal-mini">${html(state.signInStatus)}</div>` : ''}</div>`;
}

function subTabs(parent: View, active: string, tabs: string[]): string {
  return `<div class="sub-tabs">${tabs.map((tab) => {
    const value = tab.toLowerCase();
    return `<div class="sub-tab ${active === value ? 'active' : ''}" data-parent="${parent}" data-subtab="${value}">${html(tab)}</div>`;
  }).join('')}</div>`;
}

function exercisesView(state: AppState): string {
  const query = state.filter.toLowerCase();
  const exercises = state.exercises.filter((exercise) => {
    const haystack = [exercise.name, exercise.description, exercise.muscle_group, exercise.difficulty, ...exercise.muscles, ...exercise.equipment, ...exercise.tags].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const active = state.subState.exercises;
  return `<div class="page active" id="page-exercises">
    <div class="page-title">Exercises</div>
    ${subTabs('exercises', active, ['Library', 'Discover'])}
    ${authNotice(state)}
    <div class="sub-panel ${active === 'library' ? 'active' : ''}" id="sub-exercises-library">
      <div class="panel">
        <div class="filter-bar"><input class="grow" id="exercise-filter" placeholder="Search exercises..." autocomplete="off" value="${html(state.filter)}" /><select><option>All categories</option></select><select><option>All muscles</option></select><select><option>All levels</option></select></div>
        <div class="ex-grid">${exercises.map(exerciseCard).join('') || '<div class="empty">No exercises match.</div>'}</div>
      </div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-exercises-discover">
      <div class="panel">
        <div class="filter-bar"><input class="grow" placeholder="Search exercises..." autocomplete="off" /><select><option>All categories</option></select><select><option>All muscles</option></select><select><option>All levels</option></select></div>
        <div class="ex-grid"></div>
      </div>
    </div>
  </div>`;
}

function exerciseCard(exercise: Exercise): string {
  return `<div class="ex-card" data-id="${exercise.id ?? exercise.nostr_event_id ?? exercise.slug}">
    <div class="card-img">${exercise.image_url ? `<img src="${html(exercise.image_url)}" alt="${html(exercise.name)}" loading="lazy" />` : '<div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>'}<span class="source-badge badge-nostr">${html(sourceBadge(exercise))}</span>${exercise.difficulty ? `<span class="diff-badge diff-${html(exercise.difficulty)}">${html(exercise.difficulty)}</span>` : ''}</div>
    <div class="card-body"><div class="card-name">${html(exercise.name)}<button class="fav ${exercise.favourite ? 'on' : ''}" title="Favourite">${exercise.favourite ? '★' : '☆'}</button></div><div class="card-meta"><span class="muscle">${html(exercise.muscle_group || exercise.muscles[0] || 'Muscle')}</span>${exercise.category ? `<span class="card-tag">${html(exercise.category)}</span>` : ''}</div><div class="detail-nostr"><code>${html(exercise.nostr_address || '')}</code></div></div>
  </div>`;
}

function exerciseForm(exercise?: Exercise): string {
  const muscle = exercise?.muscle_group || exercise?.muscles[0] || 'Chest';
  return `<form id="exercise-form" class="form-grid">
    <input type="hidden" name="id" value="${html(exercise?.id ?? '')}" />
    <label class="span-2">Name<input name="name" required value="${html(exercise?.name ?? '')}" /></label>
    <label>Category<input name="category" value="${html(exercise?.category ?? 'strength')}" /></label>
    <label>Muscle group<select name="muscle_group">${CANONICAL_REGIONS.map((region) => `<option ${region === muscle ? 'selected' : ''}>${region}</option>`).join('')}</select></label>
    <label>Difficulty<select name="difficulty">${['beginner', 'intermediate', 'advanced'].map((level) => `<option ${level === exercise?.difficulty ? 'selected' : ''}>${level}</option>`).join('')}</select></label>
    <label>Equipment (comma)<input name="equipment" value="${html(exercise?.equipment.join(', ') ?? '')}" /></label>
    <label>Default sets<input name="sets" type="number" min="1" value="${html(exercise?.default_sets ?? 3)}" /></label>
    <label>Default reps<input name="reps" value="${html(exercise?.default_reps ?? 10)}" /></label>
    <label>Default rest (sec)<input name="rest" type="number" min="0" value="${html(exercise?.default_rest ?? 90)}" /></label>
    <label class="span-2">Description<textarea name="description" rows="3">${html(exercise?.description ?? '')}</textarea></label>
    <label class="span-2">Instructions (one per line)<textarea name="instructions" rows="3">${html(exercise?.instructions.join('\n') ?? '')}</textarea></label>
    <div class="form-actions span-2"><button class="button primary" type="submit">${exercise ? 'Save' : 'Create'}</button>${exercise ? '<button id="cancel-edit" class="button ghost" type="button">Cancel</button>' : ''}</div>
  </form>`;
}

function sessionExercises(session: ActiveSession): SessionExercise[] { return session.exercises || []; }

function workoutVolume(session: ActiveSession): number {
  return session.sets.filter((set) => set.done).reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0);
}

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? (iso || '') : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function sessionDuration(session: ActiveSession): string {
  if (!session.startedAt || !session.finishedAt) return '';
  const min = Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
  if (!Number.isFinite(min) || min <= 0) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

function muscleSetsForSlugs(slugs: string[], fallbackGroups: string[], exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const group of fallbackGroups) { const canonical = canonMuscle(group); if (canonical) primary.add(canonical); }
  for (const slug of slugs) {
    const full = exercises.find((exercise) => exercise.slug === slug);
    const canonicalPrimary = canonMuscle(full?.muscle_group || '');
    if (canonicalPrimary) primary.add(canonicalPrimary);
    for (const raw of full?.muscles || []) { const canonical = canonMuscle(raw); if (canonical) secondary.add(canonical); }
  }
  primary.forEach((muscle) => secondary.delete(muscle));
  return { primary, secondary };
}

function sessionMuscleSets(session: ActiveSession, exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const slugs = [...new Set(sessionExercises(session).map((member) => member.exerciseSlug))];
  const fallbackGroups = sessionExercises(session).map((member) => member.muscleGroup || '').filter(Boolean);
  return muscleSetsForSlugs(slugs, fallbackGroups, exercises);
}

function sessionMuscleGroupNames(session: ActiveSession, exercises: Exercise[]): string[] {
  const names = new Set<string>();
  for (const member of sessionExercises(session)) {
    if (member.muscleGroup) names.add(member.muscleGroup);
    const full = exercises.find((exercise) => exercise.slug === member.exerciseSlug);
    if (full?.muscle_group) names.add(full.muscle_group);
  }
  return [...names].filter(Boolean);
}

function sessionDetail(session: ActiveSession, unit: WeightUnit): string {
  const byEx = new Map<string, SessionSetLog[]>();
  for (const set of session.sets.filter((item) => item.done)) {
    if (!byEx.has(set.exerciseSlug)) byEx.set(set.exerciseSlug, []);
    byEx.get(set.exerciseSlug)!.push(set);
  }
  const exName = (slug: string) => sessionExercises(session).find((member) => member.exerciseSlug === slug)?.exerciseName || slug;
  const rows = [...byEx.entries()].map(([slug, sets]) => {
    const pills = [...sets].sort((a, b) => a.setNumber - b.setNumber).map((set) =>
      `<span class="set-pill">${set.reps ?? '?'}${set.weight != null ? ` × ${html(formatWeightKg(set.weight, unit))}` : ''}</span>`
    ).join('');
    return `<div class="session-detail-ex">
      <div class="session-detail-ex-name">${html(exName(slug))}</div>
      <div class="session-detail-sets">${pills}</div>
    </div>`;
  }).join('');
  return `<div class="session-detail">
    ${rows || '<p class="empty" style="padding:6px 0 12px">No sets were logged in this session.</p>'}
    <div class="workout-card-actions">
      <button class="button primary small" disabled title="Publishing summaries arrives with the Nostr share block">Publish summary</button>
      <button class="button danger small" data-delete-session="${session.id}">Delete session</button>
    </div>
  </div>`;
}

function workoutHistory(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  if (!state.finishedSessions.length) return '<div class="list empty">No completed sessions yet. Finish a workout to see it here.</div>';
  return `<div class="program-list" id="history-list">${state.finishedSessions.map((session) => {
    const doneSets = session.sets.filter((set) => set.done);
    const volume = workoutVolume(session);
    const meta = [
      formatSessionDate(session.finishedAt || session.startedAt),
      sessionDuration(session),
      `${doneSets.length} set${doneSets.length === 1 ? '' : 's'}`,
      volume > 0 ? `${Math.round(displayWeightKg(volume, unit) || 0)} ${unit} volume` : ''
    ].filter(Boolean).join(' · ');
    const groups = sessionMuscleGroupNames(session, state.exercises);
    const { primary, secondary } = sessionMuscleSets(session, state.exercises);
    const map = paintBodyMapSvg(primary, secondary);
    const expanded = state.expandedSessionId === session.id;
    return `<div class="workout-card ${expanded ? 'expanded' : ''}" data-session="${session.id}">
      <div class="workout-card-header" data-toggle-session="${session.id}">
        <div class="workout-card-map ${map ? 'has-map' : ''}" data-session-map="${session.id}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'}</div>
        <div class="workout-card-info">
          <div class="workout-card-name">${html(session.sheetName || 'Freestyle')}</div>
          <div class="workout-card-meta">${meta}</div>
          ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
        </div>
        <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="workout-card-body" data-session-body="${session.id}">${expanded ? sessionDetail(session, unit) : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

function completedSets(sessions: ActiveSession[]): SessionSetLog[] {
  return sessions.flatMap((session) => session.sets.filter((set) => set.done));
}

// SQLite strftime('%Y-%W') equivalent: week of year 00-53, Monday-based,
// computed on the UTC date like self-hosted datetime strings.
function sqliteWeek(iso: string): string {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  const yday = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const wdayMon = (date.getUTCDay() + 6) % 7;
  const week = Math.floor((yday + 6 - wdayMon) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

// Ported verbatim from self-hosted Workstr src/app/store.js computeStreak().
function computeStreak(sessions: ActiveSession[]): number {
  const dates = [...new Set(sessions.filter((session) => session.finishedAt).map((session) => new Date(session.startedAt).toISOString().slice(0, 10)))].sort().reverse();
  if (!dates.length) return 0;
  const dayMs = 86400000;
  const stripTime = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // allow today or yesterday to start the streak
  if (Math.round((stripTime(new Date()) - stripTime(new Date(dates[0]))) / dayMs) > 1) return 0;
  let expect = stripTime(new Date(dates[0]));
  let streak = 0;
  for (const value of dates) {
    const day = stripTime(new Date(value));
    if (day === expect) { streak += 1; expect -= dayMs; }
    else if (day < expect) break;
  }
  return streak;
}

interface WorkstrStats {
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  weekly: { week: string; volume: number }[];
  muscle: { muscle: string; sets: number }[];
  prs: { slug: string; name: string; e1rm: number; topWeight: number }[];
  streak: number;
}

// Ported verbatim from self-hosted Workstr src/app/store.js getStats().
export function getStats(sessions: ActiveSession[], exercises: Exercise[]): WorkstrStats {
  const sets = completedSets(sessions);
  const totalSessions = sessions.length;
  const totalSets = sets.length;
  const totalVolume = Math.round(sets.reduce((total, set) => total + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));

  // Weekly volume (last 8 weeks)
  const weekTotals: Record<string, number> = {};
  for (const session of sessions) {
    const week = sqliteWeek(session.startedAt);
    for (const set of session.sets) {
      if (set.done) weekTotals[week] = (weekTotals[week] || 0) + (Number(set.reps) || 0) * (Number(set.weight) || 0);
    }
  }
  const weekly = Object.entries(weekTotals).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).reverse()
    .map(([week, volume]) => ({ week, volume: Math.round(volume) }));

  // Muscle distribution by sets
  const lookup = (session: ActiveSession, slug: string) =>
    exercises.find((exercise) => exercise.slug === slug)?.muscle_group
    || sessionExercises(session).find((member) => member.exerciseSlug === slug)?.muscleGroup
    || 'Other';
  const muscleTotals: Record<string, number> = {};
  for (const session of sessions) {
    for (const set of session.sets.filter((item) => item.done)) {
      const muscle = lookup(session, set.exerciseSlug) || 'Other';
      muscleTotals[muscle] = (muscleTotals[muscle] || 0) + 1;
    }
  }
  const muscle = Object.entries(muscleTotals).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ muscle: name, sets: count }));

  // Personal records: best estimated 1RM (Epley) per exercise
  const prMap = new Map<string, { name: string; e1rm: number; topWeight: number }>();
  for (const session of sessions) {
    for (const set of session.sets.filter((item) => item.done && item.weight != null && item.reps != null && Number(item.weight) > 0)) {
      const e1rm = Number(set.weight) * (1 + Number(set.reps) / 30);
      const name = exercises.find((exercise) => exercise.slug === set.exerciseSlug)?.name
        || sessionExercises(session).find((member) => member.exerciseSlug === set.exerciseSlug)?.exerciseName
        || set.exerciseSlug;
      const existing = prMap.get(set.exerciseSlug);
      if (!existing) prMap.set(set.exerciseSlug, { name, e1rm, topWeight: Number(set.weight) });
      else {
        existing.e1rm = Math.max(existing.e1rm, e1rm);
        existing.topWeight = Math.max(existing.topWeight, Number(set.weight));
      }
    }
  }
  const prs = [...prMap.entries()]
    .map(([slug, record]) => ({ slug, name: record.name, e1rm: Math.round(record.e1rm * 10) / 10, topWeight: record.topWeight }))
    .sort((a, b) => b.e1rm - a.e1rm)
    .slice(0, 12);

  return { totalSessions, totalSets, totalVolume, weekly, muscle, prs, streak: computeStreak(sessions) };
}

function trainingStatsView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const stats = getStats(state.finishedSessions, state.exercises);
  const max = Math.max(1, ...stats.weekly.map((week) => week.volume));
  const bars = stats.weekly.length
    ? stats.weekly.map((week) => `<div class="bar"><div class="fill" style="height:${Math.round((week.volume / max) * 100)}%"></div><span class="blabel">${html(week.week.split('-')[1])}</span></div>`).join('')
    : '<div class="empty">No volume logged yet.</div>';
  const distMax = Math.max(1, ...stats.muscle.map((entry) => entry.sets));
  const dist = stats.muscle.length
    ? `<div id="prog-dist" class="dist">${stats.muscle.map((entry) => `<div class="dist-row"><small>${html(entry.muscle)}</small><div class="track"><div class="fill" style="width:${Math.round((entry.sets / distMax) * 100)}%"></div></div><small>${entry.sets}</small></div>`).join('')}</div>`
    : '<div id="prog-dist" class="dist empty">No logged sets yet.</div>';
  const prs = stats.prs.length
    ? `<div id="prog-prs" class="list">${stats.prs.map((record) => `<div class="row"><div><strong>${html(record.name)}</strong><small>top ${displayWeightKg(record.topWeight, unit)} ${unit}</small></div><span class="badge muscle">${displayWeightKg(record.e1rm, unit)} ${unit} 1RM</span></div>`).join('')}</div>`
    : '<div id="prog-prs" class="list empty">No records yet.</div>';
  return `<div class="stats-hero">
    <div class="summary-stat">
      <div class="ss-val"><svg id="stat-streak-flame" class="flame ${stats.streak > 0 ? 'active' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4-2.5-7-6.5-7-11 0-3 2-5.5 4-7 .5 2.5 2 4 4 5 0-3 1.5-6 3-8 1.5 2 3 5 3 8 2-1 3.5-2.5 4-5 1.5 2.5 1 6-1 9s-5.5 5.5-10 9z"/></svg><span id="stat-streak">${stats.streak}</span></div>
      <div class="ss-label">Day streak</div>
    </div>
    <div class="summary-stat">
      <div class="ss-val"><span id="stat-sessions">${stats.totalSessions}</span></div>
      <div class="ss-label">Total sessions</div>
    </div>
    <div class="summary-stat">
      <div class="ss-val"><span id="stat-volume">${Math.round(displayWeightKg(stats.totalVolume, unit) || 0).toLocaleString()}</span><small id="stat-volume-unit" class="ss-unit">${unit}</small></div>
      <div class="ss-label">Total volume</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><span>Weekly volume</span></div>
    <div id="prog-bars" class="bars">${bars}</div>
    <div class="subsection-head"><span>Muscle distribution</span><small>by working sets</small></div>
    ${dist}
    <div class="subsection-head"><span>Personal records</span><small>best estimated 1RM (Epley)</small></div>
    ${prs}
  </div>`;
}

// Base recovery hours per canonical muscle group (larger groups recover slower).
// Ported verbatim from self-hosted Workstr src/app/store.js getRecovery().
const RECOVERY_CONFIG: Record<string, number> = {
  Chest: 72, Back: 72, Shoulders: 48, Biceps: 36, Triceps: 36,
  Core: 48, Quadriceps: 72, Hamstrings: 72, Glutes: 48, Calves: 36
};
const RECOVERY_COLORS: Record<RecoveryGroup['status'], string> = { ready: '#00d084', partial: '#f7931a', recovering: '#ff3864', untrained: '#3a3052' };

interface RecoveryGroup {
  name: string;
  percent: number;
  status: 'ready' | 'partial' | 'recovering' | 'untrained';
  lastTrained: string | null;
  hoursRemaining: number;
  totalSets: number;
}

interface RecoveryData { muscleGroups: RecoveryGroup[]; overallReadiness: number; readyCount: number; totalCount: number }

// Muscles that only appear as a secondary mover in one compound shouldn't read
// as heavily fatigued as a directly-trained primary.
function volumeMultiplier(sets: number): number {
  if (sets < 2) return 0.4;
  if (sets < 6) return 0.7;
  if (sets <= 12) return 1.0;
  return 1.2;
}

export function getRecovery(sessions: ActiveSession[], exercises: Exercise[]): RecoveryData {
  const now = Date.now();
  const cutoff = now - 10 * 24 * 3600000;
  // finishedAt -> { canonicalMuscle -> setCount (primary=1, secondary=0.5) }
  const sessionVolumes = new Map<string, Record<string, number>>();
  for (const session of sessions) {
    const finishedAt = session.finishedAt;
    if (!finishedAt || new Date(finishedAt).getTime() < cutoff) continue;
    if (!sessionVolumes.has(finishedAt)) sessionVolumes.set(finishedAt, {});
    const sv = sessionVolumes.get(finishedAt)!;
    for (const set of session.sets.filter((item) => item.done)) {
      const full = exercises.find((exercise) => exercise.slug === set.exerciseSlug);
      const member = sessionExercises(session).find((item) => item.exerciseSlug === set.exerciseSlug);
      const primary = canonMuscle(full?.muscle_group || member?.muscleGroup || '');
      if (primary) sv[primary] = (sv[primary] || 0) + 1;
      for (const raw of full?.muscles || []) {
        const canonical = canonMuscle(raw);
        if (canonical && canonical !== primary) sv[canonical] = (sv[canonical] || 0) + 0.5;
      }
    }
  }
  const sortedSessions = [...sessionVolumes.keys()].sort().reverse();
  const ms = (value: string) => new Date(value).getTime();

  const groups: RecoveryGroup[] = [];
  for (const [muscle, baseHours] of Object.entries(RECOVERY_CONFIG)) {
    let lastTrained: string | null = null;
    let totalSets = 0;
    for (const finishedAt of sortedSessions) {
      const sv = sessionVolumes.get(finishedAt)!;
      if (!(muscle in sv)) continue;
      if (lastTrained === null) { lastTrained = finishedAt; totalSets = sv[muscle]; }
      else if ((ms(lastTrained) - ms(finishedAt)) / 3600000 <= baseHours) totalSets += sv[muscle];
    }
    if (lastTrained === null) {
      groups.push({ name: muscle, percent: 100, status: 'untrained', lastTrained: null, hoursRemaining: 0, totalSets: 0 });
      continue;
    }
    const hoursElapsed = (now - ms(lastTrained)) / 3600000;
    const adjustedHours = baseHours * volumeMultiplier(totalSets);
    const percent = Math.min(100, Math.round((hoursElapsed / adjustedHours) * 100));
    const hoursRemaining = Math.max(0, Math.round((adjustedHours - hoursElapsed) * 10) / 10);
    const status = percent >= 80 ? 'ready' : percent >= 50 ? 'partial' : 'recovering';
    groups.push({ name: muscle, percent, status, lastTrained, hoursRemaining, totalSets: Math.round(totalSets) });
  }

  const trained = groups.filter((group) => group.status !== 'untrained');
  const overallReadiness = trained.length ? Math.round(trained.reduce((total, group) => total + group.percent, 0) / trained.length) : 100;
  const readyCount = groups.filter((group) => group.status === 'ready' || group.status === 'untrained').length;
  return { muscleGroups: groups, overallReadiness, readyCount, totalCount: groups.length };
}

function recoveryNote(group: RecoveryGroup): string {
  return group.status === 'untrained' ? 'not trained recently' : group.percent >= 100 ? 'fully recovered' : `${group.hoursRemaining}h to full`;
}

const RECOVERY_LABEL_TEXT = (x: number, label: string) => `<text x="${x}" y="225" text-anchor="middle" font-size="6" font-family="Jost,sans-serif" fill="#c0a880" letter-spacing="1.5" font-weight="600">${label}</text>`;

function recoveryBodySvg(byMuscle: Record<string, RecoveryGroup>): string {
  return RECOVERY_BODY_SVG.replace(/<polygon([^>]*data-muscle="([^"]+)"[^>]*)>/g, (_match, attrs: string, muscle: string) => {
    const cleanAttrs = attrs.replace(/\s*\/$/, '');
    const status = byMuscle[muscle]?.status || 'untrained';
    return `<polygon${cleanAttrs} style="fill:${RECOVERY_COLORS[status]}"/>`;
  })
    .replace('<svg ', '<svg id="recovery-body" ')
    .replace('<!-- FRONT (anterior) -->', `<!-- FRONT (anterior) -->\n${RECOVERY_LABEL_TEXT(50, 'FRONT')}`)
    .replace('<!-- BACK (posterior) -->', `<!-- BACK (posterior) -->\n${RECOVERY_LABEL_TEXT(180, 'BACK')}`);
}

function recoveryView(state: AppState): string {
  const data = getRecovery(state.finishedSessions, state.exercises);
  const byMuscle: Record<string, RecoveryGroup> = {};
  for (const group of data.muscleGroups) byMuscle[group.name] = group;
  const order: Record<RecoveryGroup['status'], number> = { recovering: 0, partial: 1, ready: 2, untrained: 3 };
  const sorted = [...data.muscleGroups].sort((a, b) => (order[a.status] - order[b.status]) || a.percent - b.percent);
  return `<div class="panel">
    <div class="panel-head"><span>Muscle recovery</span><strong id="recovery-overall">${data.overallReadiness}%</strong></div>
    <p class="section-help">Estimated readiness per muscle group from your completed sessions over the last 10 days. Bigger groups recover slower; higher training volume extends recovery. <span id="recovery-ready" class="section-label">${data.readyCount}/${data.totalCount} ready</span></p>
    <div class="recovery-layout">
      <div class="recovery-map">
        ${recoveryBodySvg(byMuscle)}
        <div class="recovery-legend">
          <span class="rl ready">Ready</span>
          <span class="rl partial">Partial</span>
          <span class="rl recovering">Recovering</span>
          <span class="rl untrained">Untrained</span>
        </div>
        <div id="recovery-tip" class="recovery-tip" hidden></div>
      </div>
      <div id="recovery-list" class="recovery">${sorted.map((group) => `
        <div class="recovery-row ${group.status}">
          <div class="rname">${html(group.name)}</div>
          <div class="rtrack"><div class="rfill" style="width:${group.percent}%"></div></div>
          <div class="rmeta"><strong>${group.percent}%</strong><small>${recoveryNote(group)}</small></div>
        </div>`).join('')}</div>
    </div>
  </div>`;
}

interface QwExercise { slug: string; name: string; muscleGroup: string; sets: number; reps: string; restSec: number; score?: number }

interface BuilderRow { exerciseSlug: string; exerciseName: string; muscleGroup?: string; imageUrl?: string; sets: number; reps: string; restSec: number; weight: number | null; notes: string }

interface BuilderState { sheetId?: number; name: string; desc: string; rows: BuilderRow[]; library: Exercise[] }

interface QuickWorkoutData { exercises: QwExercise[]; pool: Record<string, QwExercise[]>; targetMuscleGroups: string[]; estimatedDurationMin: number }

// Canonicalize a raw muscle group, folding granular names (e.g. "Lateral
// Deltoid") into their canonical group the same way the program cards do.
function qwCanonMuscle(raw: string | undefined): string {
  return canonMuscle(raw || '') || canonMuscle(programMuscleLabel(raw || '')) || '';
}

// Ported verbatim from self-hosted Workstr src/app/store.js getQuickWorkout().
// Untrained muscle groups report 100% recovery, so they are always in readySet.
export function getQuickWorkout(sessions: ActiveSession[], exercises: Exercise[], durationMinutes = 45, minRecovery = 80): QuickWorkoutData {
  const recovery = getRecovery(sessions, exercises);
  const readySet = new Set(recovery.muscleGroups.filter((group) => group.percent >= minRecovery).map((group) => group.name));
  if (!readySet.size) return { exercises: [], pool: {}, targetMuscleGroups: [], estimatedDurationMin: 0 };

  const rows = [...exercises]
    .filter((exercise) => exercise.muscle_group && readySet.has(qwCanonMuscle(exercise.muscle_group)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const loggedSlugs = new Set(completedSets(sessions).map((set) => set.exerciseSlug));

  // Score (logged-before + compound) and bucket exercises by canonical muscle group.
  const byMuscle: Record<string, QwExercise[]> = {};
  for (const row of rows) {
    const mg = qwCanonMuscle(row.muscle_group);
    const score = (loggedSlugs.has(row.slug) ? 1 : 0) + ((row.tags || []).map((tag) => String(tag).toLowerCase()).includes('compound') ? 1 : 0);
    (byMuscle[mg] ||= []).push({ slug: row.slug, name: row.name, muscleGroup: mg, sets: 3, reps: '8-12', restSec: 90, score });
  }
  for (const mg of Object.keys(byMuscle)) byMuscle[mg].sort((a, b) => (b.score || 0) - (a.score || 0));

  // Round-robin across muscle groups so the workout is balanced, up to the time budget.
  const minPerExercise = 9; // ~3 sets x 3 min
  const maxExercises = Math.max(1, Math.floor(durationMinutes / minPerExercise));
  const pools: Record<string, QwExercise[]> = {};
  for (const mg of Object.keys(byMuscle)) pools[mg] = [...byMuscle[mg]];
  const keys = Object.keys(pools);
  const selected: QwExercise[] = [];
  let idx = 0;
  while (selected.length < maxExercises) {
    if (!keys.some((key) => pools[key].length)) break;
    const mg = keys[idx % keys.length];
    if (pools[mg]?.length) selected.push(pools[mg].shift()!);
    idx++;
  }
  const poolOut: Record<string, QwExercise[]> = {};
  for (const mg of keys) if (pools[mg].length) poolOut[mg] = pools[mg];
  return {
    exercises: selected,
    pool: poolOut,
    targetMuscleGroups: [...new Set(selected.map((exercise) => exercise.muscleGroup))],
    estimatedDurationMin: selected.length * minPerExercise
  };
}

function quickWorkoutPanel(state: AppState): string {
  const qw = state.qw;
  return `<div class="panel" id="quick-workout-panel">
    <div class="panel-head"><span>Quick workout</span>
      <div class="qw-duration" id="qw-duration">
        ${[20, 30, 45, 60].map((minutes) => `<button class="qw-dur-btn ${qw.duration === minutes ? 'active' : ''}" data-qw-dur="${minutes}">${minutes}</button>`).join('')}
        <span class="qw-dur-unit">min</span>
      </div>
    </div>
    <p class="section-help">Generates a balanced session from exercises whose muscle groups are recovered (ready, ≥80%). Pick a duration, then swap or drop any exercise before you start.</p>
    <button class="button primary" id="qw-generate" style="width:100%">Generate from recovered muscles</button>
    <div id="qw-result" class="qw-result" ${qw.visible && qw.exercises.length ? '' : 'hidden'}>
      <div class="qw-meta" id="qw-meta">${html(qw.meta)}</div>
      <div class="qw-list" id="qw-list">${qw.exercises.map((exercise, index) => {
        const hasSwap = (qw.pool[exercise.muscleGroup] || []).length > 0;
        return `<div class="qw-item">
          <div class="qw-item-info">
            <div class="qw-item-name">${html(exercise.name)}</div>
            <div class="qw-item-meta">${html(exercise.muscleGroup)} · ${exercise.sets} × ${html(exercise.reps)}</div>
          </div>
          <div class="qw-item-actions">
            ${hasSwap ? `<button class="button ghost small" data-qw-swap="${index}">Swap</button>` : ''}
            <button class="button ghost small" data-qw-remove="${index}" title="Remove">✕</button>
          </div>
        </div>`;
      }).join('')}</div>
      <div class="qw-actions">
        <button class="button gold" id="qw-start">Start workout</button>
      </div>
    </div>
  </div>`;
}

function workoutsView(state: AppState): string {
  const active = state.subState.workouts;
  const query = state.programFilter.toLowerCase();
  const locals = state.sheets.map(sheetToProgram).filter((program) => [program.name, program.description].join(' ').toLowerCase().includes(query));
  const programs = state.programs.filter((program) => [program.name, program.description, ...program.tags].join(' ').toLowerCase().includes(query));
  const cards = [...locals, ...programs];
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      <div class="panel"><div class="panel-head"><span>Programs</span><button class="button primary small" id="new-program">+ New program</button></div><p class="section-help">A program is the routine you take to the gym. Expand one to review its exercises, then hit Start to open the live logger.</p><div class="filter-bar"><input class="grow" id="program-filter" placeholder="Search programs..." autocomplete="off" value="${html(state.programFilter)}" /></div><div class="program-list">${cards.map((program) => programCard(program, state)).join('') || '<div class="empty">No programs yet. Build your first routine.</div>'}</div></div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      <div class="panel"><div class="filter-bar"><input class="grow" placeholder="Search programs..." autocomplete="off" /></div><div class="program-list">${state.programs.map((program) => programCard(program, state)).join('')}</div></div>
    </div>
    <div class="sub-panel ${active === 'history' ? 'active' : ''}" id="sub-workouts-history">
      <div class="panel"><div class="panel-head"><span>Workout history</span></div><p class="section-help">Every completed session, newest first. Expand one to see the exercises and sets you logged; delete it to remove it from your history and stats.</p>${workoutHistory(state)}</div>
    </div>
    <div class="sub-panel ${active === 'recovery' ? 'active' : ''}" id="sub-workouts-recovery">
      ${recoveryView(state)}
      ${quickWorkoutPanel(state)}
    </div>
  </div>`;
}

function estimateProgramMin(exercises: RelayProgram['exercises']): number {
  return exercises.reduce((total, exercise) => {
    const sets = Number(exercise.sets) || 3;
    const rest = Number(exercise.restSec || exercise.rest) || 90;
    return total + sets * 45 + Math.max(0, sets - 1) * rest;
  }, 0);
}

function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function resolveProgramExercise(member: RelayProgram['exercises'][number], exercises: Exercise[]): Exercise | null {
  if (member.address) {
    const byAddress = exercises.find((exercise) => exercise.nostr_address === member.address);
    if (byAddress) return byAddress;
    const slug = member.address.split(':').pop();
    const bySlug = exercises.find((exercise) => exercise.slug === slug || `workstr:exercise:${exercise.slug}` === slug);
    if (bySlug) return bySlug;
  }
  if (member.name) {
    const name = member.name.toLowerCase();
    return exercises.find((exercise) => exercise.name.toLowerCase() === name) || null;
  }
  return null;
}

function programMuscleLabel(raw?: string): string {
  const value = String(raw || '').trim();
  const key = value.toLowerCase();
  if (['biceps', 'triceps', 'brachialis', 'brachioradialis', 'forearms', 'forearm'].includes(key)) return 'Arms';
  if (['shoulder', 'shoulders', 'deltoid', 'deltoids', 'lateral deltoid', 'anterior deltoid', 'posterior deltoid', 'supraspinatus'].includes(key)) return 'Shoulders';
  return value;
}

function programGroups(program: RelayProgram, exercises: Exercise[]): string[] {
  const groups = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const primary = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full)));
    if (primary) groups.add(primary);
  }
  return [...groups];
}

function programMuscleSets(program: RelayProgram, exercises: Exercise[]): { primary: Set<string>; secondary: Set<string> } {
  const primary = new Set<string>();
  const secondary = new Set<string>();
  for (const member of program.exercises) {
    const full = resolveProgramExercise(member, exercises);
    const rawPrimary = member.muscleGroup || full?.muscle_group || inferProgramMuscle(programExerciseName(member, full));
    const canonicalPrimary = canonMuscle(rawPrimary) || canonMuscle(programMuscleLabel(rawPrimary));
    if (canonicalPrimary) primary.add(canonicalPrimary);
    for (const raw of full?.muscles || []) {
      const canonical = canonMuscle(raw);
      if (canonical) secondary.add(canonical);
    }
  }
  primary.forEach((muscle) => secondary.delete(muscle));
  return { primary, secondary };
}

function paintBodyMapSvg(primary: Set<string>, secondary: Set<string>): string {
  if (!primary.size && !secondary.size) return '';
  return RECOVERY_BODY_SVG.replace(/<polygon([^>]*data-muscle="([^"]+)"[^>]*)>/g, (_match, attrs: string, muscle: string) => {
    const cleanAttrs = attrs.replace(/\s*\/$/, '');
    if (primary.has(muscle)) return `<polygon${cleanAttrs} style="fill:var(--sovereign-purple);opacity:.95"/>`;
    if (secondary.has(muscle)) return `<polygon${cleanAttrs} style="fill:var(--purple-2);opacity:.5"/>`;
    return `<polygon${cleanAttrs} style="fill:#2a1d40"/>`;
  }).replace(/<polygon((?:(?!data-muscle)[^>])*)>/g, (_match, attrs: string) => {
    const cleanAttrs = attrs.replace(/\s*\/$/, '');
    return `<polygon${cleanAttrs} style="fill:#1a1228"/>`;
  });
}

function programMuscleMap(program: RelayProgram, exercises: Exercise[]): string {
  const { primary, secondary } = programMuscleSets(program, exercises);
  return paintBodyMapSvg(primary, secondary);
}

function exerciseImage(src?: string): string {
  return src
    ? `<img class="wk-ex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wk-ex-img placeholder'}))">`
    : `<div class="wk-ex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
}

function programExerciseName(member: RelayProgram['exercises'][number], full: Exercise | null): string {
  const slugName = member.address ? member.address.split(':').pop()?.replace(/^workstr:exercise:/, '').replace(/[-_]+/g, ' ') : '';
  return member.name || full?.name || slugName || 'Exercise';
}

function inferProgramMuscle(name: string): string {
  const value = name.toLowerCase();
  if (/squat|lunge|quad|leg press|step[- ]?up/.test(value)) return 'Quadriceps';
  if (/lateral raise|front raise|shoulder|deltoid|press/.test(value)) return 'Shoulders';
  if (/curl|bicep|hammer|arm/.test(value)) return 'Biceps';
  if (/tricep|extension|dip/.test(value)) return 'Triceps';
  if (/row|pull|lat|back|shrug/.test(value)) return 'Back';
  if (/deadlift|hinge|hamstring|romanian/.test(value)) return 'Hamstrings';
  if (/glute|hip thrust|bridge/.test(value)) return 'Glutes';
  if (/calf/.test(value)) return 'Calves';
  if (/crunch|plank|core|abs|sit[- ]?up/.test(value)) return 'Core';
  if (/bench|push[- ]?up|chest|pec/.test(value)) return 'Chest';
  return '';
}

function programAuthor(program: RelayProgram, state: AppState): string {
  if (!program.pubkey) return 'unknown';
  return state.profileNames[program.pubkey] || displayPubkey(program.pubkey);
}

function isLocalProgram(program: RelayProgram): boolean {
  return program.address.startsWith('local:');
}

function localSheetId(program: RelayProgram): number {
  return Number(program.address.slice('local:'.length)) || 0;
}

function sheetToProgram(sheet: SheetWithExercises): RelayProgram {
  return {
    slug: sheet.slug,
    name: sheet.name,
    description: sheet.notes || '',
    tags: [],
    sourceLabel: 'local only',
    eventId: sheet.nostr_event_id || '',
    pubkey: '',
    address: `local:${sheet.id}`,
    createdAt: Math.floor(new Date(sheet.created_at).getTime() / 1000) || 0,
    exercises: sheet.exercises.map((row) => ({
      address: '',
      name: row.exercise_name || row.exercise_slug || 'Exercise',
      muscleGroup: row.muscle_group,
      imageUrl: row.image_url,
      notes: row.notes,
      sets: Number(row.sets) || undefined,
      reps: row.reps != null ? String(row.reps) : undefined,
      weight: row.weight != null ? String(row.weight) : undefined,
      restSec: Number(row.rest) || undefined
    }))
  };
}

function programCard(program: RelayProgram, state: AppState): string {
  const exerciseCount = program.exercises.length;
  const time = formatMinutes(estimateProgramMin(program.exercises));
  const groups = programGroups(program, state.exercises);
  const map = programMuscleMap(program, state.exercises);
  const meta = [`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`, program.description ? html(program.description) : '', time ? `~${time}` : ''].filter(Boolean).join(' · ');
  const isExpanded = state.expandedProgramAddress === program.address;
  const statusCls = isLocalProgram(program) ? 'local' : 'published';
  return `<div class="workout-card ${isExpanded ? 'expanded' : ''}" data-program-address="${html(program.address)}">
    <div class="workout-card-header" data-toggle-program="${html(program.address)}">
      <div class="workout-card-map ${map ? 'has-map' : ''}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg>'}</div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(program.name)}<span class="program-status ${statusCls}">${html(program.sourceLabel || 'Workstr')}</span></div>
        <div class="workout-card-meta">${meta}</div>
        ${program.pubkey ? `<div class="workout-card-author">${html(programAuthor(program, state))}</div>` : ''}
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body">${isExpanded ? programBody(program, state) : ''}</div>
  </div>`;
}

function programBody(program: RelayProgram, state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const exHtml = program.exercises.length ? program.exercises.map((member, index) => {
    const full = resolveProgramExercise(member, state.exercises);
    const name = programExerciseName(member, full);
    const muscle = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name));
    const image = exerciseImage(member.imageUrl || full?.image_url);
    const sets = Number(member.sets) || 3;
    const reps = member.reps || String(full?.default_reps || '8-12');
    const weightValue = displayWeightKg(member.weight, unit);
    const weight = weightValue != null ? ` @ ${html(String(weightValue))}` : '';
    const rest = Number(member.restSec || member.rest || full?.default_rest) || 90;
    return `<div class="wk-ex-item" data-exitem="${html(program.address)}-${index}">
      <div class="wk-ex-header" data-toggle-exitem="${html(program.address)}-${index}">
        ${image}
        <div class="wk-ex-info">
          <div class="wk-ex-name">${html(name)}</div>
          <div class="wk-ex-short">${sets} × ${html(reps)}${weight}</div>
        </div>
        ${muscle ? `<span class="wk-ex-muscle-pill">${html(muscle)}</span>` : ''}
        <svg class="wk-ex-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wk-ex-detail">
        <div class="wk-ex-detail-grid">
          <div class="wk-ex-detail-cell"><div class="val">${sets}</div><div class="lbl">Sets</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${html(reps)}</div><div class="lbl">Reps</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${weightValue != null ? html(String(weightValue)) : '—'}</div><div class="lbl">${unit}</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${rest}s</div><div class="lbl">Rest</div></div>
        </div>
        ${member.notes ? `<div class="wk-ex-detail-note">${html(member.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="empty" style="padding:10px 0">No exercises yet.</p>';
  const localActions = isLocalProgram(program)
    ? `<button class="button ghost small" type="button" data-edit-sheet="${localSheetId(program)}">Edit</button>
      <button class="button ghost small" type="button" disabled title="Publishing arrives with the Nostr share block">Publish</button>
      <button class="button danger small" type="button" data-del-sheet="${localSheetId(program)}">Delete</button>`
    : '';
  return `<div class="wk-ex-list">${exHtml}</div>
    <div class="workout-card-actions">
      <button class="button gold small" type="button" data-start-program="${html(program.address)}">Start workout</button>
      ${localActions}
    </div>`;
}

function bmiMarkup(bmi: number): string {
  const barMin = 15, barMax = 40, range = barMax - barMin;
  const zones = [
    { name: 'Under', cls: 'under', min: barMin, max: 18.5 },
    { name: 'Normal', cls: 'normal', min: 18.5, max: 25 },
    { name: 'Over', cls: 'over', min: 25, max: 30 },
    { name: 'Obese', cls: 'obese', min: 30, max: barMax }
  ];
  const pct = ((Math.max(barMin, Math.min(barMax, bmi)) - barMin) / range) * 100;
  const label = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
  return `<div class="subsection-head"><span>BMI</span><small>${bmi.toFixed(1)} · ${label}</small></div>
    <div class="bmi-bar">
      ${zones.map((zone) => `<div class="bmi-zone ${zone.cls}" style="flex:0 0 ${(((zone.max - zone.min) / range) * 100).toFixed(1)}%">${zone.name}</div>`).join('')}
      <div class="bmi-marker" style="left:${pct.toFixed(1)}%"></div>
    </div>
    <div class="bmi-scale"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>40+</span></div>`;
}

function bodyChartMarkup(sorted: BodyWeightEntry[], unit: WeightUnit): string {
  if (sorted.length < 2) return '';
  const wd = (kg: number) => displayWeightKg(kg, unit) || 0;
  const W = 400, H = 120, pad = 30, n = sorted.length;
  const vals = sorted.map((entry) => entry.weight_kg);
  const min = Math.min(...vals) * 0.995, max = Math.max(...vals) * 1.005, range = (max - min) || 1;
  const pts = vals.map((value, index) => {
    const x = pad + (index / (n - 1)) * (W - pad * 2);
    const y = pad / 2 + (1 - (value - min) / range) * (H - pad);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const polyline = pts.map((point) => point.join(',')).join(' ');
  const areaPath = `M${pts[0].join(',')} ${pts.slice(1).map((point) => 'L' + point.join(',')).join(' ')} L${pts[n - 1][0]},${H - pad / 2} L${pts[0][0]},${H - pad / 2} Z`;
  const dots = pts.map(([x, y], index) => {
    const label = new Date(sorted[index].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
    return `<circle cx="${x}" cy="${y}" r="3" fill="var(--purple-2)" stroke="var(--void)" stroke-width="1.5"><title>${label}: ${wd(sorted[index].weight_kg).toFixed(1)} ${unit}</title></circle>`;
  }).join('');
  let yLabels = '';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const value = min + (range * i / ySteps);
    const y = pad / 2 + (1 - i / ySteps) * (H - pad);
    yLabels += `<text x="${pad - 6}" y="${y}" text-anchor="end" font-size="9" fill="var(--dim)" dominant-baseline="middle">${wd(value).toFixed(0)}</text>`;
    yLabels += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="0.5"/>`;
  }
  const firstDate = new Date(sorted[0].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const lastDate = new Date(sorted[n - 1].date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
  return `<div class="subsection-head"><span>Weight trend</span><small>${n} entr${n === 1 ? 'y' : 'ies'}</small></div>
    <div class="body-chart">
      <svg viewBox="0 0 ${W} ${H + 16}">
        ${yLabels}
        <path d="${areaPath}" fill="var(--sovereign-purple)" opacity=".12"/>
        <polyline points="${polyline}" fill="none" stroke="var(--purple-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${pad}" y="${H + 10}" font-size="9" fill="var(--dim)">${firstDate}</text>
        <text x="${W - pad}" y="${H + 10}" font-size="9" fill="var(--dim)" text-anchor="end">${lastDate}</text>
      </svg>
    </div>`;
}

function bodyView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  const wd = (kg: number) => displayWeightKg(kg, unit) || 0;
  const entries = state.bodyEntries;
  let cards = '', bmi = '', chart = '', goal = '';
  let listHtml = '<div id="body-list" class="list empty">No entries yet.</div>';
  if (entries.length) {
    // Entries are newest-first; sort oldest-first for trend/average maths.
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0], latest = sorted[sorted.length - 1];
    const latestW = latest.weight_kg;
    const last7 = sorted.slice(-7);
    const avg7 = last7.reduce((sum, entry) => sum + entry.weight_kg, 0) / last7.length;
    const totalChange = latestW - first.weight_kg;
    const changeColor = totalChange > 0 ? 'var(--danger-red)' : totalChange < 0 ? 'var(--success-green)' : 'var(--muted)';
    cards = `<div class="body-cards">
      <div class="body-card"><div class="body-card-val">${wd(latestW).toFixed(1)}</div><div class="body-card-lbl">Current (${unit})</div></div>
      <div class="body-card"><div class="body-card-val">${wd(avg7).toFixed(1)}</div><div class="body-card-lbl">7-day avg</div></div>
      <div class="body-card"><div class="body-card-val" style="color:${changeColor}">${totalChange > 0 ? '+' : ''}${wd(totalChange).toFixed(1)}</div><div class="body-card-lbl">Total change</div></div>
    </div>`;
    const heightCm = state.settings.heightCm || 0;
    if (heightCm > 0) { const meters = heightCm / 100; bmi = bmiMarkup(latestW / (meters * meters)); }
    chart = bodyChartMarkup(sorted, unit);
    const targetKg = state.settings.targetWeightKg || 0;
    if (targetKg > 0) {
      const startW = first.weight_kg;
      const totalNeeded = targetKg - startW;
      const pct = totalNeeded !== 0 ? Math.min(100, Math.max(0, ((latestW - startW) / totalNeeded) * 100)) : 100;
      const remaining = targetKg - latestW;
      goal = `<div class="subsection-head"><span>Goal progress</span></div>
        <div class="body-goal-bar"><div class="body-goal-fill" style="width:${pct.toFixed(0)}%"></div></div>
        <div class="body-goal-labels"><span>${wd(startW).toFixed(1)} ${unit}</span><span>${remaining > 0 ? '+' : ''}${wd(remaining).toFixed(1)} ${unit} to go</span><span>${wd(targetKg).toFixed(1)} ${unit}</span></div>`;
    }
    listHtml = `<div id="body-list" class="list">${entries.map((entry) => `<div class="row"><div><strong>${wd(entry.weight_kg)} ${unit}</strong><small>${html(entry.date)}${entry.notes ? ' · ' + html(entry.notes) : ''}</small></div><button class="button danger small" data-del-body="${entry.id}">×</button></div>`).join('')}</div>`;
  }
  return `<div class="panel">
    <div class="panel-head"><span>Body weight</span><span class="section-label" id="body-unit">${unit}</span></div>
    <div id="body-empty" class="empty" style="display:${entries.length ? 'none' : ''}">No entries yet. Log your weight below to start tracking.</div>
    <div id="body-cards">${cards}</div>
    <div id="body-bmi">${bmi}</div>
    <div id="body-chart">${chart}</div>
    <div id="body-goal">${goal}</div>
    <div class="subsection-head"><span>Log weight</span></div>
    <form id="body-form" class="form-grid">
      <label>Date<input type="date" name="date" /></label>
      <label><span>Weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="weightKg" step="0.1" placeholder="e.g. 80" /></label>
      <div class="form-actions span-2"><button class="button primary" type="submit">Log weight</button></div>
    </form>
    ${listHtml}
    <div class="subsection-head"><span>Profile</span><small>for BMI &amp; goal</small></div>
    <form id="body-profile-form" class="form-grid">
      <label>Height (cm)<input type="number" name="heightCm" step="1" min="100" max="250" placeholder="e.g. 175" value="${state.settings.heightCm || ''}" /></label>
      <label><span>Target weight (<span class="body-unit-lbl">${unit}</span>)</span><input type="number" name="targetWeightKg" step="0.1" min="0" placeholder="e.g. 75" value="${state.settings.targetWeightKg ? wd(state.settings.targetWeightKg) : ''}" /></label>
      <div class="form-actions span-2"><button class="button" type="submit">Save profile</button></div>
    </form>
  </div>`;
}

function statisticsView(state: AppState): string {
  const active = state.subState.statistics;
  return `<div class="page active" id="page-statistics">
    <div class="page-title">Statistics</div>
    ${subTabs('statistics', active, ['Training', 'Body'])}
    <div class="sub-panel ${active === 'training' ? 'active' : ''}" id="sub-statistics-training">
      ${trainingStatsView(state)}
    </div>
    <div class="sub-panel ${active === 'body' ? 'active' : ''}" id="sub-statistics-body">
      ${bodyView(state)}
    </div>
  </div>`;
}

function settingsView(state: AppState): string {
  const unit = normalizeWeightUnit(state.settings.unit);
  return `<div class="page active"><div class="page-title">Settings</div><div class="panel"><div class="panel-head"><span>Nostr signer</span><span class="status-pill ${state.pubkey ? 'ok' : 'bad'}">${state.pubkey ? 'connected' : 'not signed in'}</span></div><p class="section-help">Workstr Web replaces self-hosted Idenstr with a user-owned NIP-46 signer. Press Sign in in the top-right; scan the QR code with your signer app, or let it open directly on mobile.</p><div class="terminal-mini">secure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'not signed in')}\n${state.signInStatus ? html(state.signInStatus) : ''}</div><div class="web-empty-actions">${state.pubkey ? '<button id="sign-out-settings" class="button ghost">Switch signer</button>' : '<button id="sign-in-settings" class="button primary">Sign in</button>'}<button id="open-demo" class="button ghost">Open local demo</button></div></div><div class="panel"><div class="panel-head"><span>Preferences</span></div><label style="max-width:240px">Weight unit<select id="unit-select" ${state.store ? '' : 'disabled'}><option value="kg" ${unit === 'kg' ? 'selected' : ''}>Kilograms (kg)</option><option value="lbs" ${unit === 'lbs' ? 'selected' : ''}>Pounds (lbs)</option></select></label>${state.store ? '' : '<p class="section-help">Open a signer or local demo first so preferences can be saved in the per-identity IndexedDB database.</p>'}</div></div>`;
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, profileNames: {}, store: null, settings: { ...DEFAULT_SETTINGS }, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], activeSession: null, finishedSessions: [], editingId: null, filter: '', programFilter: '', expandedProgramAddress: null, exerciseStatus: `loading exercises from ${WORKSTR_LIBRARY_RELAY}...`, programStatus: '', signInStatus: null, expandedSessionId: null, qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false }, bodyEntries: [], sheets: [] };

  async function boot(): Promise<void> {
    if (state.pubkey) await openIdentity(state.pubkey, false);
    render();
    await refreshExercises();
  }

  async function openIdentity(pubkey: string, persist = true, signerType: AppState['signerType'] = state.signerType): Promise<void> {
    state.pubkey = pubkey;
    state.signerType = signerType;
    state.npub = pubkey === 'demo-local-pubkey' ? 'demo-local-pubkey' : nip19.npubEncode(pubkey);
    state.profileName = await fetchProfileName(pubkey);
    state.signInStatus = null;
    state.store = await WorkstrStore.open(pubkey);
    state.settings = await state.store.getSettings();
    await state.store.seedExercises(starterExercises as ExerciseDraft[]);
    state.settings = await state.store.getSettings();
    state.finishedSessions = await loadFinishedSessions();
    state.bodyEntries = await state.store.listBody();
    state.sheets = await state.store.listSheets();
    state.activeSession = await loadUnfinishedSession();
    if (state.activeSession) sessionSetCounts = setCountsFromSession(state.activeSession);
    if (persist) {
      localStorage.setItem(SESSION_KEY, pubkey);
      if (signerType) localStorage.setItem(SIGNER_TYPE_KEY, signerType);
    }
  }

  function render(): void {
    root.innerHTML = shellMarkup(state);
    bind();
    if (state.activeSession) void openSessionOverlay(state.activeSession);
    if (pendingConnect) renderConnectModal();
    if (builder) renderBuilderModal();
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
      state.view = button.dataset.view as View;
      state.editingId = null;
      render();
      if (state.view === 'exercises' && !state.exercises.length) void refreshExercises();
      if (state.view === 'workouts' && !state.programs.length) void refreshPrograms();
    }));
    root.querySelectorAll<HTMLElement>('[data-subtab]').forEach((button) => button.addEventListener('click', () => {
      const parent = button.dataset.parent as keyof AppState['subState'];
      if (parent && parent in state.subState) {
        (state.subState[parent] as SubView) = button.dataset.subtab as SubView;
        state.view = parent as View;
        state.editingId = null;
        render();
        if (parent === 'exercises' && !state.exercises.length) void refreshExercises();
        if (parent === 'workouts' && !state.programs.length) void refreshPrograms();
      }
    }));
    root.querySelector('#sign-in')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-in-settings')?.addEventListener('click', startRemoteSignerRequest);
    root.querySelector('#sign-out')?.addEventListener('click', signOut);
    root.querySelector('#sign-out-settings')?.addEventListener('click', signOut);
    root.querySelector('#open-demo')?.addEventListener('click', () => openAndRender('demo-local-pubkey'));
    root.querySelector('#unit-select')?.addEventListener('change', (event) => { void saveUnitPreference((event.target as HTMLSelectElement).value); });
    root.querySelectorAll('#refresh-exercises').forEach((button) => button.addEventListener('click', () => { void refreshExercises(); }));
    root.querySelectorAll('#refresh-programs').forEach((button) => button.addEventListener('click', () => { void refreshPrograms(); }));
    root.querySelector('#new-exercise')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#cancel-edit')?.addEventListener('click', () => { state.editingId = null; render(); });
    root.querySelector('#exercise-filter')?.addEventListener('input', (event) => { state.filter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#exercise-filter'); input?.focus(); input?.setSelectionRange(state.filter.length, state.filter.length); });
    root.querySelector('#program-filter')?.addEventListener('input', (event) => { state.programFilter = (event.target as HTMLInputElement).value; render(); const input = root.querySelector<HTMLInputElement>('#program-filter'); input?.focus(); input?.setSelectionRange(state.programFilter.length, state.programFilter.length); });
    root.querySelectorAll<HTMLElement>('[data-toggle-program]').forEach((header) => header.addEventListener('click', () => {
      const address = header.dataset.toggleProgram || null;
      state.expandedProgramAddress = state.expandedProgramAddress === address ? null : address;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-toggle-exitem]').forEach((header) => header.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = header.dataset.toggleExitem;
      const item = key ? root.querySelector<HTMLElement>(`[data-exitem="${CSS.escape(key)}"]`) : null;
      item?.classList.toggle('open');
    }));
    root.querySelectorAll<HTMLElement>('[data-start-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const address = button.dataset.startProgram;
      const program = state.programs.find((item) => item.address === address)
        || state.sheets.map(sheetToProgram).find((item) => item.address === address);
      if (program) startTrainingSession(program);
    }));
    root.querySelector('#new-program')?.addEventListener('click', () => { void openSheetBuilder(); });
    root.querySelectorAll<HTMLElement>('[data-edit-sheet]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const sheet = state.sheets.find((item) => item.id === Number(button.dataset.editSheet));
      if (sheet) void openSheetBuilder(sheet);
    }));
    root.querySelectorAll<HTMLElement>('[data-del-sheet]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!state.store || !window.confirm('Delete this program?')) return;
      await state.store.deleteSheet(Number(button.dataset.delSheet) || 0);
      state.sheets = await state.store.listSheets();
      render();
      toast('Program deleted');
    }));
    bindSessionControls();
    root.querySelector('#exercise-form')?.addEventListener('submit', saveExercise);
    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = Number(button.dataset.edit); render(); }));
    root.querySelectorAll<HTMLElement>('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteExercise(Number(button.dataset.delete))));
    root.querySelectorAll<HTMLElement>('[data-delete-session]').forEach((button) => button.addEventListener('click', () => { void deleteSession(Number(button.dataset.deleteSession)); }));
    root.querySelectorAll<HTMLElement>('[data-toggle-session]').forEach((head) => head.addEventListener('click', () => {
      const id = Number(head.dataset.toggleSession) || 0;
      state.expandedSessionId = state.expandedSessionId === id ? null : id;
      render();
    }));
    bindRecoveryControls();
    bindBodyControls();
  }

  async function openSheetBuilder(sheet: SheetWithExercises | null = null): Promise<void> {
    if (!state.store) { toast('Sign in or open the local demo to create programs.', 'bad'); return; }
    const library = await quickWorkoutLibrary();
    builder = {
      sheetId: sheet?.id,
      name: sheet?.name || '',
      desc: sheet?.notes || '',
      library,
      rows: sheet
        ? sheet.exercises.map((row) => ({
            exerciseSlug: row.exercise_slug || '',
            exerciseName: row.exercise_name || row.exercise_slug || 'Exercise',
            muscleGroup: row.muscle_group,
            imageUrl: row.image_url,
            sets: Number(row.sets) || 3,
            reps: String(row.reps ?? '8-12'),
            restSec: Number(row.rest) || 90,
            weight: row.weight ?? null,
            notes: row.notes || ''
          }))
        : []
    };
    renderBuilderModal();
  }

  function renderBuilderModal(): void {
    const current = builder;
    if (!current) return;
    openModal(`
      <h3>${current.sheetId ? 'Edit program' : 'New program'}</h3>
      <div class="form-grid">
        <label class="span-2">Name<input id="sheet-name" value="${html(current.name)}" placeholder="Push Day" /></label>
        <label class="span-2">Description<input id="sheet-desc" value="${html(current.desc)}" placeholder="optional" /></label>
      </div>
      <div class="subsection-head"><span>Exercises</span></div>
      <div class="builder-search-wrap">
        <input id="builder-search" class="builder-search" placeholder="Search exercises to add..." autocomplete="off" />
        <div id="builder-results" class="builder-results" style="display:none"></div>
      </div>
      <div id="builder-rows" class="builder-rows"></div>
      <div class="form-actions"><button class="button primary" id="sheet-save" type="button">${current.sheetId ? 'Save program' : 'Create program'}</button></div>`);
    renderBuilderRows();
    root.querySelector('#sheet-name')?.addEventListener('input', (event) => { current.name = (event.target as HTMLInputElement).value; });
    root.querySelector('#sheet-desc')?.addEventListener('input', (event) => { current.desc = (event.target as HTMLInputElement).value; });
    const search = root.querySelector<HTMLInputElement>('#builder-search');
    const results = root.querySelector<HTMLElement>('#builder-results');
    search?.addEventListener('input', () => {
      if (!results) return;
      const query = search.value.trim().toLowerCase();
      if (!query) { results.style.display = 'none'; results.innerHTML = ''; return; }
      const matches = current.library
        .filter((exercise) => exercise.name.toLowerCase().includes(query) || (exercise.muscle_group || '').toLowerCase().includes(query))
        .slice(0, 8);
      if (!matches.length) { results.innerHTML = '<div class="ex-search-empty">No exercises match.</div>'; results.style.display = 'block'; return; }
      results.style.display = 'block';
      results.innerHTML = matches.map((exercise) => {
        const added = current.rows.some((row) => row.exerciseSlug === exercise.slug);
        return `<div class="ex-search-result-item${added ? ' added' : ''}" data-add-slug="${html(exercise.slug)}"><span>${html(exercise.name)}</span><span class="muscle">${added ? 'added' : html(exercise.muscle_group || '')}</span></div>`;
      }).join('');
    });
    results?.addEventListener('click', (event) => {
      const item = (event.target as Element).closest<HTMLElement>('[data-add-slug]');
      if (!item || !search || !results) return;
      const exercise = current.library.find((entry) => entry.slug === item.dataset.addSlug);
      if (exercise && !current.rows.some((row) => row.exerciseSlug === exercise.slug)) {
        current.rows.push({
          exerciseSlug: exercise.slug,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscle_group,
          imageUrl: exercise.image_url,
          sets: Number(exercise.default_sets) || 3,
          reps: String(exercise.default_reps || '8-12'),
          restSec: Number(exercise.default_rest) || 90,
          weight: null,
          notes: ''
        });
        renderBuilderRows();
      }
      search.value = ''; results.style.display = 'none'; results.innerHTML = '';
      search.focus();
    });
    const rowsHost = root.querySelector<HTMLElement>('#builder-rows');
    rowsHost?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      const row = target.closest<HTMLElement>('[data-i]');
      const entry = row ? current.rows[Number(row.dataset.i)] : undefined;
      const field = target.dataset.f;
      if (!entry || !field) return;
      if (field === 'sets') entry.sets = Number(target.value) || 0;
      else if (field === 'restSec') entry.restSec = Number(target.value) || 0;
      else if (field === 'weight') entry.weight = storeWeightInput(target.value, normalizeWeightUnit(state.settings.unit));
      else if (field === 'reps') entry.reps = target.value;
    });
    rowsHost?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.dataset.rm != null) { current.rows.splice(Number(target.dataset.rm), 1); renderBuilderRows(); return; }
      if (target.dataset.move != null) {
        const index = Number(target.dataset.move);
        const next = index + Number(target.dataset.dir);
        if (next >= 0 && next < current.rows.length) {
          [current.rows[index], current.rows[next]] = [current.rows[next], current.rows[index]];
          renderBuilderRows();
        }
      }
    });
    root.querySelector('#sheet-save')?.addEventListener('click', async () => {
      if (!state.store || !builder) return;
      const name = builder.name.trim();
      if (!name) { toast('name is required', 'bad'); return; }
      await state.store.saveSheet({
        name,
        notes: builder.desc.trim(),
        exercises: builder.rows.map((row, index) => ({
          exercise_slug: row.exerciseSlug,
          exercise_name: row.exerciseName,
          muscle_group: row.muscleGroup,
          image_url: row.imageUrl,
          sets: row.sets,
          reps: row.reps,
          rest: row.restSec,
          weight: row.weight,
          notes: row.notes,
          position: index
        }))
      }, builder.sheetId);
      builder = null;
      state.sheets = await state.store.listSheets();
      closeModal();
      render();
      toast('Program saved');
    });
  }

  function renderBuilderRows(): void {
    const host = root.querySelector<HTMLElement>('#builder-rows');
    const current = builder;
    if (!host || !current) return;
    const unit = normalizeWeightUnit(state.settings.unit);
    if (!current.rows.length) { host.innerHTML = '<div class="empty" style="padding:8px 0">No exercises yet. Search above to add.</div>'; return; }
    host.innerHTML = current.rows.map((row, index) => {
      const src = row.imageUrl || current.library.find((exercise) => exercise.slug === row.exerciseSlug)?.image_url;
      const img = src
        ? `<img class="wex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wex-img placeholder'}))">`
        : `<div class="wex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
      return `<div class="wex-row" data-i="${index}">
        <div class="wex-move-btns">
          <button class="wex-move-btn" type="button" data-move="${index}" data-dir="-1" title="Move up">↑</button>
          <button class="wex-move-btn" type="button" data-move="${index}" data-dir="1" title="Move down">↓</button>
        </div>
        ${img}
        <div class="wex-info">
          <div class="wex-name">${html(row.exerciseName)}${row.muscleGroup ? `<span class="wex-muscle">${html(row.muscleGroup)}</span>` : ''}</div>
          <div class="wex-params">
            <div class="wex-param-group"><div class="wex-param-label">Sets</div><input class="wex-param-input" type="number" min="1" max="20" data-f="sets" value="${row.sets}"></div>
            <div class="wex-param-group"><div class="wex-param-label">Reps</div><input class="wex-param-input reps" data-f="reps" value="${html(row.reps)}"></div>
            <div class="wex-param-group"><div class="wex-param-label">${unit}</div><input class="wex-param-input" type="number" min="0" step="0.5" data-f="weight" placeholder="—" value="${row.weight != null ? displayWeightKg(row.weight, unit) : ''}"></div>
            <div class="wex-param-group"><div class="wex-param-label">Rest</div><input class="wex-param-input" type="number" min="0" step="5" data-f="restSec" value="${row.restSec}"></div>
          </div>
        </div>
        <button class="wex-remove" type="button" data-rm="${index}" title="Remove">✕</button>
      </div>`;
    }).join('');
  }

  function bindBodyControls(): void {
    root.querySelector('#body-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.store) { toast('Sign in or open the local demo to log weight.', 'bad'); return; }
      const form = event.target as HTMLFormElement;
      const weightKg = storeWeightInput((form.elements.namedItem('weightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit));
      if (weightKg == null) return;
      await state.store.logBody({ date: (form.elements.namedItem('date') as HTMLInputElement).value || undefined, weight_kg: weightKg, notes: '' });
      state.bodyEntries = await state.store.listBody();
      render();
      toast('Weight logged');
    });
    root.querySelectorAll<HTMLElement>('[data-del-body]').forEach((button) => button.addEventListener('click', async () => {
      if (!state.store) return;
      await state.store.deleteBody(Number(button.dataset.delBody) || 0);
      state.bodyEntries = await state.store.listBody();
      render();
    }));
    root.querySelector('#body-profile-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!state.store) { toast('Sign in or open the local demo to save your profile.', 'bad'); return; }
      const form = event.target as HTMLFormElement;
      const heightCm = Number((form.elements.namedItem('heightCm') as HTMLInputElement).value) || 0;
      const targetWeightKg = storeWeightInput((form.elements.namedItem('targetWeightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit)) || 0;
      state.settings = { ...state.settings, heightCm, targetWeightKg };
      await state.store.saveSettings(state.settings);
      render();
      toast('Profile saved');
    });
  }

  function toast(message: string, kind: 'ok' | 'bad' = 'ok'): void {
    const el = root.querySelector<HTMLElement>('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `show ${kind}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el.className = ''; }, 2600);
  }

  // Quick workout draws from the full library like self-hosted: local store
  // exercises (starter pack + user-created) plus the relay library, deduped by slug.
  async function quickWorkoutLibrary(): Promise<Exercise[]> {
    const local = state.store ? await state.store.listExercises() : [];
    const seen = new Set(local.map((exercise) => exercise.slug));
    return [...local, ...state.exercises.filter((exercise) => !seen.has(exercise.slug))];
  }

  function bindRecoveryControls(): void {
    const body = root.querySelector<SVGSVGElement>('#recovery-body');
    if (body) {
      const tip = root.querySelector<HTMLElement>('#recovery-tip');
      const byMuscle: Record<string, RecoveryGroup> = {};
      for (const group of getRecovery(state.finishedSessions, state.exercises).muscleGroups) byMuscle[group.name] = group;
      const highlight = (name: string | null) => body.querySelectorAll<SVGElement>('[data-muscle]').forEach((el) => el.classList.toggle('hl', name != null && el.getAttribute('data-muscle') === name));
      body.addEventListener('mousemove', (event) => {
        if (!tip) return;
        const poly = (event.target as Element).closest('[data-muscle]');
        if (!poly) { tip.hidden = true; highlight(null); return; }
        const name = poly.getAttribute('data-muscle') || '';
        const group = byMuscle[name];
        highlight(name);
        const rect = (body.parentElement as HTMLElement).getBoundingClientRect();
        tip.hidden = false;
        tip.style.left = `${event.clientX - rect.left}px`;
        tip.style.top = `${event.clientY - rect.top}px`;
        tip.innerHTML = group
          ? `<strong>${html(name)}</strong><small>${group.percent}% · ${group.status}${group.status !== 'untrained' && group.percent < 100 ? ` · ${group.hoursRemaining}h left` : ''}</small>`
          : `<strong>${html(name)}</strong><small>no data</small>`;
      });
      body.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; highlight(null); });
    }
    root.querySelectorAll<HTMLElement>('[data-qw-dur]').forEach((button) => button.addEventListener('click', () => {
      state.qw.duration = Number(button.dataset.qwDur) || 45;
      root.querySelectorAll<HTMLElement>('#qw-duration .qw-dur-btn').forEach((el) => el.classList.toggle('active', el === button));
    }));
    root.querySelector('#qw-generate')?.addEventListener('click', async () => {
      const data = getQuickWorkout(state.finishedSessions, await quickWorkoutLibrary(), state.qw.duration, 80);
      if (!data.exercises.length) {
        state.qw.visible = false; state.qw.exercises = []; state.qw.pool = {};
        render();
        toast('No recovered muscle groups with exercises yet — train or add exercises first.', 'bad');
        return;
      }
      state.qw.exercises = data.exercises;
      state.qw.pool = data.pool;
      state.qw.meta = `${data.exercises.length} exercises · ~${data.estimatedDurationMin} min · ${data.targetMuscleGroups.join(', ')}`;
      state.qw.visible = true;
      render();
    });
    root.querySelectorAll<HTMLElement>('[data-qw-swap]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.qwSwap) || 0;
      const exercise = state.qw.exercises[index];
      const pool = state.qw.pool[exercise?.muscleGroup || ''] || [];
      if (!exercise || !pool.length) return;
      const replacement = pool.shift()!;
      pool.push(exercise); // cycle the swapped-out exercise back in
      state.qw.pool[exercise.muscleGroup] = pool;
      state.qw.exercises[index] = replacement;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-qw-remove]').forEach((button) => button.addEventListener('click', () => {
      state.qw.exercises.splice(Number(button.dataset.qwRemove) || 0, 1);
      if (!state.qw.exercises.length) state.qw.visible = false;
      render();
    }));
    root.querySelector('#qw-start')?.addEventListener('click', () => {
      if (!state.qw.exercises.length) return;
      const groups = [...new Set(state.qw.exercises.map((exercise) => exercise.muscleGroup).filter(Boolean))];
      const name = 'Quick — ' + (groups.length ? groups.join(', ') : 'Mixed');
      const program: RelayProgram = {
        slug: 'quick-workout', name, description: '', tags: [], sourceLabel: '', eventId: '', pubkey: '', address: '', createdAt: Date.now(),
        exercises: state.qw.exercises.map((exercise) => ({ address: '', name: exercise.name, muscleGroup: exercise.muscleGroup, sets: exercise.sets, reps: exercise.reps, restSec: exercise.restSec }))
      };
      state.qw.visible = false;
      void startTrainingSession(program);
    });
  }

  async function deleteSession(id: number): Promise<void> {
    if (!state.store || !id) return;
    if (!window.confirm('Delete this session? All logged sets will be permanently removed from your history and stats.')) return;
    await state.store.deleteSession(id);
    if (state.expandedSessionId === id) state.expandedSessionId = null;
    state.finishedSessions = await loadFinishedSessions();
    render();
  }

  async function saveUnitPreference(value: string): Promise<void> {
    if (!state.store) return;
    state.settings = { ...state.settings, unit: normalizeWeightUnit(value) };
    await state.store.saveSettings(state.settings);
    render();
  }

  async function loadFinishedSessions(): Promise<ActiveSession[]> {
    if (!state.store) return [];
    const sessions = (await state.store.listSessions()).filter((session) => session.finished_at);
    const result: ActiveSession[] = [];
    for (const session of sessions) {
      const sets = session.id ? await state.store.listSessionSets(session.id) : [];
      result.push(activeSessionFromStored(session, sets));
    }
    return result;
  }

  async function loadUnfinishedSession(): Promise<ActiveSession | null> {
    if (!state.store) return null;
    const session = (await state.store.listSessions()).find((item) => !item.finished_at);
    if (!session?.id) return null;
    return activeSessionFromStored(session, await state.store.listSessionSets(session.id));
  }

  function activeSessionFromStored(session: Session, sets: SessionSet[]): ActiveSession {
    const exercises = (session.exercises || []) as SessionExercise[];
    return {
      id: Number(session.id),
      sheetName: session.sheet_name || 'Workout',
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      exercises,
      sets: sets.map((set) => ({
        exerciseSlug: set.exercise_slug || String(set.exercise_id || ''),
        exerciseName: set.exercise_name,
        setNumber: Number(set.set_number),
        reps: set.reps ?? null,
        weight: set.weight_kg ?? null,
        done: true,
        completedAt: set.completed_at
      }))
    };
  }

  async function refreshExercises(): Promise<void> {
    state.exerciseStatus = `loading exercises from ${WORKSTR_LIBRARY_RELAY}...`;
    render();
    try {
      const exercises = await fetchRelayExercises();
      state.exercises = exercises;
      state.exerciseStatus = `loaded ${exercises.length} exercises from ${WORKSTR_LIBRARY_RELAY}`;
    } catch (error) {
      state.exerciseStatus = `exercise relay error: ${(error as Error).message}`;
    }
    render();
  }

  async function refreshPrograms(): Promise<void> {
    state.programStatus = `loading workouts from ${WORKSTR_LIBRARY_RELAY}...`;
    render();
    try {
      if (!state.exercises.length) {
        try { state.exercises = await fetchRelayExercises(); } catch { /* Program cards can still infer fallback muscles. */ }
      }
      const programs = await fetchRelayPrograms();
      state.programs = programs;
      state.programStatus = `loaded ${programs.length} workouts from ${WORKSTR_LIBRARY_RELAY}`;
      void refreshProgramProfiles(programs);
    } catch (error) {
      state.programStatus = `workout relay error: ${(error as Error).message}`;
    }
    render();
  }

  async function refreshProgramProfiles(programs: RelayProgram[]): Promise<void> {
    const pubkeys = [...new Set(programs.map((program) => program.pubkey).filter(Boolean))].filter((pubkey) => !state.profileNames[pubkey]);
    if (!pubkeys.length) return;
    const entries = await Promise.all(pubkeys.map(async (pubkey) => [pubkey, await fetchProfileName(pubkey)] as const));
    let changed = false;
    for (const [pubkey, name] of entries) {
      if (name) { state.profileNames[pubkey] = name; changed = true; }
    }
    if (changed) render();
  }

  function signOut(): void {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SIGNER_TYPE_KEY);
    state.pubkey = null; state.npub = null; state.profileName = null; state.store = null; state.settings = { ...DEFAULT_SETTINGS }; state.signerType = null; state.activeSession = null; state.editingId = null; state.signInStatus = null; state.bodyEntries = []; state.sheets = [];
    render();
  }


  let sessionExerciseIndex = 0;
  let sessionSetCounts: Record<string, number> = {};
  let pendingConnect: { uri: string; mobile: boolean } | null = null;
  let toastTimer: number | undefined;
  let builder: BuilderState | null = null;
  let sessionRestTimer = 0;
  let sessionRestTotal = 0;
  let sessionRestRemaining = 0;
  let sessionElapsedTimer = 0;
  let sessionWakeLock: WakeLockSentinel | null = null;
  const sessionPreviousSets = new Map<string, SessionSetLog[]>();

  function unitLabel(): string { return normalizeWeightUnit(state.settings.unit); }

  function wDisplay(weight: number | null | undefined): number | null { return displayWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function wFmt(weight: number | null | undefined): string { return weight == null ? '—' : formatWeightKg(weight, normalizeWeightUnit(state.settings.unit)); }

  function sessionWeightDisplay(weight: number | string | null | undefined): string {
    const value = displayWeightKg(weight, normalizeWeightUnit(state.settings.unit));
    return value == null ? '' : String(value);
  }

  function programSessionExercises(program: RelayProgram): SessionExercise[] {
    return program.exercises.map((member) => {
      const full = resolveProgramExercise(member, state.exercises);
      const name = programExerciseName(member, full);
      return {
        exerciseSlug: full?.slug || slugify(name),
        exerciseName: name,
        muscleGroup: programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name)),
        imageUrl: member.imageUrl || full?.image_url,
        sets: Number(member.sets) || Number(full?.default_sets) || 3,
        reps: String(member.reps || full?.default_reps || '8-12'),
        restSec: Number(member.restSec || member.rest || full?.default_rest) || 90,
        weight: member.weight ?? null,
        notes: member.notes || full?.description || '',
        instructions: full?.instructions || []
      };
    });
  }

  function getSessionExercises(session: ActiveSession): SessionExercise[] { return session.exercises; }

  function setCountsFromSession(session: ActiveSession): Record<string, number> {
    const counts: Record<string, number> = {};
    getSessionExercises(session).forEach((ex) => {
      const logged = session.sets.filter((set) => set.exerciseSlug === ex.exerciseSlug).length;
      counts[ex.exerciseSlug] = Math.max(Number(ex.sets) || 1, logged || 1);
    });
    return counts;
  }

  async function startTrainingSession(program: RelayProgram): Promise<void> {
    const exercises = programSessionExercises(program);
    const startedAt = new Date().toISOString();
    const sessionId = state.store ? await state.store.createSession({ sheet_name: program.name || 'Freestyle', started_at: startedAt, exercises }) : Date.now();
    state.activeSession = { id: sessionId, sheetName: program.name || 'Freestyle', startedAt, exercises, sets: [] };
    sessionExerciseIndex = 0;
    sessionSetCounts = setCountsFromSession(state.activeSession);
    await openSessionOverlay(state.activeSession);
  }

  async function requestSessionWakeLock(): Promise<void> {
    if (sessionWakeLock || !('wakeLock' in navigator)) return;
    try {
      sessionWakeLock = await navigator.wakeLock.request('screen');
      sessionWakeLock.addEventListener('release', () => { sessionWakeLock = null; });
    } catch { /* Wake lock is best-effort, exactly like self-hosted Workstr. */ }
  }

  function releaseSessionWakeLock(): void {
    if (sessionWakeLock) { void sessionWakeLock.release(); sessionWakeLock = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.activeSession && root.querySelector('#session-overlay')?.classList.contains('open')) void requestSessionWakeLock();
  });

  async function openSessionOverlay(session: ActiveSession): Promise<void> {
    root.querySelector('#session-overlay')?.classList.add('open');
    void requestSessionWakeLock();
    window.clearInterval(sessionElapsedTimer);
    updateSessionElapsed(session);
    sessionElapsedTimer = window.setInterval(() => { if (state.activeSession) updateSessionElapsed(state.activeSession); }, 1000);
    if (!Object.keys(sessionSetCounts).length) sessionSetCounts = setCountsFromSession(session);
    await renderSessionExercise(session);
  }

  function updateSessionElapsed(session: ActiveSession): void {
    const el = root.querySelector('#session-elapsed');
    if (!el || !session.startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
    el.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function loggedSetCount(slug: string): number {
    return state.activeSession ? state.activeSession.sets.filter((set) => set.exerciseSlug === slug && set.done).length : 0;
  }

  function updateSessionProgress(): void {
    const fill = root.querySelector<HTMLElement>('#session-progress-fill');
    if (!fill || !state.activeSession) return;
    const exercises = getSessionExercises(state.activeSession);
    let total = 0, done = 0;
    exercises.forEach((ex) => {
      const target = sessionSetCounts[ex.exerciseSlug] || Number(ex.sets) || 1;
      total += target;
      done += Math.min(loggedSetCount(ex.exerciseSlug), target);
    });
    fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  }

  function renderSessionNav(exercises: SessionExercise[]): void {
    const nav = root.querySelector('#session-ex-nav');
    if (!nav) return;
    nav.innerHTML = exercises.map((ex, i) => {
      const target = Number(ex.sets) || sessionSetCounts[ex.exerciseSlug] || 1;
      const cls = i === sessionExerciseIndex ? 'current' : loggedSetCount(ex.exerciseSlug) >= target ? 'done' : '';
      return `<button class="session-ex-dot ${cls}" data-jump-ex="${i}" type="button">${i + 1}</button>`;
    }).join('');
  }

  function previousSetKey(sessionId: number, slug: string): string { return `${sessionId}:${slug}`; }

  async function getPreviousSets(sessionId: number, slug: string): Promise<SessionSetLog[]> {
    const key = previousSetKey(sessionId, slug);
    if (!sessionPreviousSets.has(key)) sessionPreviousSets.set(key, []);
    return sessionPreviousSets.get(key) || [];
  }

  function formatSetHint(set: SessionSetLog): string {
    const reps = set.reps ?? '?';
    const weight = set.weight == null ? '' : ` @ ${wFmt(set.weight)}`;
    return `${reps}${weight}`;
  }

  function suggestedSetHint(prev: SessionSetLog, targetReps: string): string {
    return `suggested: ${html(targetReps || String(prev.reps || 'reps'))} reps${prev.weight == null ? '' : ` @ ${wFmt(prev.weight)}`}`;
  }

  async function renderSessionExercise(session: ActiveSession): Promise<void> {
    const exercises = getSessionExercises(session);
    const title = root.querySelector('#session-title');
    const meta = root.querySelector('#session-meta');
    const body = root.querySelector('#session-body');
    const footer = root.querySelector('#session-footer');
    if (!title || !meta || !body || !footer) return;
    if (!exercises.length) {
      title.textContent = session.sheetName || 'Freestyle';
      meta.textContent = 'No exercises yet';
      body.innerHTML = '<div class="empty">This session has no exercises yet.</div>';
      footer.innerHTML = '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>';
      return;
    }
    if (sessionExerciseIndex >= exercises.length) sessionExerciseIndex = exercises.length - 1;
    const ex = exercises[sessionExerciseIndex];
    const slug = ex.exerciseSlug;
    const name = ex.exerciseName || slug;
    const restSec = Number(ex.restSec) || 90;
    const targetSets = Number(ex.sets) || sessionSetCounts[slug] || 1;
    const targetReps = ex.reps || '';
    const logged = session.sets.filter((set) => set.exerciseSlug === slug);
    const previousSets = await getPreviousSets(session.id, slug);
    if (state.activeSession?.id !== session.id || getSessionExercises(state.activeSession)[sessionExerciseIndex]?.exerciseSlug !== slug) return;
    sessionSetCounts[slug] = Math.max(sessionSetCounts[slug] || targetSets, logged.length || targetSets);
    const rows = Array.from({ length: sessionSetCounts[slug] }, (_, i) => {
      const done = logged.find((set) => Number(set.setNumber) === i + 1);
      const prev = previousSets[i];
      const locked = !done && i > 0 && !logged.find((set) => Number(set.setNumber) === i);
      const prevHint = prev ? `<div class="session-set-hint prev">prev: ${html(formatSetHint(prev))}</div>` : '';
      const suggestHint = prev ? `<div class="session-set-hint suggest">${suggestedSetHint(prev, targetReps)}</div>` : '';
      const defaultReps = String(done?.reps ?? (targetReps || prev?.reps || ''));
      const defaultWeight = done?.weight != null ? sessionWeightDisplay(done.weight) : (prev?.weight != null ? sessionWeightDisplay(prev.weight) : sessionWeightDisplay(ex.weight));
      return `<div class="session-set-block ${locked ? 'locked' : ''}" data-set-block="${i}">
        <div class="session-set-row">
          <div class="session-set-num ${done ? 'done' : ''}" data-set-num="${i}">${i + 1}</div>
          <input class="session-set-input" data-session-reps="${i}" type="number" inputmode="numeric" placeholder="${html(targetReps || prev?.reps || 'reps')}" value="${html(defaultReps)}" ${done || locked ? 'disabled' : ''}>
          <input class="session-set-input" data-session-weight="${i}" type="number" inputmode="decimal" step="0.5" placeholder="${html(defaultWeight || unitLabel())}" value="${html(defaultWeight)}" ${done || locked ? 'disabled' : ''}>
          ${done ? `<button class="session-log-btn done" data-set-log-btn="${i}" disabled type="button">Done</button>` : `<button class="session-log-btn" data-session-log="${html(slug)}" data-set-index="${i}" data-set-log-btn="${i}" data-rest="${restSec}" ${locked ? 'disabled' : ''} type="button">Log</button>`}
        </div>
        ${prevHint}${suggestHint}
      </div>`;
    }).join('');
    const instructions = ex.instructions || [];
    const instructionsHtml = instructions.length ? `
      <div class="session-instructions" id="session-instructions">
        <div class="session-instructions-toggle" data-toggle-instructions>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>How to perform</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="session-instructions-body">
          ${instructions.map((step, i) => `<div class="session-instructions-step"><b>${i + 1}</b>${html(step)}</div>`).join('')}
        </div>
      </div>` : '';
    title.textContent = session.sheetName || 'Freestyle';
    meta.textContent = `Exercise ${sessionExerciseIndex + 1} of ${exercises.length}`;
    renderSessionNav(exercises);
    body.innerHTML = `
      ${ex.imageUrl ? `<img class="session-ex-image" src="${html(ex.imageUrl)}" alt="${html(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src');this.textContent='No exercise image'">` : '<div class="session-ex-image placeholder">No exercise image</div>'}
      <div class="session-ex-name">${html(name)}</div>
      <div class="session-ex-target"><b>${targetSets}</b> sets <span class="dot"></span> <b>${html(targetReps || 'free')}</b> reps <span class="dot"></span> <b>${restSec}s</b> rest</div>
      <div class="session-sets">${rows}</div>
      <button class="session-add-set" data-add-session-set="${html(slug)}" type="button">+ Add set</button>
      ${instructionsHtml}`;
    const isLast = sessionExerciseIndex >= exercises.length - 1;
    footer.innerHTML = `${sessionExerciseIndex > 0 ? `<button class="session-prev-btn" data-jump-ex="${sessionExerciseIndex - 1}" type="button">Prev</button>` : ''}${isLast ? '<button class="session-finish-btn" id="finish-session" type="button">Finish session</button>' : `<button class="session-next-btn" data-jump-ex="${sessionExerciseIndex + 1}" type="button">Next</button>`}`;
    bindSessionControls();
    updateSessionProgress();
  }

  async function logSessionSet(slug: string, setIndex: number, restSec: number): Promise<void> {
    if (!state.activeSession) return;
    const repsEl = root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex}"]`);
    const weightEl = root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex}"]`);
    const logBtn = root.querySelector<HTMLButtonElement>(`[data-set-log-btn="${setIndex}"]`);
    const reps = repsEl?.value ?? '';
    const weight = weightEl?.value ?? '';
    if (reps === '' && weight === '') {
      repsEl?.focus(); repsEl?.classList.add('shake'); window.setTimeout(() => repsEl?.classList.remove('shake'), 420); return;
    }
    const repsNum = reps === '' ? null : Number(reps);
    const weightNum = weight === '' ? null : storeWeightInput(weight, normalizeWeightUnit(state.settings.unit));
    if (logBtn) { logBtn.disabled = true; logBtn.textContent = '···'; }
    const currentExercise = getSessionExercises(state.activeSession).find((exercise) => exercise.exerciseSlug === slug);
    const loggedSet: SessionSetLog = { exerciseSlug: slug, exerciseName: currentExercise?.exerciseName, setNumber: setIndex + 1, reps: repsNum, weight: weightNum, done: true, completedAt: new Date().toISOString() };
    if (state.store) {
      await state.store.addSessionSet({
        session_id: state.activeSession.id,
        exercise_slug: slug,
        exercise_name: currentExercise?.exerciseName || slug,
        set_number: setIndex + 1,
        reps: repsNum,
        weight_kg: weightNum,
        completed_at: loggedSet.completedAt
      });
    }
    state.activeSession.sets.push(loggedSet);
    if (repsEl) repsEl.disabled = true;
    if (weightEl) weightEl.disabled = true;
    root.querySelector(`[data-set-num="${setIndex}"]`)?.classList.add('done');
    root.querySelector(`[data-set-block="${setIndex}"]`)?.classList.add('just-logged');
    if (logBtn) { logBtn.textContent = 'Done'; logBtn.classList.add('done'); logBtn.disabled = true; logBtn.removeAttribute('data-session-log'); }
    const nextBlock = root.querySelector(`[data-set-block="${setIndex + 1}"]`);
    if (nextBlock) {
      nextBlock.classList.remove('locked');
      nextBlock.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => { el.disabled = false; });
      const nReps = root.querySelector<HTMLInputElement>(`[data-session-reps="${setIndex + 1}"]`);
      const nWeight = root.querySelector<HTMLInputElement>(`[data-session-weight="${setIndex + 1}"]`);
      if (nReps && !nReps.value && repsNum != null) nReps.value = String(repsNum);
      if (nWeight && !nWeight.value && weight !== '') nWeight.value = weight;
    }
    renderSessionNav(getSessionExercises(state.activeSession));
    updateSessionProgress();
    const target = sessionSetCounts[slug] || 1;
    const allDone = loggedSetCount(slug) >= target;
    startSessionRest(restSec, allDone);
  }

  function startSessionRest(sec: number, autoAdvance: boolean): void {
    root.querySelector('#session-rest-overlay')?.classList.add('show');
    sessionRestTotal = Number(sec) || 90;
    sessionRestRemaining = sessionRestTotal;
    const nextUp = root.querySelector('#rest-nextup');
    if (nextUp && state.activeSession) {
      const exercises = getSessionExercises(state.activeSession);
      const next = autoAdvance ? exercises[sessionExerciseIndex + 1] : null;
      nextUp.innerHTML = next ? `Next up: <b>${html(next.exerciseName || next.exerciseSlug)}</b>` : '';
    }
    updateSessionRestDisplay();
    window.clearInterval(sessionRestTimer);
    sessionRestTimer = window.setInterval(() => {
      sessionRestRemaining -= 1;
      updateSessionRestDisplay();
      if (sessionRestRemaining <= 0) {
        skipSessionRest();
        if (autoAdvance && state.activeSession) {
          const exercises = getSessionExercises(state.activeSession);
          if (sessionExerciseIndex < exercises.length - 1) { sessionExerciseIndex += 1; void renderSessionExercise(state.activeSession); }
        }
      }
    }, 1000);
  }

  function updateSessionRestDisplay(): void {
    const val = root.querySelector('#session-rest-val');
    if (val) val.textContent = String(sessionRestRemaining);
    const fg = root.querySelector<SVGCircleElement>('#rest-ring-fg');
    if (fg) {
      const circumference = 339.3;
      const offset = sessionRestTotal > 0 ? circumference * (1 - sessionRestRemaining / sessionRestTotal) : 0;
      fg.style.strokeDashoffset = String(Math.max(0, Math.min(circumference, offset)));
      fg.style.stroke = sessionRestRemaining <= 5 ? 'var(--danger-red)' : 'var(--sovereign-purple)';
    }
  }

  function adjustRest(delta: number): void {
    sessionRestRemaining = Math.max(5, sessionRestRemaining + delta);
    if (sessionRestTotal < sessionRestRemaining) sessionRestTotal = sessionRestRemaining;
    updateSessionRestDisplay();
  }

  function skipSessionRest(): void {
    window.clearInterval(sessionRestTimer);
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
  }

  async function finishActiveSession(): Promise<void> {
    if (!state.activeSession) return;
    state.activeSession.finishedAt = new Date().toISOString();
    if (state.store) await state.store.finishSession(state.activeSession.id, state.activeSession.finishedAt);
    const finished = state.activeSession;
    state.finishedSessions = state.store ? await loadFinishedSessions() : [finished, ...state.finishedSessions];
    closeSessionOverlay();
    state.activeSession = null;
    renderFinished(finished);
  }

  async function cancelActiveSession(): Promise<void> {
    if (!state.activeSession) return closeSessionOverlay();
    if (!window.confirm('End and discard this session? Logged sets will be deleted.')) return;
    if (state.store) await state.store.deleteSession(state.activeSession.id);
    state.activeSession = null;
    closeSessionOverlay();
  }

  function closeSessionOverlay(clear = true): void {
    window.clearInterval(sessionRestTimer);
    window.clearInterval(sessionElapsedTimer);
    releaseSessionWakeLock();
    root.querySelector('#session-rest-overlay')?.classList.remove('show');
    root.querySelector('#session-overlay')?.classList.remove('open');
    root.querySelector('#pr-toast')?.classList.remove('show');
    if (clear) {
      sessionSetCounts = {};
      sessionExerciseIndex = 0;
      sessionPreviousSets.clear();
    }
  }

  function sessionDurationLabel(session: ActiveSession): string {
    if (!session.startedAt || !session.finishedAt) return '—';
    const sec = Math.max(0, Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function renderFinished(session: ActiveSession): void {
    const doneSets = session.sets.filter((set) => set.done);
    const volume = Math.round(doneSets.reduce((a, set) => a + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));
    const exerciseCount = new Set(doneSets.map((set) => set.exerciseSlug)).size;
    const stats = [
      { val: sessionDurationLabel(session), label: 'Duration' },
      { val: doneSets.length, label: 'Sets' },
      { val: volume > 0 ? `${Math.round(wDisplay(volume) ?? 0)} ${unitLabel()}` : '—', label: 'Volume' },
      { val: exerciseCount, label: 'Exercises' }
    ];
    openModal(`
      <div class="summary-hero">
        <div class="sh-medal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12"/></svg></div>
        <div class="sh-copy"><strong>${html(session.sheetName || 'Freestyle')}</strong><small>nicely done — here's the recap</small></div>
      </div>
      <div class="summary-stats">${stats.map((item) => `<div class="summary-stat"><div class="ss-val">${html(String(item.val))}</div><div class="ss-label">${item.label}</div></div>`).join('')}</div>
      <div class="subsection-head"><span>Vs last time</span><small>working-set volume per exercise</small></div>
      <div class="summary-compare"><div class="empty">First local web session — comparison appears after you repeat this workout.</div></div>
      <div class="form-actions"><button class="button ghost" id="finish-done" type="button">Done</button></div>`);
    root.querySelector('#finish-done')?.addEventListener('click', closeModal);
  }

  function openModal(content: string): void {
    const modal = root.querySelector('#modal');
    const host = root.querySelector('#modal-content');
    if (host) host.innerHTML = content;
    modal?.classList.add('open');
    root.querySelector('#modal-close')?.addEventListener('click', closeModal);
  }

  function closeModal(): void { pendingConnect = null; builder = null; root.querySelector('#modal')?.classList.remove('open'); }

  function bindSessionControls(): void {
    root.querySelector('#session-close')?.addEventListener('click', () => { void cancelActiveSession(); });
    root.querySelector('#rest-skip')?.addEventListener('click', skipSessionRest);
    root.querySelectorAll<HTMLElement>('[data-rest-adjust]').forEach((button) => button.addEventListener('click', () => adjustRest(Number(button.dataset.restAdjust) || 0)));
    root.querySelectorAll<HTMLElement>('[data-jump-ex]').forEach((button) => button.addEventListener('click', () => {
      if (!state.activeSession) return;
      sessionExerciseIndex = Number(button.dataset.jumpEx) || 0;
      void renderSessionExercise(state.activeSession);
    }));
    root.querySelectorAll<HTMLElement>('[data-session-log]').forEach((button) => button.addEventListener('click', () => {
      void logSessionSet(button.dataset.sessionLog || '', Number(button.dataset.setIndex) || 0, Number(button.dataset.rest) || 90);
    }));
    root.querySelectorAll<HTMLElement>('[data-add-session-set]').forEach((button) => button.addEventListener('click', () => {
      if (!state.activeSession) return;
      const slug = button.dataset.addSessionSet || '';
      sessionSetCounts[slug] = (sessionSetCounts[slug] || 0) + 1;
      void renderSessionExercise(state.activeSession);
    }));
    root.querySelector('#finish-session')?.addEventListener('click', () => { void finishActiveSession(); });
    root.querySelector('[data-toggle-instructions]')?.addEventListener('click', () => root.querySelector('#session-instructions')?.classList.toggle('open'));
  }

  async function connectNip07(): Promise<void> {
    try {
      const signer = createNip07Signer();
      const pubkey = await signer.getPublicKey();
      await openAndRender(pubkey, 'nip07');
    } catch (error) {
      state.signInStatus = `extension signer error ${(error as Error).message}`;
      render();
    }
  }

  async function startRemoteSignerRequest(): Promise<void> {
    try {
      state.signInStatus = 'creating signer connect request...'; render();
      const request = createNostrConnectSignerRequest(defaultBunkerRelays(), { onAuthUrl: launchSignerRequest });
      const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
      state.signInStatus = `waiting for signer approval on ${request.relays.join(', ')}`;
      render();
      showSignerConnectModal(request.uri, mobile);
      if (mobile) launchSignerRequest(request.uri);
      const connected = await request.signer;
      closeModal();
      await openAndRender(connected.pubkey, 'nip46');
    } catch (error) {
      closeModal();
      state.signInStatus = `signer error ${(error as Error).message}`;
      render();
    }
  }

  function showSignerConnectModal(uri: string, mobile: boolean): void {
    pendingConnect = { uri, mobile };
    renderConnectModal();
  }

  function renderConnectModal(): void {
    if (!pendingConnect) return;
    const { uri, mobile } = pendingConnect;
    openModal(`<div class="page-title">Connect signer</div>
      <p class="section-help">${mobile
        ? 'Approve the request in your signer app, then return to this tab. You can also scan the QR code from another device.'
        : 'Scan the QR code with your NIP-46 signer app (Clave, Amber, ...). Once you approve, this tab signs in automatically.'}</p>
      <div class="signer-qr">${renderSVG(uri, { border: 2 })}</div>
      <div class="web-empty-actions">
        <button id="connect-copy" class="button ghost" type="button">Copy connect link</button>
        <button id="connect-open" class="button ghost" type="button">Open signer app</button>
      </div>`);
    root.querySelector('#connect-copy')?.addEventListener('click', (event) => {
      void navigator.clipboard.writeText(uri);
      (event.currentTarget as HTMLButtonElement).textContent = 'Copied';
    });
    root.querySelector('#connect-open')?.addEventListener('click', () => launchSignerRequest(uri));
  }

  function launchSignerRequest(uri: string): void {
    const link = document.createElement('a');
    link.href = uri; link.target = '_blank'; link.rel = 'noreferrer'; link.style.display = 'none';
    document.body.appendChild(link); link.click(); link.remove();
  }

  async function openAndRender(pubkey: string, signerType: AppState['signerType'] = pubkey === 'demo-local-pubkey' ? 'demo' : state.signerType): Promise<void> {
    await openIdentity(pubkey, true, signerType);
    render();
  }

  async function saveExercise(event: Event): Promise<void> {
    event.preventDefault();
    if (!state.store) return;
    const data = new FormData(event.target as HTMLFormElement);
    const name = String(data.get('name') || '').trim();
    const id = Number(data.get('id')) || undefined;
    const primary = String(data.get('muscle_group') || 'Chest');
    await state.store.upsertExercise({
      id,
      slug: id ? state.exercises.find((exercise) => exercise.id === id)?.slug || slugify(name) : slugify(name),
      name,
      description: String(data.get('description') || '').trim(),
      category: String(data.get('category') || 'strength').trim(),
      muscle_group: primary,
      muscles: [primary],
      equipment: splitList(data.get('equipment')),
      difficulty: String(data.get('difficulty') || 'beginner'),
      tags: [],
      instructions: String(data.get('instructions') || '').split('\n').map((line) => line.trim()).filter(Boolean),
      favourite: false,
      default_sets: Number(data.get('sets')) || undefined,
      default_reps: Number(data.get('reps')) || undefined,
      default_rest: Number(data.get('rest')) || undefined,
      source_type: 'manual',
      status: 'active'
    });
    state.exercises = await state.store.listExercises();
    state.editingId = null;
    render();
  }

  async function deleteExercise(id: number): Promise<void> {
    if (!state.store) return;
    await state.store.deleteExercise(id);
    state.exercises = await state.store.listExercises();
    render();
  }

  void connectNip07;
  void boot();
}
