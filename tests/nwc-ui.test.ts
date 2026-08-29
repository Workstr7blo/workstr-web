import { describe, expect, it } from 'vitest';
import { shellMarkup } from '../src/app/layout';
import { supportPanel } from '../src/features/support/views';
import type { AppState } from '../src/app/state';

const SECRET = 'b'.repeat(64);

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    pubkey: null,
    npub: null,
    profileName: null,
    profilePicture: null,
    profileNames: {},
    authorProfiles: {},
    store: null,
    settings: { unit: 'kg', publicRelays: [] },
    support: { status: 'idle', receipts: [] },
    nwc: { active: false, status: 'idle' },
    signerType: null,
    view: 'settings',
    subState: { exercises: 'library', workouts: 'programs', statistics: 'training' },
    exercises: [],
    programs: [],
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
    ...overrides
  } as AppState;
}

describe('NWC support UI', () => {
  it('renders a Settings wallet connection row without exposing secrets', () => {
    const markup = shellMarkup(state({
      nwc: {
        active: true,
        status: 'idle',
        walletLabel: 'nostr+walletconnect://aaaaaaaa…?relay=relay.example.com',
        relayLabel: 'relay.example.com',
        message: `Wallet connected. secret=${SECRET}`
      }
    }));

    expect(markup).toContain('Zap wallet (NWC)');
    expect(markup).toContain('Replace wallet');
    expect(markup).toContain('Disconnect');
    expect(markup).not.toContain(SECRET);
    expect(markup).toContain('[REDACTED]');
  });

  it('enables in-app zaps only when signed in with an active NWC wallet', () => {
    const inactive = supportPanel({ status: 'idle', receipts: [] }, { active: false, status: 'idle' }, true);
    expect(inactive).toContain('id="open-nwc-zap" class="button primary" disabled');
    expect(inactive).toContain('Connect a zap wallet in Settings');

    const active = supportPanel({ status: 'idle', receipts: [] }, { active: true, status: 'idle', walletLabel: 'Alby', relayLabel: 'relay.example.com' }, true);
    expect(active).toContain('id="open-nwc-zap" class="button primary" >Zap with wallet</button>');
    expect(active).toContain('NWC wallet ready');
    expect(active).toContain('Alby · relay.example.com');
  });
});
