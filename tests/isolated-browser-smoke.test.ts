// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { SheetWithExercises } from '../src/db/store';
import { createIsolatedBrowserSmokeBoundary, renderIsolatedBrowserSmoke } from '../src/app/isolated-browser-smoke';

const { realPublisher } = vi.hoisted(() => ({ realPublisher: vi.fn() }));

vi.mock('../src/nostr/program-publish', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/nostr/program-publish')>(),
  publishCreatorProgram: realPublisher
}));

function sheet(): SheetWithExercises {
  return {
    id: 7,
    slug: 'smoke-push-day',
    name: 'Smoke Push Day',
    notes: '',
    difficulty: 'Beast Mode',
    tags: [],
    is_temporary: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    exercises: []
  };
}

describe('isolated browser smoke composition', () => {
  it('fails closed when a publisher receives a non-isolated relay list', async () => {
    const boundary = createIsolatedBrowserSmokeBoundary();
    const signer = await boundary.getSigner();
    if (!signer) throw new Error('isolated smoke boundary did not provide a signer');
    await expect(boundary.publishCreatorProgram(signer, sheet(), ['wss://nos.lol'], {}))
      .rejects.toThrow('rejected an unisolated publish');
  });

  it('uses its mock signer and publisher instead of the real public publisher', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const shell = renderIsolatedBrowserSmoke(document.getElementById('app') as HTMLElement);
    await shell.ready;
    shell.state.settings.publicRelays = ['wss://relay.damus.io', 'wss://nos.lol'];
    shell.state.pubkey = 'f'.repeat(64);
    shell.state.profilePicture = 'https://example.test/avatar.png';
    shell.state.sheets = [sheet()];
    shell.state.finishedSessions = [
      { id: 1, sheetName: 'A', startedAt: '2026-08-01T10:00:00Z', finishedAt: '2026-08-01T10:30:00Z', exercises: [], sets: [] },
      { id: 2, sheetName: 'B', startedAt: '2026-08-01T11:00:00Z', finishedAt: '2026-08-01T11:30:00Z', exercises: [], sets: [] },
      { id: 3, sheetName: 'C', startedAt: '2026-08-02T10:00:00Z', finishedAt: '2026-08-02T10:30:00Z', exercises: [], sets: [] },
      { id: 4, sheetName: 'D', startedAt: '2026-08-03T10:00:00Z', finishedAt: '2026-08-03T10:30:00Z', exercises: [], sets: [] },
      { id: 5, sheetName: 'E', startedAt: '2026-08-03T11:00:00Z', finishedAt: '2026-08-03T11:30:00Z', exercises: [], sets: [] }
    ];

    await shell.publishProgram('local:7');

    expect(realPublisher).not.toHaveBeenCalled();
    expect(shell.state.sheets[0]?.nostr_event_id).toBe('b'.repeat(64));
  });
});