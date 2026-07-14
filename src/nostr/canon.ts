import type { Event } from 'nostr-tools';
import { SimplePool, verifyEvent } from 'nostr-tools';
import { canonMuscle } from '../core/muscles';
import { slugify } from '../core/ids';
import type { CanonCache, Exercise } from '../core/types';
import { DEFAULT_PUBLIC_RELAYS } from './pool';

// The canon is everything signed by the operator key. The d-tag convention
// gives cohesion; the author filter gives control — anyone can copy a d-tag,
// nobody can forge the signature.
export const OPERATOR_PUBKEY = '20e17dd0ec1bb0832688e739ad89709d047deb23ed5146822efdd2d22ae504d7';
export const CANON_RELAYS = DEFAULT_PUBLIC_RELAYS;

export interface RelayProgramExercise {
  address: string;
  name?: string;
  muscleGroup?: string;
  imageUrl?: string;
  notes?: string;
  sets?: number;
  reps?: string;
  weight?: string;
  rest?: number;
  restSec?: number;
  setType?: string;
}

export interface RelayProgram {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  exercises: RelayProgramExercise[];
  sourceLabel: string;
  eventId: string;
  pubkey: string;
  address: string;
  createdAt: number;
}

export const EXERCISE_D_PREFIX = 'workstr:exercise:';
export const PROGRAM_D_PREFIX = 'workstr:program:';
const QUERY_TIMEOUT_MS = 7000;
const EXERCISE_LIMIT = 500;
const PROGRAM_LIMIT = 200;

function tagValue(tags: string[][], key: string): string {
  return (tags.find((tag) => tag[0] === key) || [])[1] || '';
}

function tagValues(tags: string[][], key: string): string[] {
  return tags.filter((tag) => tag[0] === key && tag.length >= 2).map((tag) => tag[1]);
}

function tagRows(tags: string[][], key: string): string[][] {
  return tags.filter((tag) => tag[0] === key);
}

function parseWorkstrMeta(tags: string[][]): Record<string, unknown> {
  const raw = tagValue(tags, 'workstr_meta');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hasWorkstrIdentity(tags: string[][]): boolean {
  return tagValues(tags, 't').some((value) => value.toLowerCase() === 'workstr') ||
    tagRows(tags, 'client').some((tag) => (tag[1] || '').toLowerCase() === 'workstr') ||
    Boolean(tagValue(tags, 'workstr_meta'));
}

function imetaUrl(tags: string[][]): string {
  for (const row of tagRows(tags, 'imeta')) {
    for (const part of row.slice(1)) {
      const match = String(part).match(/^url\s+(.+)$/i);
      if (match) return match[1].trim();
    }
  }
  return '';
}

function youtubeThumb(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.hostname.endsWith('youtube.com')) {
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v') || '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      const index = parts.findIndex((part) => ['embed', 'shorts', 'watch'].includes(part));
      return index >= 0 ? parts[index + 1] || '' : '';
    }
  } catch {
    return '';
  }
  return '';
}

function imageUrlFromTags(tags: string[][]): string {
  const url = imetaUrl(tags);
  const youtubeId = youtubeThumb(url);
  return youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : url;
}

function workstrMuscles(tags: string[][]): { muscles: string[]; primary: string } {
  const muscles: string[] = [];
  let primary = '';
  for (const row of tagRows(tags, 'workstr_muscle')) {
    const name = canonMuscle(row[1]) || row[1];
    if (name && !muscles.includes(name)) muscles.push(name);
    if (row[2] === 'primary') primary = name;
  }
  return { muscles, primary: primary || muscles[0] || '' };
}

function inferMuscles(tags: string[][], name: string): string[] {
  const words = [...tagValues(tags, 't'), name].map((value) => value.toLowerCase());
  const muscles: string[] = [];
  for (const word of words) {
    for (const part of word.split(/[^a-z0-9]+/)) {
      const muscle = canonMuscle(part);
      if (muscle && !muscles.includes(muscle)) muscles.push(muscle);
    }
  }
  return muscles;
}

