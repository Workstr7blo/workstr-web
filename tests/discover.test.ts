import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/core/types';
import { discoverImportState } from '../src/features/discover/views';

const base: Omit<Exercise, 'slug'> = {
  name: 'Bench Press',
  muscles: ['Chest'],
  equipment: [],
  tags: [],
  instructions: [],
  favourite: false,
  source_type: 'imported',
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const remote = (slug: string, address: string, originCreatedAt: number): Exercise =>
  ({ ...base, slug, nostr_address: address, origin_created_at: originCreatedAt });

const local = (slug: string, address?: string, originCreatedAt?: number): Exercise =>
  ({ ...base, slug, nostr_address: address, origin_created_at: originCreatedAt });

describe('discoverImportState', () => {
  it('is new when nothing local matches', () => {
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 100), [])).toBe('new');
  });

  it('is in-library when the same address exists at the same version', () => {
    const library = [local('bench', '33401:op:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 100), library)).toBe('in-library');
  });

  it('is update when the remote created_at is newer on the same address', () => {
    const library = [local('bench', '33401:op:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('update');
  });

  it('is in-library (not update) when the local row was forked by editing', () => {
    // Editing cleared the nostr address; the slug still collides, so no
    // update is offered — canon updates never clobber local edits.
    const library = [local('bench', undefined, undefined)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('in-library');
  });

  it('matches by full address, not by slug alone', () => {
    const library = [local('bench', '33401:someone-else:workstr:exercise:bench', 100)];
    expect(discoverImportState(remote('bench', '33401:op:workstr:exercise:bench', 200), library)).toBe('in-library');
  });
});
