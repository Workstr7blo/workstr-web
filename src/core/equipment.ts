// Equipment taxonomy, deliberately thinner than muscles.ts. Muscle names arrive
// messy from imports and need an alias table; equipment comes from the Workstr
// catalog and is already consistent. What this does need is a stable key: a kit
// saved as "Dumbbell" must keep matching when an exercise later arrives as
// "Dumbbells " or "dumbbell", so matching runs on the normalized key while the
// UI shows the label as its publisher wrote it.

export const MY_EQUIPMENT = '@mine';

// Equipment that is not a thing you own. The catalog never publishes an empty
// equipment list: Workstr maps "body only" and "other" onto ["Body Weight"], so
// 18 of the 40 catalog exercises carry it. Treating those as a requirement made
// a kit of one dumbbell hide every push-up and plank, in both grids and Quick
// Workout. They are free, so a kit filter always lets them through.
export const FREE_EQUIPMENT_KEYS = new Set(['body weight', 'bodyweight', 'body only', 'none', 'no equipment']);

export function equipmentKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isFreeEquipment(value: unknown): boolean {
  return FREE_EQUIPMENT_KEYS.has(equipmentKey(value));
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

// The saved kit, normalized: deduped keys with the free ones dropped, since
// bodyweight is never something you own. Every reader of the kit goes through
// here so the Settings count, the "My equipment" option and the filter itself
// can never disagree about how big the kit is.
export function ownedEquipmentKeys(owned: string[] | undefined): string[] {
  const keys = new Set<string>();
  for (const item of owned || []) {
    const key = equipmentKey(item);
    if (key && !FREE_EQUIPMENT_KEYS.has(key)) keys.add(key);
  }
  return [...keys];
}

// What a saved kit can reach: the kit plus everything free. Empty when the kit
// is empty, which every caller reads as "do not filter on equipment at all".
export function kitEquipmentKeys(owned: string[] | undefined): Set<string> {
  const keys = new Set(ownedEquipmentKeys(owned));
  if (!keys.size) return keys;
  for (const key of FREE_EQUIPMENT_KEYS) keys.add(key);
  return keys;
}

// Fold the Settings checkboxes back into the stored kit. Only the options that
// were actually rendered can be judged unchecked; a key with no checkbox in the
// DOM (the catalog was still loading) is kept rather than silently dropped.
export function mergeOwnedEquipment(stored: string[] | undefined, rendered: string[], checked: string[]): string[] {
  const shown = new Set(rendered.map(equipmentKey));
  const kept = ownedEquipmentKeys(stored).filter((key) => !shown.has(key));
  return [...new Set([...kept, ...ownedEquipmentKeys(checked)])];
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