function eventAddress(kind: number, event: Event, dTag: string): string {
  return `${kind}:${event.pubkey}:${dTag}`;
}

export function exerciseFromEvent(event: Event): Exercise | null {
  if (event.kind !== 33401) return null;
  const tags = event.tags as string[][];
  const dTag = tagValue(tags, 'd');
  const name = tagValue(tags, 'title');
  if (!dTag || !name) return null;
  if (!dTag.startsWith(EXERCISE_D_PREFIX)) return null;

  const meta = parseWorkstrMeta(tags);
  const exact = workstrMuscles(tags);
  const muscles = exact.muscles.length ? exact.muscles : inferMuscles(tags, name);
  const primary = exact.primary || muscles[0] || 'Core';
  const image = imageUrlFromTags(tags);
  const now = new Date((event.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString();

  return {
    slug: dTag.startsWith(EXERCISE_D_PREFIX) ? dTag.slice(EXERCISE_D_PREFIX.length) : slugify(name),
    name,
    description: String(meta.description || event.content || ''),
    category: String(meta.category || tagValues(tags, 't').find((tag) => tag !== 'workstr') || 'strength'),
    muscle_group: primary,
    muscles: muscles.length ? muscles : [primary],
    equipment: Array.isArray(meta.equipment) ? meta.equipment.map(String) : [tagValue(tags, 'equipment')].filter(Boolean),
    difficulty: String(meta.difficulty || tagValue(tags, 'difficulty') || ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : tagValues(tags, 't').filter((tag) => tag !== 'workstr'),
    instructions: Array.isArray(meta.instructions) ? meta.instructions.map(String) : String(event.content || '').split('\n').map((line) => line.trim()).filter(Boolean),
    image_url: image || undefined,
    favourite: false,
    default_sets: Number(meta.defaultSets) || 3,
    default_reps: typeof meta.defaultReps === 'number' ? meta.defaultReps : undefined,
    default_rest: Number(meta.defaultRest) || 90,
    source_type: 'imported',
    status: 'active',
    nostr_event_id: event.id,
    nostr_pubkey: event.pubkey,
    nostr_address: eventAddress(33401, event, dTag),
    nostr_published_at: now,
    origin_created_at: event.created_at,
    created_at: now,
    updated_at: now
  };
}

export function programFromEvent(event: Event): RelayProgram | null {
  if (event.kind !== 33402) return null;
  const tags = event.tags as string[][];
  const dTag = tagValue(tags, 'd');
  const name = tagValue(tags, 'title');
  if (!dTag || !name) return null;
  if (!dTag.startsWith(PROGRAM_D_PREFIX)) return null;
  const meta = parseWorkstrMeta(tags);
  const metaExercises = Array.isArray(meta.exercises) ? meta.exercises as Array<Record<string, unknown>> : [];
  const exerciseRows = tagRows(tags, 'exercise');
  const exercises = metaExercises.length
    ? metaExercises.map((item) => ({
      address: String(item.address || item.nostrAddress || ''),
      name: item.exerciseName == null && item.name == null ? undefined : String(item.exerciseName || item.name),
      muscleGroup: item.muscleGroup == null ? undefined : String(item.muscleGroup),
      imageUrl: item.imageUrl == null ? undefined : String(item.imageUrl),
      notes: item.notes == null ? undefined : String(item.notes),
      sets: Number(item.sets) || undefined,
      reps: item.reps == null ? undefined : String(item.reps),
      weight: item.weight == null ? undefined : String(item.weight),
      rest: Number(item.restSec || item.rest) || undefined,
      restSec: Number(item.restSec || item.rest) || undefined,
      setType: 'normal'
    })).filter((item) => item.address)
    : exerciseRows.map((row) => ({
      address: row[1] || '',
      name: row[2] || undefined,
      weight: row[3] || undefined,
      reps: row[4] || row[3] || undefined,
      rest: Number(row[5]) || undefined,
      restSec: Number(row[5]) || undefined,
      setType: row[row.length - 1] || undefined
    })).filter((item) => item.address);

  return {
    slug: dTag.startsWith(PROGRAM_D_PREFIX) ? dTag.slice(PROGRAM_D_PREFIX.length) : slugify(name),
    name,
    description: String(meta.description || event.content || ''),
    tags: tagValues(tags, 't').filter((tag) => tag !== 'workstr'),
    exercises,
    sourceLabel: hasWorkstrIdentity(tags) ? 'Workstr' : 'NIP-101e',
    eventId: event.id,
    pubkey: event.pubkey,
    address: eventAddress(33402, event, dTag),
    createdAt: event.created_at
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay query timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

// Keep only trusted canon events: operator-authored, valid signature, one
// event per full address (kind:pubkey:d) with the newest created_at winning —
// republishing the same d replaces the previous version.
export function selectCanonEvents(events: Event[], operator = OPERATOR_PUBKEY): Event[] {
  const byAddress = new Map<string, Event>();
  for (const event of events) {
    if (event.pubkey !== operator) continue;
    const dTag = tagValue(event.tags as string[][], 'd');
    if (!dTag) continue;
    const existing = byAddress.get(`${event.kind}:${event.pubkey}:${dTag}`);
    if (existing && existing.created_at >= event.created_at) continue;
    if (!verifyEvent(event)) continue;
    byAddress.set(`${event.kind}:${event.pubkey}:${dTag}`, event);
  }
  return [...byAddress.values()];
}

// Every canon relay is queried in parallel with its own timeout; partial
// failure is tolerated, but if no relay answered at all we throw so the UI
// can distinguish "offline" from "canon is empty".
async function queryCanon(kind: 33401 | 33402, limit: number): Promise<Event[]> {
  const pool = new SimplePool();
  try {
    const filter = { kinds: [kind], authors: [OPERATOR_PUBKEY], limit };
    const results = await Promise.allSettled(
      CANON_RELAYS.map((relay) => withTimeout(pool.querySync([relay], filter)))
    );
    if (results.every((result) => result.status === 'rejected')) {
      throw new Error('no canon relay reachable');
    }
    const merged = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return selectCanonEvents(merged);
  } finally {
    pool.close(CANON_RELAYS);
  }
}

function exercisesFrom(events: Event[]): Exercise[] {
  return events.map(exerciseFromEvent).filter((item): item is Exercise => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function programsFrom(events: Event[]): RelayProgram[] {
  return events.map(programFromEvent).filter((item): item is RelayProgram => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// In-memory copy of the verified canon events, refreshed per kind on each
// successful fetch. Snapshots of it are persisted in settings.canonCache so
// Discover opens instantly and works offline with the last known catalog.
let memory: { fetchedAt: number; events: Event[] } | null = null;

function rememberKind(kind: number, events: Event[]): void {
  const others = memory ? memory.events.filter((event) => event.kind !== kind) : [];
  memory = { fetchedAt: Date.now(), events: [...others, ...events] };
}

// Hydrate the in-memory canon from a persisted snapshot. Cached events were
// verified when fetched, so they are not re-verified here.
export function primeCanonCache(cache?: CanonCache): { exercises: Exercise[]; programs: RelayProgram[]; fetchedAt: number } | null {
  if (!cache?.events?.length) return null;
  if (!memory || cache.fetchedAt > memory.fetchedAt) memory = { fetchedAt: cache.fetchedAt, events: cache.events as Event[] };
  return { exercises: exercisesFrom(memory.events), programs: programsFrom(memory.events), fetchedAt: memory.fetchedAt };
}

export function canonCacheSnapshot(): CanonCache | null {
  return memory ? { fetchedAt: memory.fetchedAt, events: memory.events } : null;
}

export async function fetchCanonExercises(): Promise<Exercise[]> {
  const events = await queryCanon(33401, EXERCISE_LIMIT);
  rememberKind(33401, events);
  return exercisesFrom(events);
}

export async function fetchCanonPrograms(): Promise<RelayProgram[]> {
  const events = await queryCanon(33402, PROGRAM_LIMIT);
  rememberKind(33402, events);
  return programsFrom(events);
}
