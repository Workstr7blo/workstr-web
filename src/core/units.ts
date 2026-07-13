export type WeightUnit = 'kg' | 'lbs';

const KG_TO_LB = 2.20462;

export function normalizeWeightUnit(value: unknown): WeightUnit {
  return value === 'lbs' || value === 'lb' ? 'lbs' : 'kg';
}

export function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}

export function lbToKg(lb: number): number {
  return lb / KG_TO_LB;
}

export function roundWeight(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export function displayWeightKg(kg: number | string | null | undefined, unit: WeightUnit): number | null {
  if (kg == null || kg === '' || !Number.isFinite(Number(kg))) return null;
  const value = unit === 'lbs' ? Number(kg) * KG_TO_LB : Number(kg);
  return Math.round(value * 10) / 10;
}

export function storeWeightInput(value: number | string | null | undefined, unit: WeightUnit): number | null {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const kg = unit === 'lbs' ? Number(value) / KG_TO_LB : Number(value);
  return Math.round(kg * 10) / 10;
}

export function formatWeightKg(kg: number | string | null | undefined, unit: WeightUnit): string {
  const value = displayWeightKg(kg, unit);
  return value == null ? '' : `${value}${unit}`;
}

export function epleyOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export function brzyckiOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (36 / (37 - Math.min(reps, 36)));
}
