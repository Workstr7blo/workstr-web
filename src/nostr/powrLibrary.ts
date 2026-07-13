import type { Event } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';
import { canonMuscle } from '../core/muscles';
import { slugify } from '../core/ids';
import type { Exercise } from '../core/types';

export const WORKSTR_LIBRARY_RELAY = 'wss://nos.lol';
export const WORKSTR_LIBRARY_RELAYS = [WORKSTR_LIBRARY_RELAY];

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

const EXERCISE_D_PREFIX = 'workstr:exercise:';
const PROGRAM_D_PREFIX = 'workstr:program:';
const QUERY_TIMEOUT_MS = 7000;
const LIBRARY_LIMIT = 200;

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

async function queryKind(kind: 33401 | 33402): Promise<Event[]> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(WORKSTR_LIBRARY_RELAYS, { kinds: [kind], limit: LIBRARY_LIMIT });
    return events.sort((a, b) => b.created_at - a.created_at);
  } finally {
    pool.close(WORKSTR_LIBRARY_RELAYS);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`relay query timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

export async function fetchRelayExercises(): Promise<Exercise[]> {
  const events = await withTimeout(queryKind(33401));
  const byAddress = new Map<string, Exercise>();
  for (const event of events) {
    const exercise = exerciseFromEvent(event);
    if (exercise?.nostr_address && !byAddress.has(exercise.nostr_address)) byAddress.set(exercise.nostr_address, exercise);
  }
  return [...byAddress.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRelayPrograms(): Promise<RelayProgram[]> {
  const events = await withTimeout(queryKind(33402));
  const byAddress = new Map<string, RelayProgram>();
  for (const event of events) {
    const program = programFromEvent(event);
    if (program && !byAddress.has(program.address)) byAddress.set(program.address, program);
  }
  return [...byAddress.values()].sort((a, b) => a.name.localeCompare(b.name));
}
