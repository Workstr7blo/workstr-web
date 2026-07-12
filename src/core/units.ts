export function kgToLb(kg: number): number {
  return kg * 2.2046226218;
}

export function lbToKg(lb: number): number {
  return lb / 2.2046226218;
}

export function roundWeight(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export function epleyOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export function brzyckiOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (36 / (37 - Math.min(reps, 36)));
}
