import type { WorkoutProgramZapAttempt } from '../../core/types';
import type { RelayProgram } from '../../nostr/canon';
import { programImportState } from '../../nostr/programImport';
import type { AppState } from '../../app/state';
import { html } from '../../app/format';
import { beastModeEligibility } from './beast-mode';
import { moneroMode } from './monero-tip-view';

function isLocalProgram(program: RelayProgram): boolean {
  return program.address.startsWith('local:');
}

function localSheetId(program: RelayProgram): number {
  return Number(program.address.slice('local:'.length)) || 0;
}

function programZapAddress(program: RelayProgram, state: AppState): string {
  if (!isLocalProgram(program)) return program.address;
  const sheet = state.sheets.find((item) => item.id === localSheetId(program));
  return sheet?.nostr_address || program.address;
}

function latestProgramZap(program: RelayProgram, state: AppState): WorkoutProgramZapAttempt | undefined {
  const address = programZapAddress(program, state);
  return state.programZapAttempts?.find((attempt) => attempt.programAddress === address || attempt.programAddress === program.address);
}

export function programZapStatus(program: RelayProgram, state: AppState): string {
  // A Lightning receipt on a Monero card reads as a claim about the wrong network. The
  // record is the device's own and comes straight back when the Lightning rail does.
  if (moneroMode(state)) return '';
  const attempt = latestProgramZap(program, state);
  if (!attempt) return '';
  const message = attempt.status === 'succeeded'
    ? `Zap sent · ${attempt.amountSats.toLocaleString('en-US')} sats`
    : attempt.status === 'pending'
      ? `Sending zap · ${attempt.amountSats.toLocaleString('en-US')} sats`
      : `${attempt.status === 'cancelled' ? 'Zap cancelled' : 'Zap failed'} · ${html(attempt.errorMessage || 'Check wallet status before retrying.')}`;
  const cls = attempt.status === 'succeeded' ? 'ok' : attempt.status === 'failed' ? 'bad' : '';
  return `<div class="program-section-summary program-zap-status"><strong>Creator zap</strong><span class="status-pill ${cls}">${message}</span></div>`;
}

export function canZapProgram(program: RelayProgram, state: AppState): boolean {
  if (!program.pubkey) return false;
  if (!isLocalProgram(program)) return true;
  return Boolean(state.sheets.find((sheet) => sheet.id === localSheetId(program))?.nostr_address);
}

// The bolt, vendored as a path rather than the U+26A1 character: that codepoint is an
// emoji, so iOS and Android paint their own colour glyph and the rail loses control of it.
// Drawn on the same 24-unit grid as the Monero mark and filled with `currentColor`, so one
// rule can colour either rail's payment action.
const ZAP_BOLT = 'M13.6 2 4.8 13.9h5.2L8.7 22 19.2 9.6h-5.3z';

export function zapBolt(size = 16): string {
  return `<svg class="program-zap-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${ZAP_BOLT}"/></svg>`;
}

export function programZapButton(program: RelayProgram, state: AppState): string {
  if (!canZapProgram(program, state)) return '';
  return `<button class="button payment small program-zap-cta" type="button" data-zap-program="${html(program.address)}" aria-label="Zap creator of ${html(program.name)}">${zapBolt(16)}<span class="program-zap-label">Zap</span></button>`;
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
