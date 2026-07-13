import { describe, expect, it } from 'vitest';
import { exerciseAddress, slugify } from '../src/core/ids';
import { displayWeightKg, epleyOneRepMax, formatWeightKg, kgToLb, lbToKg, normalizeWeightUnit, storeWeightInput } from '../src/core/units';
import { canonMuscle } from '../src/core/muscles';

describe('core ids', () => {
  it('slugifies names consistently', () => {
    expect(slugify('Incline Dumbbell Press')).toBe('incline-dumbbell-press');
  });

  it('builds private record addresses', () => {
    expect(exerciseAddress('push-up')).toBe('workstr:v1:exercise:push-up');
  });
});

describe('core units', () => {
  it('round-trips kg and lb', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 8);
  });

  it('uses self-hosted unit names and canonical kg storage', () => {
    expect(normalizeWeightUnit('lb')).toBe('lbs');
    expect(normalizeWeightUnit('lbs')).toBe('lbs');
    expect(displayWeightKg(6.8, 'lbs')).toBe(15);
    expect(storeWeightInput(15, 'lbs')).toBe(6.8);
    expect(formatWeightKg(6.8, 'lbs')).toBe('15lbs');
    expect(formatWeightKg(6.8, 'kg')).toBe('6.8kg');
  });

  it('calculates epley estimated one-rep max', () => {
    expect(epleyOneRepMax(100, 5)).toBeCloseTo(116.666, 2);
  });
});

describe('muscle taxonomy', () => {
  it('maps aliases to canonical regions', () => {
    expect(canonMuscle('pecs')).toBe('Chest');
    expect(canonMuscle('quads')).toBe('Quadriceps');
  });
});
