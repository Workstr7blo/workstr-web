import { nip19 } from 'nostr-tools';
import { canonMuscle } from '../core/muscles';
import type { Exercise } from '../core/types';
import type { AppState } from './state';

export function html(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
}

export function displayNpub(pubkey: string): string {
  if (pubkey === 'demo-local-pubkey') return 'demo local identity';
  return shortNpub(pubkey);
}

export function displayIdentity(state: AppState): string {
  if (!state.pubkey) return '';
  if (state.profileName) return state.profileName;
  return displayNpub(state.pubkey);
}

export function displayPubkey(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey).slice(0, 12) + '…' + nip19.npubEncode(pubkey).slice(-8);
  } catch {
    return pubkey.slice(0, 8) + '…';
  }
}

export const EX_PLACEHOLDER = '<div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>';

export const difficultyBadgeClass = (difficulty?: string): string =>
  ({ beginner: 'diff-beginner', intermediate: 'diff-intermediate', advanced: 'diff-advanced' } as Record<string, string>)[String(difficulty || '').trim().toLowerCase()] || 'diff-unknown';

export function exerciseSourceLabel(exercise: Exercise): string {
  const source = exercise.source_type;
  return source === 'ai' ? 'ai' : source === 'nostr' || source === 'imported' ? 'nostr' : 'manual';
}

// Every canonical recovery region an exercise touches (primary group + all listed
// muscles), so the muscle filter matches what the Recovery map attributes to it.
export function exerciseCanonMuscleSet(exercise: Exercise): Set<string> {
  const set = new Set<string>();
  const primary = canonMuscle(exercise.muscle_group || '');
  if (primary) set.add(primary);
  for (const muscle of exercise.muscles || []) {
    const canonical = canonMuscle(muscle);
    if (canonical) set.add(canonical);
  }
  return set;
}

// Filter helpers shared by the Library and Discover grids.
export function exerciseFilterValues(exercises: Exercise[]): { categories: string[]; muscles: string[]; difficulties: string[] } {
  const categories = new Set<string>();
  const muscles = new Set<string>();
  const difficulties = new Set<string>();
  for (const exercise of exercises) {
    if (exercise.category) categories.add(exercise.category);
    if (exercise.difficulty) difficulties.add(exercise.difficulty);
    for (const muscle of exerciseCanonMuscleSet(exercise)) muscles.add(muscle);
  }
  const sort = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { categories: sort(categories), muscles: sort(muscles), difficulties: sort(difficulties) };
}

export function filterExercises(exercises: Exercise[], q: string, cat: string, muscle: string, diff: string): Exercise[] {
  const query = q.trim().toLowerCase();
  return exercises.filter((exercise) =>
    (!query || exercise.name.toLowerCase().includes(query) || (exercise.muscle_group || '').toLowerCase().includes(query))
    && (!cat || exercise.category === cat)
    && (!muscle || exerciseCanonMuscleSet(exercise).has(muscle))
    && (!diff || exercise.difficulty === diff));
}

export function fillSelectHtml(id: string, values: string[], allLabel: string, current: string): string {
  return `<select id="${id}"><option value="">${allLabel}</option>${values.map((value) => `<option value="${html(value)}" ${value === current ? 'selected' : ''}>${html(value)}</option>`).join('')}</select>`;
}

export function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? (iso || '') : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function exerciseImage(src?: string): string {
  return src
    ? `<img class="wk-ex-img" src="${html(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wk-ex-img placeholder'}))">`
    : `<div class="wk-ex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
}

// Folds granular muscle names (e.g. "Lateral Deltoid") into the display group
// the program cards use. Shared by the sheets cards and quick-workout scoring.
export function programMuscleLabel(raw?: string): string {
  const value = String(raw || '').trim();
  const key = value.toLowerCase();
  if (['biceps', 'triceps', 'brachialis', 'brachioradialis', 'forearms', 'forearm'].includes(key)) return 'Arms';
  if (['shoulder', 'shoulders', 'deltoid', 'deltoids', 'lateral deltoid', 'anterior deltoid', 'posterior deltoid', 'supraspinatus'].includes(key)) return 'Shoulders';
  return value;
}
