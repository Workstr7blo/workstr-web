// Equipment taxonomy, deliberately thinner than muscles.ts. Muscle names arrive
// messy from imports and need an alias table; equipment comes from the Workstr
// catalog and is already consistent. What this does need is a stable key: a kit
// saved as "Dumbbell" must keep matching when an exercise later arrives as
// "Dumbbells " or "dumbbell", so matching runs on the normalized key while the
// UI shows the label as its publisher wrote it.

export const MY_EQUIPMENT = '@mine';

export function equipmentKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function equipmentLabel(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Normalized keys for one exercise. An exercise with no equipment returns an
// empty set, which every equipment filter treats as "needs nothing" — never as
// "matches nothing", or hand-added rows would vanish with no visible reason.
export function exerciseEquipmentKeys(equipment: string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const item of equipment || []) {
    const key = equipmentKey(item);
    if (key) set.add(key);
  }
  return set;
}

// True when an exercise is doable with the given kit. No kit means no filtering;
// no equipment on the exercise means it needs none, so it always passes.
export function matchesEquipment(equipment: string[] | undefined, allowedKeys: Set<string>): boolean {
  if (!allowedKeys.size) return true;
  const keys = exerciseEquipmentKeys(equipment);
  if (!keys.size) return true;
  for (const key of keys) if (allowedKeys.has(key)) return true;
  return false;
}

// Distinct equipment across a list, as {key, label} sorted by label. The first
// label seen for a key wins, so the option shows one spelling as its publisher
// wrote it even when the catalog carries two.
export function equipmentOptions(lists: (string[] | undefined)[]): { key: string; label: string }[] {
  const labels = new Map<string, string>();
  for (const list of lists) {
    for (const item of list || []) {
      const key = equipmentKey(item);
      const label = equipmentLabel(item);
      if (!key || !label || labels.has(key)) continue;
      labels.set(key, label);
    }
  }
  return [...labels.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
