import { sessionDayKey } from '../../core/dates';
import { html } from '../../app/format';
import type { AppState } from '../../app/state';

type BeastModeCheckId = 'local-program' | 'completed-workouts' | 'local-days' | 'profile-picture';

export interface BeastModeEligibilityCheck {
  id: BeastModeCheckId;
  label: string;
  detail: string;
  passed: boolean;
}

export interface BeastModeEligibility {
  unlocked: boolean;
  checks: BeastModeEligibilityCheck[];
  completedWorkoutCount: number;
  distinctWorkoutDayCount: number;
}

type BeastModeState = Pick<AppState, 'pubkey' | 'profilePicture' | 'sheets' | 'finishedSessions'>;

export function beastModeEligibility(state: BeastModeState): BeastModeEligibility {
  const sheets = state.sheets || [];
  const finishedSessions = state.finishedSessions || [];
  const completedWorkoutCount = finishedSessions.length;
  const distinctWorkoutDayCount = new Set(finishedSessions
    .map((session) => sessionDayKey(session.finishedAt, session.startedAt))
    .filter((key): key is string => Boolean(key))).size;
  const hasLocalProgram = sheets.length >= 1;
  const hasProfilePicture = Boolean(state.pubkey && state.profilePicture?.trim());
  const checks: BeastModeEligibilityCheck[] = [
    {
      id: 'local-program',
      label: 'Create 1 local program',
      detail: hasLocalProgram ? `${sheets.length} local program${sheets.length === 1 ? '' : 's'} found` : 'Build or import a program, then keep a local copy.',
      passed: hasLocalProgram
    },
    {
      id: 'completed-workouts',
      label: 'Complete 5 workouts',
      detail: `${Math.min(completedWorkoutCount, 5)} / 5 completed`,
      passed: completedWorkoutCount >= 5
    },
    {
      id: 'local-days',
      label: 'Train on 3 distinct local days',
      detail: `${Math.min(distinctWorkoutDayCount, 3)} / 3 local days`,
      passed: distinctWorkoutDayCount >= 3
    },
    {
      id: 'profile-picture',
      label: 'Signed-in Nostr profile has a picture',
      detail: hasProfilePicture ? 'Existing kind:0 picture detected.' : state.pubkey ? 'Add picture/image/avatar in your Nostr profile, then reconnect.' : 'Sign in with a Nostr account that already has a picture.',
      passed: hasProfilePicture
    }
  ];
  return { unlocked: checks.every((check) => check.passed), checks, completedWorkoutCount, distinctWorkoutDayCount };
}

export function beastModeChecklistMarkup(state: BeastModeState): string {
  const eligibility = beastModeEligibility(state);
  const rows = eligibility.checks.map((check) => `<li class="beast-mode-check ${check.passed ? 'ok' : 'locked'}" data-beast-mode-check="${check.id}">
    <span class="beast-mode-check-icon" aria-hidden="true">${check.passed ? '✓' : '•'}</span>
    <span><strong>${html(check.label)}</strong><small>${html(check.detail)}</small></span>
  </li>`).join('');
  return `<div class="beast-mode-checklist ${eligibility.unlocked ? 'unlocked' : 'locked'}" data-beast-mode-state="${eligibility.unlocked ? 'unlocked' : 'locked'}">
    <ul>${rows}</ul>
  </div>`;
}

export function beastModeSettingsCard(state: BeastModeState): string {
  const eligibility = beastModeEligibility(state);
  return `<div class="panel settings-card beast-mode-card">
    <div class="panel-head"><span>Beast Mode</span><span class="status-pill ${eligibility.unlocked ? 'ok' : ''}">${eligibility.unlocked ? 'unlocked' : 'locked'}</span></div>
    <p class="section-help">Publish creator programs after Workstr can verify objective local training history and an existing Nostr profile picture. No manual queue or admin approval.</p>
    ${beastModeChecklistMarkup(state)}
  </div>`;
}

export function beastModeLockedMarkup(state: BeastModeState, programName?: string): string {
  const title = programName ? `Publish ${programName}` : 'Publish program';
  return `<div class="modal-section beast-mode-lock-modal">
    <h2>${html(title)}</h2>
    <p class="section-help">Beast Mode is locked. Finish the checklist below before publishing a local program.</p>
    ${beastModeChecklistMarkup(state)}
  </div>`;
}
