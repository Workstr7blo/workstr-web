import { describe, expect, it } from 'vitest';
import { shellMarkup } from '../src/app/layout';
import { programCard } from '../src/features/sheets/views';
import { supportPanel } from '../src/features/support/views';
import type { AppState } from '../src/app/state';
import type { RelayProgram } from '../src/nostr/canon';

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
    expect(inactive).toContain('id="open-nwc-zap" class="button payment" disabled');
    expect(inactive).toContain('Connect a zap wallet in Settings');

    const active = supportPanel({ status: 'idle', receipts: [] }, { active: true, status: 'idle', walletLabel: 'Alby', relayLabel: 'relay.example.com' }, true);
    expect(active).toContain('id="open-nwc-zap" class="button payment" >Zap with wallet</button>');
    expect(active).toContain('NWC wallet ready');
    expect(active).toContain('Alby · relay.example.com');
  });

  it('replaces the Settings wallet card with the Monero address layout in Monero Mode', () => {
    const wallet = { active: true, status: 'idle' as const, walletLabel: 'Alby', relayLabel: 'relay.example.com' };
    const lightning = shellMarkup(state({ nwc: wallet, settings: { unit: 'kg', paymentMode: 'lightning', publicRelays: [] } }));
    expect(lightning).toContain('nwc-card');
    expect(lightning).toContain('Zap wallet (NWC)');
    expect(lightning).not.toContain('Monero payment address');

    const monero = shellMarkup(state({ nwc: wallet, settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } }));
    expect(monero).not.toContain('nwc-card');
    expect(monero).not.toContain('Zap wallet (NWC)');
    expect(monero).not.toContain('id="nwc-connect"');
    expect(monero).not.toContain('id="nwc-disconnect"');
    expect(monero).not.toContain('Replace wallet');
    expect(monero).toContain('Monero payment address');
    expect(monero).toContain('Sign in with your Nostr signer');

    const signedIn = shellMarkup(state({ pubkey: 'a'.repeat(64), nwc: wallet, settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] } }));
    expect(signedIn).toContain('id="monero-address"');
    expect(signedIn).toContain('id="monero-address-save"');
    expect(signedIn).toContain('id="monero-address-refresh"');
    expect(signedIn).not.toContain('nwc-card');
  });

  it('withdraws the in-app zap controls from Support in Monero Mode without hiding the funding facts', () => {
    const panel = supportPanel({ status: 'idle', receipts: [] }, { active: true, status: 'idle', walletLabel: 'Alby' }, true, true);

    expect(panel).not.toContain('open-nwc-zap');
    expect(panel).not.toContain('Zap with wallet');
    expect(panel).not.toContain('Connect a zap wallet');
    expect(panel).toContain('Creator support is on Monero.');
    // The operator's own zap target is a published NIP-57 fact, not an NWC control.
    expect(panel).toContain('External zap');
    expect(panel).toContain('Copy npub');
  });
});

describe('NWC workout-program zap UI', () => {
  const program: RelayProgram = {
    slug: 'push-day',
    name: 'Push Day',
    description: '',
    difficulty: 'intermediate',
    tags: ['strength'],
    exercises: [],
    sourceLabel: 'Workstr',
    eventId: 'e'.repeat(64),
    pubkey: 'f'.repeat(64),
    address: `33402:${'f'.repeat(64)}:workstr:program:push-day`,
    createdAt: 1
  };

  it('exposes a creator zap action on published program cards even before a wallet is connected', () => {
    const card = programCard(program, state({ expandedProgramAddress: program.address, nwc: { active: false, status: 'idle' } }));

    expect(card).toContain('program-zap-icon');
    expect(card).toContain('program-zap-label');
    expect(card).toContain('>Zap</span>');
    expect(card).toContain(`data-zap-program="${program.address}"`);
  });

  it('shows program zaps only in the workouts Discover tab', () => {
    const importedSheet = {
      id: 7,
      slug: 'push-day',
      name: 'Push Day',
      notes: '',
      difficulty: 'intermediate',
      tags: ['strength'],
      is_temporary: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      nostr_address: program.address,
      nostr_pubkey: program.pubkey,
      exercises: []
    };

    const programsTab = shellMarkup(state({ view: 'workouts', subState: { exercises: 'library', workouts: 'programs', statistics: 'training' }, sheets: [importedSheet] }));
    expect(programsTab).not.toContain('program-zap-cta');
    expect(programsTab).not.toContain(`data-zap-program=\"local:${importedSheet.id}\"`);

    const discoverTab = shellMarkup(state({ view: 'workouts', subState: { exercises: 'library', workouts: 'discover', statistics: 'training' }, programs: [program] }));
    expect(discoverTab).toContain('program-zap-cta');
    expect(discoverTab).toContain(`data-zap-program=\"${program.address}\"`);
    expect(discoverTab).toContain('0 sats');
    // The bolt is a vendored path, never the U+26A1 emoji a platform repaints for itself.
    expect(discoverTab).toContain('<svg class="program-zap-icon"');
    expect(discoverTab).not.toContain('⚡');
  });

  it('highlights the top three discover programs by visible zap sats', () => {
    const programs = [1, 2, 3, 4].map((index) => ({
      ...program,
      slug: `program-${index}`,
      name: `Program ${index}`,
      address: `33402:${program.pubkey}:workstr:program:${index}`
    }));
    const markup = shellMarkup(state({
      view: 'workouts',
      subState: { exercises: 'library', workouts: 'discover', statistics: 'training' },
      programs,
      programZapTotals: {
        [programs[0].address]: { sats: 500, count: 1 },
        [programs[1].address]: { sats: 2000, count: 1 },
        [programs[2].address]: { sats: 1000, count: 1 },
        [programs[3].address]: { sats: 21, count: 1 }
      }
    }));

    expect(markup).toContain('2,000 sats');
    expect(markup).toContain('<div class="workout-card-media">\n        <div class="program-zap-rank">#1 top zapped</div>');
    expect(markup).toContain('workout-card-author');
    expect(markup).toContain('rank-1');
    expect(markup).toContain('#1 top zapped');
    expect(markup).toContain('rank-2');
    expect(markup).toContain('#2 top zapped');
    expect(markup).toContain('rank-3');
    expect(markup).toContain('#3 top zapped');
    expect(markup).not.toContain('rank-4');
  });

  it('shows the latest persisted program zap result in the expanded program body', () => {
    const card = programCard(program, state({
      expandedProgramAddress: program.address,
      programZapAttempts: [{
        id: 'zap-1',
        status: 'succeeded',
        programAddress: program.address,
        programName: 'Push Day',
        amountSats: 21,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:01Z'
      }]
    }));

    expect(card).toContain('Creator zap');
    expect(card).toContain('Zap sent · 21 sats');
  });
});
