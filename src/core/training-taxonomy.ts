// The vocabulary exercises and programs share. Stored and published values stay as they
// arrived - an exercise saved as `stretching` is never rewritten - and are folded onto these
// keys only to filter and display, so relay data and backups round-trip untouched.
//
// Level is one concept for both an exercise and a program. Movement type is an exercise
// property only: a program's Goal is chosen explicitly and never inferred from the movement
// types of the exercises in it. Equipment lives beside this in `core/equipment.ts`.

export const TRAINING_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const MOVEMENT_TYPES = ['strength', 'cardio', 'mobility'] as const;

const LEVEL_ALIASES: Record<string, string> = { novice: 'beginner', expert: 'advanced' };
// `stretching` is what the catalog published before Mobility was the name.
const MOVEMENT_ALIASES: Record<string, string> = { stretching: 'mobility', stretch: 'mobility', flexibility: 'mobility' };
const ACRONYMS: Record<string, string> = { emom: 'EMOM' };

function taxonomyKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Unknown values come back as their normalized key rather than empty, so a third-party
// level or category is still a filter option instead of vanishing.
export function normalizeTrainingLevel(value: unknown): string {
  const key = taxonomyKey(value);
  return LEVEL_ALIASES[key] || key;
}

export function normalizeMovementType(value: unknown): string {
  const key = taxonomyKey(value);
  return MOVEMENT_ALIASES[key] || key;
}

// `full-body` and `body weight` read as Full Body and Body Weight; storage stays lowercase.
export function formatTaxonomyLabel(value: unknown): string {
  return String(value ?? '').trim().split(/[-\s]+/).filter(Boolean)
    .map((part) => ACRONYMS[part.toLowerCase()] || part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

// Options in the canonical order, then anything unrecognised alphabetically.
export function taxonomyOptions(values: Iterable<string>, canonical: readonly string[]): string[] {
  const present = new Set([...values].filter(Boolean));
  const known = canonical.filter((value) => present.has(value));
  const other = [...present].filter((value) => !canonical.includes(value)).sort((a, b) => a.localeCompare(b));
  return [...known, ...other];
}
