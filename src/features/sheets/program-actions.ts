import type { RelayProgram } from '../../nostr/canon';
import { programImportState } from '../../nostr/programImport';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { beastModeEligibility } from './beast-mode';

function isLocalProgram(program: RelayProgram): boolean {
  return program.address.startsWith('local:');
}

function localSheetId(program: RelayProgram): number {
  return Number(program.address.slice('local:'.length)) || 0;
}

export function programActions(program: RelayProgram, state: AppState): string {
  const importState = isLocalProgram(program) ? null : programImportState(program, state.sheets);
  const publishClass = beastModeEligibility(state).unlocked ? ' primary' : '';
  return importState === null
    ? `<button class="button primary small start-workout-action" type="button" data-start-program="${html(program.address)}">Start workout</button>
      <button class="button${publishClass} small" type="button" data-publish-program="${html(program.address)}">Publish</button>
      <button class="button small" type="button" data-edit-sheet="${localSheetId(program)}">Edit</button>
      <button class="button quiet danger small" type="button" data-del-sheet="${localSheetId(program)}">Delete</button>`
    : importState === 'in-library'
      ? `<button class="button small" type="button" disabled>In library</button>`
      : `<button class="button primary small" type="button" data-import-program="${html(program.address)}">${importState === 'update' ? 'Update' : 'Import'}</button>`;
}
