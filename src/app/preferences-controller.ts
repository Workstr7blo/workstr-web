import { mergeOwnedEquipment, MY_EQUIPMENT, ownedEquipmentKeys } from '../core/equipment';
import { normalizeWeightUnit, storeWeightInput } from '../core/units';
import { sessionDayKey } from '../core/dates';
import { LOCAL_NAMESPACE } from '../db/adopt';
import { downloadExport, parseExport } from '../db/export';
import { fetchMonthlyZapReceipts } from '../nostr/zaps';
import type { RelayProgram } from '../nostr/canon';
import { getRecovery, type RecoveryGroup } from '../features/recovery/recovery';
import { getQuickWorkout } from '../features/recovery/quickWorkout';
import { html } from './format';
import type { ActiveSession, AppState } from './state';

export interface PreferencesControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  startTrainingSession(program: RelayProgram): Promise<void>;
  loadFinishedSessions(): Promise<ActiveSession[]>;
}

export function createPreferencesController(ctx: PreferencesControllerContext) {
  const { root, state, render, toast, startTrainingSession, loadFinishedSessions } = ctx;

function bindBodyControls(): void {
  root.querySelector('#body-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.store) { toast('Sign in to log weight.', 'bad'); return; }
    const form = event.target as HTMLFormElement;
    const weightKg = storeWeightInput((form.elements.namedItem('weightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit));
    if (weightKg == null) return;
    await state.store.logBody({ date: (form.elements.namedItem('date') as HTMLInputElement).value || undefined, weight_kg: weightKg, notes: '' });
    state.bodyEntries = await state.store.listBody();
    render();
    toast('Weight logged');
  });
  root.querySelectorAll<HTMLElement>('[data-del-body]').forEach((button) => button.addEventListener('click', async () => {
    if (!state.store) return;
    await state.store.deleteBody(Number(button.dataset.delBody) || 0);
    state.bodyEntries = await state.store.listBody();
    render();
  }));
  root.querySelector('#body-profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.store) { toast('Sign in to save your profile.', 'bad'); return; }
    const form = event.target as HTMLFormElement;
    const heightCm = Number((form.elements.namedItem('heightCm') as HTMLInputElement).value) || 0;
    const targetWeightKg = storeWeightInput((form.elements.namedItem('targetWeightKg') as HTMLInputElement).value, normalizeWeightUnit(state.settings.unit)) || 0;
    state.settings = { ...state.settings, heightCm, targetWeightKg };
    await state.store.saveSettings(state.settings);
    render();
    toast('Profile saved');
  });
}

// Zap receipts are public, so this needs no identity and runs whether or not
// the user is signed in. Refetched at most once per settings visit.
async function refreshFunding(): Promise<void> {
  if (state.support.status === 'loading' || state.support.status === 'ready') return;
  state.support = { ...state.support, status: 'loading' };
  render();
  try {
    state.support = { status: 'ready', receipts: await fetchMonthlyZapReceipts(), fetchedAt: Date.now() };
  } catch {
    state.support = { ...state.support, status: 'offline' };
  }
  render();
}

function bindRecoveryControls(): void {
  const body = root.querySelector<SVGSVGElement>('#recovery-body');
  if (body) {
    const tip = root.querySelector<HTMLElement>('#recovery-tip');
    const byMuscle: Record<string, RecoveryGroup> = {};
    for (const group of getRecovery(state.finishedSessions, state.exercises).muscleGroups) byMuscle[group.name] = group;
    const highlight = (name: string | null) => body.querySelectorAll<SVGElement>('[data-muscle]').forEach((el) => el.classList.toggle('hl', name != null && el.getAttribute('data-muscle') === name));
    body.addEventListener('mousemove', (event) => {
      if (!tip) return;
      const poly = (event.target as Element).closest('[data-muscle]');
      if (!poly) { tip.hidden = true; highlight(null); return; }
      const name = poly.getAttribute('data-muscle') || '';
      const group = byMuscle[name];
      highlight(name);
      const rect = (body.parentElement as HTMLElement).getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${event.clientX - rect.left}px`;
      tip.style.top = `${event.clientY - rect.top}px`;
      tip.innerHTML = group
        ? `<strong>${html(name)}</strong><small>${group.percent}% · ${group.status}${group.status !== 'untrained' && group.percent < 100 ? ` · ${group.hoursRemaining}h left` : ''}</small>`
        : `<strong>${html(name)}</strong><small>no data</small>`;
    });
    body.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; highlight(null); });
  }
  root.querySelectorAll<HTMLElement>('[data-qw-dur]').forEach((button) => button.addEventListener('click', () => {
    state.qw.duration = Number(button.dataset.qwDur) || 45;
    root.querySelectorAll<HTMLElement>('#qw-duration .qw-dur-btn').forEach((el) => el.classList.toggle('active', el === button));
  }));
  root.querySelector('#qw-generate')?.addEventListener('click', async () => {
    const data = getQuickWorkout(state.finishedSessions, state.store ? await state.store.listExercises() : [], state.qw.duration, 80, ownedEquipmentKeys(state.settings.ownedEquipment));
    if (!data.exercises.length) {
      state.qw.visible = false; state.qw.exercises = []; state.qw.pool = {};
      render();
      toast('No recovered muscle groups with exercises yet — train or add exercises first.', 'bad');
      return;
    }
    state.qw.exercises = data.exercises;
    state.qw.pool = data.pool;
    state.qw.meta = `${data.exercises.length} exercises · ~${data.estimatedDurationMin} min · ${data.targetMuscleGroups.join(', ')}`;
    state.qw.visible = true;
    render();
  });
  root.querySelectorAll<HTMLElement>('[data-qw-swap]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.qwSwap) || 0;
    const exercise = state.qw.exercises[index];
    const pool = state.qw.pool[exercise?.muscleGroup || ''] || [];
    if (!exercise || !pool.length) return;
    const replacement = pool.shift()!;
    pool.push(exercise); // cycle the swapped-out exercise back in
    state.qw.pool[exercise.muscleGroup] = pool;
    state.qw.exercises[index] = replacement;
    render();
  }));
  root.querySelectorAll<HTMLElement>('[data-qw-remove]').forEach((button) => button.addEventListener('click', () => {
    state.qw.exercises.splice(Number(button.dataset.qwRemove) || 0, 1);
    if (!state.qw.exercises.length) state.qw.visible = false;
    render();
  }));
  root.querySelector('#qw-start')?.addEventListener('click', () => {
    if (!state.qw.exercises.length) return;
    const groups = [...new Set(state.qw.exercises.map((exercise) => exercise.muscleGroup).filter(Boolean))];
    const name = 'Quick — ' + (groups.length ? groups.join(', ') : 'Mixed');
    const program: RelayProgram = {
      slug: 'quick-workout', name, description: '', tags: [], sourceLabel: '', muscleMapUrl: '', eventId: '', pubkey: '', address: '', createdAt: Date.now(),
      exercises: state.qw.exercises.map((exercise) => ({ address: '', name: exercise.name, muscleGroup: exercise.muscleGroup, sets: exercise.sets, reps: exercise.reps, restSec: exercise.restSec }))
    };
    state.qw.visible = false;
    void startTrainingSession(program);
  });
}

async function deleteSession(id: number): Promise<void> {
  if (!state.store || !id) return;
  if (!window.confirm('Delete this session? All logged sets will be permanently removed from your history and stats.')) return;
  await state.store.deleteSession(id);
  if (state.expandedSessionId === id) state.expandedSessionId = null;
  state.finishedSessions = await loadFinishedSessions();
  // Deleting the last workout on the day you were filtering by would otherwise leave the
  // timeline pinned to an empty date, so the selection falls back to the whole history.
  const selected = state.history.selectedDate;
  if (selected && !state.finishedSessions.some((session) => sessionDayKey(session.finishedAt, session.startedAt) === selected)) {
    state.history.selectedDate = null;
  }
  render();
}

async function saveUnitPreference(value: string): Promise<void> {
  if (!state.store) return;
  state.settings = { ...state.settings, unit: normalizeWeightUnit(value) };
  await state.store.saveSettings(state.settings);
  render();
}

// Only flips the stored mode and the theme/attribute layer it drives; NWC, zap, and
// Discover behavior are untouched until the later Monero Mode phases read this flag.
async function savePaymentMode(enabled: boolean): Promise<void> {
  if (!state.store) return;
  state.settings = { ...state.settings, paymentMode: enabled ? 'monero' : 'lightning' };
  await state.store.saveSettings(state.settings);
  render();
}

async function saveOwnedEquipment(): Promise<void> {
  if (!state.store) return;
  // Merge rather than replace: the checkbox list only covers equipment the
  // loaded catalog knows about, so a kit saved against a fuller catalog would
  // lose entries if we took the DOM as the whole truth.
  const rendered = [...root.querySelectorAll<HTMLInputElement>('.equip-toggle')].map((box) => box.value);
  const ticked = [...root.querySelectorAll<HTMLInputElement>('.equip-toggle:checked')].map((box) => box.value);
  const checked = mergeOwnedEquipment(state.settings.ownedEquipment, rendered, ticked);
  state.settings = { ...state.settings, ownedEquipment: checked };
  await state.store.saveSettings(state.settings);
  // "My equipment" disappears from the selects when the kit empties, so a
  // filter still pointing at it would silently filter on nothing.
  if (!checked.length) {
    if (state.exFilter.equip === MY_EQUIPMENT) state.exFilter.equip = '';
    if (state.discoverFilter.equip === MY_EQUIPMENT) state.discoverFilter.equip = '';
  }
  render();
}

async function exportUserData(): Promise<void> {
  if (!state.store) return;
  try {
    downloadExport(await state.store.exportData(state.pubkey ?? LOCAL_NAMESPACE));
    toast('Exported your data');
  } catch (error) {
    toast(`Export failed: ${(error as Error).message}`, 'bad');
  }
}

async function importUserData(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = ''; // allow re-picking the same file later
  if (!file || !state.store) return;
  try {
    const data = parseExport(await file.text());
    const confirmation = window.prompt('This ERASES all data in this account and replaces it with the file. Type REPLACE to confirm.');
    if (confirmation !== 'REPLACE') { toast('Import cancelled'); return; }
    await state.store.importData(data);
    window.location.reload();
  } catch (error) {
    toast(`Import failed: ${(error as Error).message}`, 'bad');
  }
}

  return {
    bindBodyControls, refreshFunding, bindRecoveryControls, deleteSession,
    saveUnitPreference, savePaymentMode, saveOwnedEquipment, exportUserData, importUserData
  };
}
