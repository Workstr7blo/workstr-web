// Single source of truth for muscle taxonomy, shared by the browser (app.js)
// and the Node server (src/app/store.js). Keeping one copy stops the exercise
// filter and the recovery body map from drifting apart.

// The canonical regions the recovery body map renders, in display order.
export const CANONICAL_REGIONS = [
  'Back', 'Biceps', 'Calves', 'Chest', 'Core',
  'Glutes', 'Hamstrings', 'Quadriceps', 'Shoulders', 'Triceps'
] as const;

export type CanonicalRegion = (typeof CANONICAL_REGIONS)[number];

// Map any raw muscle name onto one of the canonical regions above.
export const MUSCLE_ALIASES: Record<string, CanonicalRegion> = {
  chest: 'Chest', pectorals: 'Chest', pecs: 'Chest', 'upper chest': 'Chest',
  back: 'Back', lats: 'Back', 'latissimus dorsi': 'Back', 'upper back': 'Back',
  'mid back': 'Back', 'middle back': 'Back', 'lower back': 'Back', lumbar: 'Back',
  'erector spinae': 'Back', traps: 'Back', trapezius: 'Back',
  shoulders: 'Shoulders', deltoids: 'Shoulders', deltoid: 'Shoulders', delts: 'Shoulders',
  biceps: 'Biceps', bicep: 'Biceps', brachialis: 'Biceps', forearms: 'Biceps', forearm: 'Biceps', arms: 'Biceps',
  triceps: 'Triceps', tricep: 'Triceps',
  core: 'Core', abs: 'Core', abdominals: 'Core', obliques: 'Core', 'full body': 'Core',
  quadriceps: 'Quadriceps', quads: 'Quadriceps', quad: 'Quadriceps', legs: 'Quadriceps',
  hamstrings: 'Hamstrings', hamstring: 'Hamstrings', hams: 'Hamstrings',
  glutes: 'Glutes', glute: 'Glutes', 'gluteus maximus': 'Glutes',
  calves: 'Calves', calf: 'Calves'
};

export function canonMuscle(name: unknown): CanonicalRegion | null {
  return MUSCLE_ALIASES[String(name || '').toLowerCase().trim()] || null;
}
