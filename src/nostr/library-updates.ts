import type { Exercise } from '../core/types';

// The library is a copy of the catalog: Workstr Web never edits an exercise, so a library row
// that came from the catalog simply follows it. A row is matched to its catalog exercise by full
// address only - a row without one may be someone's own copy, and a slug is not proof it is the
// same exercise. Only a newer catalog version replaces a row, and the favourite star, status,
// id, created date and source marker stay the user's.
export function planLibraryCatalogUpdates(library: Exercise[], catalog: Exercise[]): Exercise[] {
  const byAddress = new Map(catalog.filter((exercise) => exercise.nostr_address).map((exercise) => [exercise.nostr_address!, exercise]));
  const updates: Exercise[] = [];
  for (const local of library) {
    const remote = local.nostr_address ? byAddress.get(local.nostr_address) : undefined;
    if (!remote || (remote.origin_created_at || 0) <= (local.origin_created_at || 0)) continue;
    updates.push({
      ...remote,
      id: local.id,
      slug: local.slug,
      favourite: local.favourite,
      status: local.status,
      source_type: local.source_type,
      created_at: local.created_at
    });
  }
  return updates;
}
