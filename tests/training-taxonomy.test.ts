import { describe, expect, it } from 'vitest';
import { formatTaxonomyLabel, MOVEMENT_TYPES, normalizeMovementType, normalizeTrainingLevel, taxonomyOptions, TRAINING_LEVELS } from '../src/core/training-taxonomy';

describe('normalizeMovementType', () => {
  it('folds the stored spellings onto Strength, Cardio and Mobility', () => {
    expect(['strength', 'Cardio', ' stretching ', 'mobility'].map(normalizeMovementType)).toEqual(['strength', 'cardio', 'mobility', 'mobility']);
  });

  it('keeps an unknown third-party category rather than dropping it', () => {
    expect(normalizeMovementType('Olympic Weightlifting')).toBe('olympic weightlifting');
    expect(normalizeMovementType(undefined)).toBe('');
  });
});

describe('normalizeTrainingLevel', () => {
  it('reads Beginner, beginner and novice as one level', () => {
    expect(['Beginner', 'beginner ', 'novice'].map(normalizeTrainingLevel)).toEqual(['beginner', 'beginner', 'beginner']);
    expect(normalizeTrainingLevel('Expert')).toBe('advanced');
  });

  it('keeps an unrecognised level as its own value', () => {
    expect(normalizeTrainingLevel('Beast Mode')).toBe('beast mode');
  });
});

describe('formatTaxonomyLabel', () => {
  it('writes storage slugs the way the filter sheets show them', () => {
    expect(['strength', 'full-body', 'body weight', 'bodyweight', 'emom', 'minimal-equipment'].map(formatTaxonomyLabel))
      .toEqual(['Strength', 'Full Body', 'Body Weight', 'Bodyweight', 'EMOM', 'Minimal Equipment']);
  });
});

describe('taxonomyOptions', () => {
  it('orders canonical values first, then unknown values alphabetically', () => {
    expect(taxonomyOptions(['mobility', 'yoga', 'strength', 'mobility', 'balance'], MOVEMENT_TYPES)).toEqual(['strength', 'mobility', 'balance', 'yoga']);
    expect(taxonomyOptions(['advanced', 'beginner'], TRAINING_LEVELS)).toEqual(['beginner', 'advanced']);
  });
});
