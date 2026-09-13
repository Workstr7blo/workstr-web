import type { RelayProgram } from '../../nostr/canon';
import { CREATOR_PROGRAM_KIND } from '../../nostr/creator-programs';
import { programImportState } from '../../nostr/programImport';
import { findOwnedProgramSource, sheetPublicationState, type ProgramPublicationState } from '../../nostr/program-ownership';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { beastModeEligibility } from './beast-mode';

function isLocalProgram(program: RelayProgram): boolean {
  return program.address.startsWith('local:');
}

function localSheetId(program: RelayProgram): number {
  return Number(program.address.slice('local:'.length)) || 0;
}

function localPublicationState(program: RelayProgram, state: AppState): ProgramPublicationState {
  const sheet = state.sheets.find((item) => item.id === localSheetId(program));
  return sheet ? sheetPublicationState(sheet, state.pubkey) : 'local';
}

// The pill on a card. A local card that is the user's own publication says whether relays
// carry its latest content; anything else keeps the source it came from.
export function programStatusBadge(program: RelayProgram, state: AppState): { label: string; cls: string } {
  if (!isLocalProgram(program)) return { label: program.sourceLabel || 'Workstr', cls: 'published' };
  const publication = localPublicationState(program, state);
  if (publication === 'published') return { label: 'Published', cls: 'published' };
  if (publication === 'changed') return { label: 'Unpublished changes', cls: 'changed' };
  return { label: program.sourceLabel || 'local', cls: 'local' };
}

// Only the author can retract a program, so the action appears on the active account's own
// publications: a published Programs card, and its relay copy in Discover whether or not a
// local program is still linked to it.
function deleteFromRelaysButton(address: string): string {
  return `<button class="button quiet danger small" type="button" data-delete-program="${html(address)}">Delete from relays</button>`;
}

function authoredByActiveAccount(program: RelayProgram, state: AppState): boolean {
  return Boolean(state.pubkey && program.pubkey === state.pubkey && program.address.startsWith(`${CREATOR_PROGRAM_KIND}:${state.pubkey}:`));
}

function localProgramActions(program: RelayProgram, state: AppState): string {
  const publication = localPublicationState(program, state);
  const publishClass = beastModeEligibility(state).unlocked ? ' primary' : '';
  const publish = publication === 'published'
    ? `<button class="button small" type="button" disabled>Published</button>`
    : `<button class="button${publishClass} small" type="button" data-publish-program="${html(program.address)}">${publication === 'changed' ? 'Publish update' : 'Publish'}</button>`;
  return `<button class="button primary small start-workout-action" type="button" data-start-program="${html(program.address)}">Start workout</button>
      ${publish}
      <button class="button small" type="button" data-edit-sheet="${localSheetId(program)}">Edit</button>
      ${publication === 'local' ? '' : deleteFromRelaysButton(program.address)}
      <button class="button quiet danger small" type="button" data-del-sheet="${localSheetId(program)}">Delete</button>`;
}

export function programActions(program: RelayProgram, state: AppState): string {
  if (isLocalProgram(program)) return localProgramActions(program, state);
  // The user's own publication is edited from Programs; the relay copy is only ever a status.
  const owned = findOwnedProgramSource(program, state.sheets, state.pubkey);
  const retract = authoredByActiveAccount(program, state) ? deleteFromRelaysButton(program.address) : '';
  if (owned) {
    const label = sheetPublicationState(owned, state.pubkey) === 'changed' ? 'Yours · Unpublished changes' : 'Yours';
    return `<button class="button small" type="button" disabled>${label}</button>${retract}`;
  }
  const importState = programImportState(program, state.sheets, state.pubkey);
  return (importState === 'in-library'
    ? `<button class="button small" type="button" disabled>In library</button>`
    : `<button class="button primary small" type="button" data-import-program="${html(program.address)}">${importState === 'update' ? 'Update' : 'Import'}</button>`) + retract;
}
