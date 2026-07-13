import { nip19, SimplePool } from 'nostr-tools';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { createNostrConnectSignerRequest, defaultBunkerRelays } from '../signer/nip46';
import { slugify } from '../core/ids';
import { CANONICAL_REGIONS, canonMuscle } from '../core/muscles';
import { WorkstrStore, type ExerciseDraft } from '../db/store';
import starterExercises from '../data/starter-exercises.json';
import type { Exercise } from '../core/types';
import { fetchRelayExercises, fetchRelayPrograms, WORKSTR_LIBRARY_RELAY, type RelayProgram } from '../nostr/powrLibrary';

const SESSION_KEY = 'workstr.currentPubkey';
const SIGNER_TYPE_KEY = 'workstr.signerType';
const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://purplepag.es', 'wss://user.kindpag.es', 'wss://relay.nostr.band'];

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
  signerType: 'nip07' | 'nip46' | 'demo' | null;
  view: View;
  subState: { exercises: 'library' | 'discover'; workouts: 'programs' | 'discover' | 'history' | 'recovery'; statistics: 'training' | 'body' };
  exercises: Exercise[];
  programs: RelayProgram[];
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

function workoutsView(state: AppState): string {
  const active = state.subState.workouts;
  const query = state.programFilter.toLowerCase();
  const programs = state.programs.filter((program) => [program.name, program.description, ...program.tags].join(' ').toLowerCase().includes(query));
  return `<div class="page active" id="page-workouts">
    <div class="page-title">Workouts</div>
    ${subTabs('workouts', active, ['Programs', 'Discover', 'History', 'Recovery'])}
    <div class="sub-panel ${active === 'programs' ? 'active' : ''}" id="sub-workouts-programs">
      <div class="panel"><div class="filter-bar"><input class="grow" id="program-filter" placeholder="Search programs..." autocomplete="off" value="${html(state.programFilter)}" /></div><div class="program-list">${programs.map((program) => programCard(program, state)).join('') || '<div class="empty">No workouts match.</div>'}</div></div>
    </div>
    <div class="sub-panel ${active === 'discover' ? 'active' : ''}" id="sub-workouts-discover">
      <div class="panel"><div class="filter-bar"><input class="grow" placeholder="Search programs..." autocomplete="off" /></div><div class="program-list">${state.programs.map((program) => programCard(program, state)).join('')}</div></div>
    </div>
    <div class="sub-panel ${active === 'history' ? 'active' : ''}" id="sub-workouts-history">
      <div class="panel"><div class="panel-head"><span>Workout history</span></div><p class="section-help">Every completed session, newest first. Expand one to see the exercises and sets you logged; delete it to remove it from your history and stats.</p><div class="list empty">No completed sessions yet.</div></div>
    </div>
    <div class="sub-panel ${active === 'recovery' ? 'active' : ''}" id="sub-workouts-recovery">
      <div class="panel"><div class="panel-head"><span>Muscle recovery</span><strong>—</strong></div><p class="section-help">Estimated readiness per muscle group from your completed sessions over the last 10 days. Bigger groups recover slower; higher training volume extends recovery.</p><div class="recovery empty">No completed sessions yet — train to see recovery.</div></div>
      <div class="panel"><div class="panel-head"><span>Quick workout</span><div class="qw-duration"><button class="qw-dur-btn">20</button><button class="qw-dur-btn">30</button><button class="qw-dur-btn active">45</button><button class="qw-dur-btn">60</button><span class="qw-dur-unit">min</span></div></div><p class="section-help">Generates a balanced session from exercises whose muscle groups are recovered. Pick a duration, then swap or drop any exercise before you start.</p><button class="button primary" style="width:100%">Generate from recovered muscles</button></div>
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

function programMuscleMap(program: RelayProgram, exercises: Exercise[]): string {
  const { primary, secondary } = programMuscleSets(program, exercises);
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

function programCard(program: RelayProgram, state: AppState): string {
  const exerciseCount = program.exercises.length;
  const time = formatMinutes(estimateProgramMin(program.exercises));
  const groups = programGroups(program, state.exercises);
  const map = programMuscleMap(program, state.exercises);
  const meta = [`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`, program.description ? html(program.description) : '', time ? `~${time}` : ''].filter(Boolean).join(' · ');
  const isExpanded = state.expandedProgramAddress === program.address;
  return `<div class="workout-card ${isExpanded ? 'expanded' : ''}" data-program-address="${html(program.address)}">
    <div class="workout-card-header" data-toggle-program="${html(program.address)}">
      <div class="workout-card-map ${map ? 'has-map' : ''}">${map || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4"/></svg>'}</div>
      <div class="workout-card-info">
        <div class="workout-card-name">${html(program.name)}<span class="program-status published">${html(program.sourceLabel || 'Workstr')}</span></div>
        <div class="workout-card-meta">${meta}</div>
        <div class="workout-card-author">${html(programAuthor(program, state))}</div>
        ${groups.length ? `<div class="workout-card-muscles">${html(groups.join(', '))}</div>` : ''}
      </div>
      <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="workout-card-body">${isExpanded ? programBody(program, state.exercises) : ''}</div>
  </div>`;
}

function programBody(program: RelayProgram, exercises: Exercise[]): string {
  const exHtml = program.exercises.length ? program.exercises.map((member, index) => {
    const full = resolveProgramExercise(member, exercises);
    const name = programExerciseName(member, full);
    const muscle = programMuscleLabel(member.muscleGroup || full?.muscle_group || inferProgramMuscle(name));
    const image = exerciseImage(member.imageUrl || full?.image_url);
    const sets = Number(member.sets) || 3;
    const reps = member.reps || String(full?.default_reps || '8-12');
    const weight = member.weight != null && member.weight !== '' ? ` @ ${html(member.weight)}` : '';
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
          <div class="wk-ex-detail-cell"><div class="val">${member.weight != null && member.weight !== '' ? html(member.weight) : '—'}</div><div class="lbl">Weight</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${rest}s</div><div class="lbl">Rest</div></div>
        </div>
        ${member.notes ? `<div class="wk-ex-detail-note">${html(member.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="empty" style="padding:10px 0">No exercises yet.</p>';
  return `<div class="wk-ex-list">${exHtml}</div>
    <div class="workout-card-actions">
      <button class="button gold small" type="button" data-start-program="${html(program.address)}">Start workout</button>
    </div>`;
}

function statisticsView(state: AppState): string {
  const active = state.subState.statistics;
  return `<div class="page active" id="page-statistics">
    <div class="page-title">Statistics</div>
    ${subTabs('statistics', active, ['Training', 'Body'])}
    <div class="sub-panel ${active === 'training' ? 'active' : ''}" id="sub-statistics-training">
      <div class="stats-hero"><div class="summary-stat"><div class="ss-val">0</div><div class="ss-label">Day streak</div></div><div class="summary-stat"><div class="ss-val">0</div><div class="ss-label">Total sessions</div></div><div class="summary-stat"><div class="ss-val">0<small class="ss-unit">kg</small></div><div class="ss-label">Total volume</div></div></div>
      <div class="panel"><div class="panel-head"><span>Weekly volume</span></div><div class="bars"></div><div class="subsection-head"><span>Muscle distribution</span><small>by working sets</small></div><div class="dist empty">No logged sets yet.</div><div class="subsection-head"><span>Personal records</span><small>best estimated 1RM (Epley)</small></div><div class="list empty">No records yet.</div></div>
    </div>
    <div class="sub-panel ${active === 'body' ? 'active' : ''}" id="sub-statistics-body">
      <div class="panel"><div class="panel-head"><span>Body weight</span><span class="section-label">kg</span></div><div class="empty">No entries yet. Log your weight below to start tracking.</div><div class="subsection-head"><span>Log weight</span></div><form class="form-grid"><label>Date<input type="date" /></label><label>Weight (kg)<input type="number" step="0.1" placeholder="e.g. 80" /></label><div class="form-actions span-2"><button class="button primary" type="button">Log weight</button></div></form><div class="subsection-head"><span>Profile</span><small>for BMI &amp; goal</small></div><form class="form-grid"><label>Height (cm)<input type="number" step="1" min="100" max="250" placeholder="e.g. 175" /></label><label>Target weight (kg)<input type="number" step="0.1" min="0" placeholder="e.g. 75" /></label><div class="form-actions span-2"><button class="button" type="button">Save profile</button></div></form></div>
    </div>
  </div>`;
}

function settingsView(state: AppState): string {
  return `<div class="page active"><div class="page-title">Settings</div><div class="panel"><div class="panel-head"><span>Nostr signer</span><span class="status-pill ${state.pubkey ? 'ok' : 'bad'}">${state.pubkey ? 'connected' : 'not signed in'}</span></div><p class="section-help">Workstr Web replaces self-hosted Idenstr with a user-owned NIP-46 signer. Press Sign in in the top-right; the app launches the signer request directly.</p><div class="terminal-mini">secure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\nidentity: ${html(state.pubkey ? displayIdentity(state) : 'not signed in')}\n${state.signInStatus ? html(state.signInStatus) : ''}</div><div class="web-empty-actions">${state.pubkey ? '<button id="sign-out-settings" class="button ghost">Switch signer</button>' : '<button id="sign-in-settings" class="button primary">Sign in</button>'}<button id="open-demo" class="button ghost">Open local demo</button></div></div><div class="panel"><div class="panel-head"><span>Preferences</span></div><label style="max-width:240px">Weight unit<select><option>Kilograms (kg)</option><option>Pounds (lbs)</option></select></label></div></div>`;
}

export function renderShell(root: HTMLElement): void {
  const state: AppState = { pubkey: localStorage.getItem(SESSION_KEY), npub: null, profileName: null, profileNames: {}, store: null, signerType: localStorage.getItem(SIGNER_TYPE_KEY) as AppState['signerType'], view: 'exercises', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, exercises: [], programs: [], activeSession: null, finishedSessions: [], editingId: null, filter: '', programFilter: '', expandedProgramAddress: null, exerciseStatus: `loading exercises from ${WORKSTR_LIBRARY_RELAY}...`, programStatus: '', signInStatus: null };

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
    await state.store.seedExercises(starterExercises as ExerciseDraft[]);
    if (persist) {
      localStorage.setItem(SESSION_KEY, pubkey);
      if (signerType) localStorage.setItem(SIGNER_TYPE_KEY, signerType);
    }
  }

  function render(): void {
    root.innerHTML = shellMarkup(state);
    bind();
    if (state.activeSession) void openSessionOverlay(state.activeSession);
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
      const program = state.programs.find((item) => item.address === button.dataset.startProgram);
      if (program) startTrainingSession(program);
    }));
    bindSessionControls();
    root.querySelector('#exercise-form')?.addEventListener('submit', saveExercise);
    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => { state.editingId = Number(button.dataset.edit); render(); }));
    root.querySelectorAll<HTMLElement>('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteExercise(Number(button.dataset.delete))));
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
    state.pubkey = null; state.npub = null; state.profileName = null; state.store = null; state.signerType = null; state.activeSession = null; state.editingId = null; state.signInStatus = null;
    render();
  }


  let sessionExerciseIndex = 0;
  let sessionSetCounts: Record<string, number> = {};
  let sessionRestTimer = 0;
  let sessionRestTotal = 0;
  let sessionRestRemaining = 0;
  let sessionElapsedTimer = 0;
  let sessionWakeLock: WakeLockSentinel | null = null;
  const sessionPreviousSets = new Map<string, SessionSetLog[]>();

  function unitLabel(): string { return 'kg'; }

  function wDisplay(weight: number | null | undefined): number { return Number(weight || 0); }

  function wFmt(weight: number | null | undefined): string { return weight == null ? '—' : `${wDisplay(weight)}${unitLabel()}`; }

  function sessionWeightDisplay(weight: number | string | null | undefined): string {
    if (weight == null || weight === '') return '';
    const value = Number(weight);
    if (!Number.isFinite(value)) return String(weight);
    return String(Math.round(value * 2.20462));
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
    state.activeSession = { id: Date.now(), sheetName: program.name || 'Freestyle', startedAt: new Date().toISOString(), exercises: programSessionExercises(program), sets: [] };
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
      const defaultWeight = done?.weight != null ? String(done.weight) : (prev?.weight != null ? String(prev.weight) : sessionWeightDisplay(ex.weight));
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
      <div class="session-instructions open" id="session-instructions">
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
    const weightNum = weight === '' ? null : Number(weight);
    if (logBtn) { logBtn.disabled = true; logBtn.textContent = '···'; }
    state.activeSession.sets.push({ exerciseSlug: slug, setNumber: setIndex + 1, reps: repsNum, weight: weightNum, done: true, completedAt: new Date().toISOString() });
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

  function finishActiveSession(): void {
    if (!state.activeSession) return;
    state.activeSession.finishedAt = new Date().toISOString();
    const finished = state.activeSession;
    state.finishedSessions.unshift(finished);
    closeSessionOverlay();
    state.activeSession = null;
    renderFinished(finished);
  }

  function cancelActiveSession(): void {
    if (!state.activeSession) return closeSessionOverlay();
    if (!window.confirm('End and discard this session? Logged sets will be deleted.')) return;
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
      { val: volume > 0 ? `${Math.round(wDisplay(volume))} ${unitLabel()}` : '—', label: 'Volume' },
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

  function closeModal(): void { root.querySelector('#modal')?.classList.remove('open'); }

  function bindSessionControls(): void {
    root.querySelector('#session-close')?.addEventListener('click', cancelActiveSession);
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
    root.querySelector('#finish-session')?.addEventListener('click', finishActiveSession);
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
      state.signInStatus = 'creating open signer request...'; render();
      const request = createNostrConnectSignerRequest(defaultBunkerRelays(), { onAuthUrl: launchSignerRequest });
      state.signInStatus = `launching signer request; approve it, then return to this tab; waiting on ${request.relays.join(', ')}`;
      launchSignerRequest(request.uri); render();
      const connected = await request.signer;
      await openAndRender(connected.pubkey, 'nip46');
    } catch (error) {
      state.signInStatus = `signer error ${(error as Error).message}`;
      render();
    }
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
