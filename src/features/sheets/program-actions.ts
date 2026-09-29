import type { RelayProgram } from '../../nostr/canon';
import { CREATOR_PROGRAM_KIND } from '../../nostr/creator-programs';
import { programImportState } from '../../nostr/programImport';
import { findOwnedProgramSource, sheetPublicationState, type ProgramPublicationState } from '../../nostr/program-ownership';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { icon, type IconName } from '../../app/icons';
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
function actionRow(title: string, detail: string, control: string, extraClass = ''): string {
  return `<div class="program-action-row${extraClass ? ` ${extraClass}` : ''}"><span class="program-action-copy"><strong>${html(title)}</strong><small>${html(detail)}</small></span><span class="program-action-control">${control}</span></div>`;
}

function actionButton(label: string, iconName: IconName, attributes: string, variant = ''): string {
  return `<button class="button small program-action-button${variant ? ` ${variant}` : ''}" type="button" ${attributes}>${icon(iconName)}<span>${html(label)}</span></button>`;
}

function disabledAction(label: string, detail: string, iconName: IconName, extraClass = ''): string {
  return actionRow(label, detail, `<button class="button small program-action-button" type="button" disabled>${icon(iconName)}<span>${html(label)}</span></button>`, extraClass);
}

function deleteFromRelaysRow(address: string): string {
  return actionRow(
    'Delete from relays',
    'Request removal of your public program.',
    actionButton('Delete', 'trash-2', `data-delete-program="${html(address)}"`, 'quiet danger'),
    'program-action-row--danger'
  );
}

function authoredByActiveAccount(program: RelayProgram, state: AppState): boolean {
  return Boolean(state.pubkey && program.pubkey === state.pubkey && program.address.startsWith(`${CREATOR_PROGRAM_KIND}:${state.pubkey}:`));
}

function localProgramActions(program: RelayProgram, state: AppState): string {
  const publication = localPublicationState(program, state);
  const publishClass = beastModeEligibility(state).unlocked ? ' primary' : '';
  const publish = publication === 'published'
    ? disabledAction('Published', 'The latest version is already on relays.', 'upload')
    : actionRow(
      publication === 'changed' ? 'Publish update' : 'Publish',
      publication === 'changed' ? 'Share your latest edits from this device.' : 'Share this program from your account.',
      actionButton(publication === 'changed' ? 'Publish update' : 'Publish', 'upload', `data-publish-program="${html(program.address)}"`, publishClass.trim()),
      publishClass ? 'program-action-row--primary' : ''
    );
  return `${actionRow('Start workout', 'Begin this program now.', actionButton('Start', 'play', `data-start-program="${html(program.address)}"`, 'primary start-workout-action'), 'program-action-row--lead')}
      ${publish}
      ${actionRow('Edit program', 'Change exercises, sets or timing.', actionButton('Edit', 'pencil', `data-edit-sheet="${localSheetId(program)}"`))}
      ${publication === 'local' ? '' : deleteFromRelaysRow(program.address)}
      ${actionRow('Delete local copy', 'Remove this program from this device.', actionButton('Delete', 'trash-2', `data-del-sheet="${localSheetId(program)}"`, 'quiet danger'), 'program-action-row--danger')}`;
}

export function programActions(program: RelayProgram, state: AppState): string {
  if (isLocalProgram(program)) return localProgramActions(program, state);
  // The user's own publication is edited from Programs; the relay copy is only ever a status.
  const owned = findOwnedProgramSource(program, state.sheets, state.pubkey);
  const retract = authoredByActiveAccount(program, state) ? deleteFromRelaysRow(program.address) : '';
  if (owned) {
    const label = sheetPublicationState(owned, state.pubkey) === 'changed' ? 'Yours · Unpublished changes' : 'Yours';
    return `${disabledAction(label, 'Edit this program from your local Programs library.', 'check')}${retract}`;
  }
  const importState = programImportState(program, state.sheets, state.pubkey);
  return (importState === 'in-library'
    ? disabledAction('In library', 'This program is already saved locally.', 'check')
    : actionRow(
      importState === 'update' ? 'Update local copy' : 'Import program',
      importState === 'update' ? 'Refresh your local copy with the relay version.' : 'Add a local copy to your Programs library.',
      actionButton(importState === 'update' ? 'Update' : 'Import', 'download', `data-import-program="${html(program.address)}"`, 'primary'),
      'program-action-row--lead'
    )) + retract;
}
