import { describe, expect, it } from 'vitest';
import { isFreeEquipment, kitEquipmentKeys, mergeOwnedEquipment, ownedEquipmentKeys } from '../src/core/equipment';

describe('ownedEquipmentKeys', () => {
  it('normalizes, dedupes and drops what nobody owns', () => {
    expect(ownedEquipmentKeys(['Dumbbell', '  dumbbell ', 'Body Weight', '', 'Barbell']))
      .toEqual(['dumbbell', 'barbell']);
  });

  it('reads a bodyweight-only kit as no kit at all', () => {
    expect(ownedEquipmentKeys(['Body Weight', 'none'])).toEqual([]);
    expect(ownedEquipmentKeys(undefined)).toEqual([]);
  });
});

describe('kitEquipmentKeys', () => {
  it('adds the free keys so bodyweight work always qualifies', () => {
    const keys = kitEquipmentKeys(['Dumbbell']);
    expect(keys.has('dumbbell')).toBe(true);
    expect(keys.has('body weight')).toBe(true);
  });

  it('stays empty for an empty kit, which means do not filter', () => {
    expect(kitEquipmentKeys([]).size).toBe(0);
    expect(kitEquipmentKeys(['Body Weight']).size).toBe(0);
  });
});

describe('isFreeEquipment', () => {
  it('covers the spellings the catalog and hand-added rows use', () => {
    for (const value of ['Body Weight', 'bodyweight', 'body only', 'None', 'no equipment']) {
      expect(isFreeEquipment(value)).toBe(true);
    }
    expect(isFreeEquipment('Dumbbell')).toBe(false);
  });
});

describe('mergeOwnedEquipment', () => {
  it('applies the ticks for options that were on screen', () => {
    expect(mergeOwnedEquipment(['dumbbell', 'barbell'], ['dumbbell', 'barbell'], ['dumbbell']))
      .toEqual(['dumbbell']);
  });

  // The checkbox list is built from the loaded catalog. Saving from a partial
  // one must not read "absent" as "unticked" and wipe the rest of the kit.
  it('keeps saved equipment that had no checkbox rendered', () => {
    expect(mergeOwnedEquipment(['dumbbell', 'kettlebell'], ['dumbbell'], ['dumbbell']).sort())
      .toEqual(['dumbbell', 'kettlebell']);
    expect(mergeOwnedEquipment(['dumbbell', 'kettlebell'], ['dumbbell'], []))
      .toEqual(['kettlebell']);
  });

  it('empties the kit when every rendered option is unticked', () => {
    expect(mergeOwnedEquipment(['dumbbell'], ['dumbbell', 'barbell'], [])).toEqual([]);
  });

  it('normalizes on the way in and never stores a free key', () => {
    expect(mergeOwnedEquipment([], ['Dumbbell'], ['Dumbbell', 'Body Weight'])).toEqual(['dumbbell']);
  });
});
