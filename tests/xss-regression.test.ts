// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { authorPill, exerciseImage } from '../src/app/format';
import { accountChip, accountIdentity } from '../src/app/account-chip';
import { settingsView } from '../src/app/settings-view';
import { profileCard } from '../src/app/profile-view';
import { exerciseCard } from '../src/app/exercise-card';
import { programCard } from '../src/features/sheets/views';
import { tipJarActivityCard } from '../src/features/monero/tip-jar-history-view';
import { moneroSendBody } from '../src/features/monero/send-view';
import { tipJarView } from '../src/features/monero/tip-jar-view';
import { backupPanel } from '../src/features/backup/views';
import type { AppState } from '../src/app/state';
import type { Exercise } from '../src/core/types';
import type { RelayProgram } from '../src/nostr/canon';
import type { MoneroSendState, TipJarOutgoingRecord } from '../src/features/monero/types';

// Everything a stranger can put on a relay, or into a JSON file someone imports, eventually
// reaches a template string. At-rest encryption does not help once script runs on the Workstr
// origin, so each surface fed by external text is rendered here with values built to break
// out of an element, an attribute, or an inline script, and must come back as inert text.
const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '"><script>alert(1)</script>',
  "'\"><img src=x onerror=alert(1)>",
  'javascript:alert(1)'
];

const CREATOR = 'cd'.repeat(32);
const ACCOUNT = 'ab'.repeat(32);

// Parsed as a browser would, then searched for anything that could run.
function inert(markup: string): void {
  const host = document.createElement('div');
  host.innerHTML = markup;
  expect(host.querySelector('script'), 'a <script> element').toBeNull();
  expect(host.querySelector('img[src="x"]'), 'an injected <img>').toBeNull();
  for (const element of Array.from(host.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name.startsWith('on'), `${element.tagName} carries ${attribute.name}`).toBe(false);
      if (['src', 'href', 'action', 'formaction'].includes(attribute.name)) {
        expect(attribute.value.trim().toLowerCase().startsWith('javascript:'), `${element.tagName} ${attribute.name}=${attribute.value}`).toBe(false);
      }
    }
  }
}

function state(payload: string, over: Partial<AppState> = {}): AppState {
  return {
    pubkey: ACCOUNT, npub: null, profileName: payload, profilePicture: `https://x.example/${payload}`,
    profileNames: { [CREATOR]: payload },
    authorProfiles: { [CREATOR]: { pubkey: CREATOR, name: payload, picture: `https://x.example/${payload}`, nip05: payload } },
    store: null,
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [payload], workstrRelay: payload },
    monero: { status: 'error', address: payload, message: payload, messageKind: 'bad' },
    profile: { status: 'error', editing: false, message: payload, messageKind: 'bad' },
    moneroWallet: { status: 'error', stored: true, message: payload, messageKind: 'bad', snapshot: null },
    library: [], exercises: [], discoverExercises: [], finishedSessions: [], sheets: [], programs: [],
    backup: { state: 'error', pending: 1, lastError: payload },
    deviceVault: 'unlocked',
    signInStatus: payload,
    ...over
  } as unknown as AppState;
}

function exercise(payload: string): Exercise {
  return {
    slug: 'x', name: payload, description: payload, muscle_group: payload, category: payload, difficulty: payload,
    equipment: [payload], tags: [payload], instructions: [payload], image_url: `https://x.example/${payload}`
  } as unknown as Exercise;
}

function program(payload: string): RelayProgram {
  return {
    slug: 'p', name: payload, description: payload, difficulty: payload, tags: [payload], goals: [payload],
    exercises: [{ slug: 'x', name: payload, sets: 3, reps: payload, rest: 60 }],
    sourceLabel: payload, eventId: 'e'.repeat(64), pubkey: CREATOR,
    address: `33402:${CREATOR}:workstr:program:p`, createdAt: 1
  } as unknown as RelayProgram;
}

describe('externally controlled text renders as text', () => {
  for (const payload of PAYLOADS) {
    describe(JSON.stringify(payload), () => {
      it('in profile names, pictures and NIP-05', () => {
        inert(authorPill({ pubkey: CREATOR, name: payload, picture: `https://x.example/${payload}`, nip05: payload }, CREATOR));
        inert(accountChip(accountIdentity(state(payload))));
        inert(profileCard(state(payload)));
        inert(profileCard(state(payload, { profile: { status: 'ready', editing: true, baseline: { displayName: payload, picture: payload, address: payload }, draft: { displayName: payload, picture: `https://x.example/${payload}`, address: payload } } } as Partial<AppState>)));
      });

      it('in exercise titles, descriptions and imported fields', () => {
        inert(exerciseCard({ exercise: exercise(payload), keyAttribute: 'data-slug="x"' }));
        inert(exerciseImage(`https://x.example/${payload}`));
      });

      it('in program titles, descriptions and creator names', () => {
        const app = state(payload, { programs: [program(payload)] } as Partial<AppState>);
        inert(programCard(program(payload), app, { showPayment: true }));
      });

      it('in Tip Jar activity: creator names, pictures and program names', () => {
        const record = {
          id: 't', txid: 't', direction: 'out', kind: 'tip', amountAtomic: '5000000000', createdAt: new Date().toISOString(), state: 'confirmed',
          recipientPubkey: CREATOR, recipientAddress: payload, programName: payload, nameSnapshot: payload, pictureSnapshot: `https://x.example/${payload}`
        } as unknown as TipJarOutgoingRecord;
        inert(tipJarActivityCard(state(payload, { tipJarActivity: { pubkey: ACCOUNT, walletId: 'w', records: [record] } } as Partial<AppState>)));
      });

      it('in the send sheet: recipient, program and wallet errors', () => {
        const send = { id: 1, step: 'failed', recipient: { pubkey: CREATOR, name: payload, picture: `https://x.example/${payload}`, programName: payload, address: payload }, amountText: payload, addressText: payload, error: payload } as unknown as MoneroSendState;
        inert(moneroSendBody(send, '1000000000000'));
        inert(moneroSendBody({ ...send, step: 'amount' }, '1000000000000'));
      });

      it('in wallet, backup and relay status text across Settings and the Tip Jar page', () => {
        inert(settingsView(state(payload)));
        inert(tipJarView(state(payload)));
        inert(backupPanel({ sync: { state: 'error', pending: 1, lastError: payload } } as unknown as Parameters<typeof backupPanel>[0]));
      });
    });
  }
});
