import { describe, expect, it } from 'vitest';
import { beastModeChecklistMarkup, beastModeEligibility, beastModeLockedMarkup, beastModeSummary } from '../src/features/sheets/beast-mode';
import type { ActiveSession, AppState } from '../src/app/state';
import type { SheetWithExercises } from '../src/db/store';

function session(id: number, finishedAt: string): ActiveSession {
  return {
    id,
    sheetName: `Session ${id}`,
    startedAt: finishedAt,
    finishedAt,
    exercises: [],
    sets: []
  };
}

function sheet(partial: Partial<SheetWithExercises> = {}): SheetWithExercises {
  return {
    id: 1,
    slug: 'push-day',
    name: 'Push Day',
    notes: '',
    difficulty: '',
    tags: [],
    is_temporary: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    exercises: [],
    ...partial
  };
}

function state(partial: Partial<AppState> = {}): AppState {
  return {
    pubkey: null,
    npub: null,
    profileName: null,
    profilePicture: null,
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg' },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    monero: { status: 'idle', address: '' },
    signerType: null,
    view: 'settings',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
    programZapAttempts: [],
    activeSession: null,
    finishedSessions: [],
    publishingSessionId: null,
    publishingStatus: null,
    editingId: null,
    filter: '',
    programFilter: '',
    expandedProgramAddress: null,
    exerciseStatus: '',
    programStatus: '',
    signInStatus: null,
    backup: { state: 'off', pending: 0 },
    expandedSessionId: null,
    history: { monthKey: null, selectedDate: null },
    qw: { duration: 45, exercises: [], pool: {}, meta: '', visible: false },
    bodyEntries: [],
    sheets: [],
    library: [],
    librarySelect: { active: false, slugs: new Set() },
    discoverSelect: { active: false, addresses: new Set() },
    discoverExercises: [],
    exFilter: { cat: '', muscle: '', diff: '', equip: '' },
    discoverFilter: { q: '', cat: '', muscle: '', diff: '', equip: '' },
    ...partial
  } as AppState;
}

describe('beastModeEligibility', () => {
  it('returns the four objective checks and keeps locked users locked', () => {
    const eligibility = beastModeEligibility(state({
      sheets: [sheet()],
      finishedSessions: [
        session(1, '2026-08-01T10:00:00'),
        session(2, '2026-08-01T12:00:00'),
        session(3, '2026-08-02T10:00:00'),
        session(4, '2026-08-03T10:00:00')
      ],
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.com/avatar.png'
    }));

    expect(eligibility.unlocked).toBe(false);
    expect(eligibility.completedWorkoutCount).toBe(4);
    expect(eligibility.distinctWorkoutDayCount).toBe(3);
    expect(eligibility.checks.map((check) => [check.id, check.passed])).toEqual([
      ['local-program', true],
      ['completed-workouts', false],
      ['local-days', true],
      ['profile-picture', true]
    ]);
  });

  it('unlocks from local programs, workout history local days, and signed-in profile picture only', () => {
    const eligibility = beastModeEligibility(state({
      sheets: [sheet()],
      finishedSessions: [
        session(1, '2026-08-01T10:00:00'),
        session(2, '2026-08-01T12:00:00'),
        session(3, '2026-08-02T10:00:00'),
        session(4, '2026-08-03T10:00:00'),
        session(5, '2026-08-03T12:00:00')
      ],
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.com/avatar.png'
    }));

    expect(eligibility.unlocked).toBe(true);
  });

  it('does not count a profile picture unless a user is signed in', () => {
    const eligibility = beastModeEligibility(state({ profilePicture: 'https://example.com/avatar.png' }));

    expect(eligibility.checks.find((check) => check.id === 'profile-picture')?.passed).toBe(false);
  });
});

describe('Beast Mode checklist markup', () => {
  it('derives compact lock and objective summaries from the same checks as publishing', () => {
    expect(beastModeSummary(state({ sheets: [sheet()] }))).toEqual({ label: 'LOCKED', progress: '1/4 objectives', unlocked: false });
    expect(beastModeSummary(state({
      sheets: [sheet()],
      finishedSessions: [session(1, '2026-08-01T10:00:00'), session(2, '2026-08-01T12:00:00'), session(3, '2026-08-02T10:00:00'), session(4, '2026-08-03T10:00:00'), session(5, '2026-08-03T12:00:00')],
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.com/avatar.png'
    }))).toEqual({ label: 'UNLOCKED', progress: '4/4 objectives', unlocked: true });
  });

  it('renders locked checklist details for publish gating', () => {
    const markup = beastModeLockedMarkup(state({ sheets: [sheet()] }), 'Push Day');

    expect(markup).toContain('Publish Push Day');
    expect(markup).toContain('Beast Mode is locked');
    expect(markup).toContain('data-beast-mode-state="locked"');
    expect(markup).toContain('data-beast-mode-check="local-program"');
    expect(markup).toContain('data-beast-mode-check="completed-workouts"');
    expect(markup).toContain('data-beast-mode-check="local-days"');
    expect(markup).toContain('data-beast-mode-check="profile-picture"');
  });

  it('marks the checklist unlocked when every objective check passes', () => {
    const markup = beastModeChecklistMarkup(state({
      sheets: [sheet()],
      finishedSessions: [
        session(1, '2026-08-01T10:00:00'),
        session(2, '2026-08-01T12:00:00'),
        session(3, '2026-08-02T10:00:00'),
        session(4, '2026-08-03T10:00:00'),
        session(5, '2026-08-03T12:00:00')
      ],
      pubkey: 'f'.repeat(64),
      profilePicture: 'https://example.com/avatar.png'
    }));

    expect(markup).toContain('data-beast-mode-state="unlocked"');
  });
});
