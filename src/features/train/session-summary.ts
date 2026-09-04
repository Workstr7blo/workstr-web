import { normalizeWeightUnit } from '../../core/units';
import { html } from '../../app/format';
import type { ActiveSession, AppState, SessionExercise } from '../../app/state';
import { fetchCanonPrograms, type RelayProgram } from '../../nostr/canon';
import { publishWorkoutSummary } from '../../nostr/share';
import type { Signer } from '../../signer/types';
import { durationLabel, exerciseSlugSignature, sessionDurationSeconds } from './session-logic';

export interface SessionSummaryContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  closeModal(): void;
  wDisplay(weight: number | null | undefined): number | null;
  unitLabel(): string;
  persistCanonCache(): Promise<void>;
  getActiveSigner(): Promise<Signer | null>;
  programExercises(program: RelayProgram): SessionExercise[];
}

export interface SessionSummary {
  publish(session: ActiveSession, button: HTMLButtonElement | null): Promise<void>;
  render(session: ActiveSession): void;
}

export function createSessionSummary(ctx: SessionSummaryContext): SessionSummary {
  const { root, state } = ctx;

  function normalizedProgramName(name: string): string {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function findProgramMap(session: ActiveSession, programs: RelayProgram[]): string {
    const withMaps = programs.filter((program) => program.muscleMapUrl);
    if (!withMaps.length) return '';
    const sessionName = normalizedProgramName(session.sheetName);
    const exactName = withMaps.filter((program) => normalizedProgramName(program.name) === sessionName).sort((a, b) => b.createdAt - a.createdAt);
    if (exactName.length) return exactName[0].muscleMapUrl || '';
    const sessionSig = exerciseSlugSignature(session.exercises);
    if (!sessionSig) return '';
    const rosterMatches = withMaps.filter((program) => exerciseSlugSignature(ctx.programExercises(program)) === sessionSig).sort((a, b) => b.createdAt - a.createdAt);
    return rosterMatches.length === 1 ? rosterMatches[0].muscleMapUrl || '' : '';
  }

  async function resolveImageUrl(session: ActiveSession): Promise<string> {
    if (session.summaryImageUrl) return session.summaryImageUrl;
    let url = findProgramMap(session, state.programs);
    if (url) return url;
    try {
      const fresh = await fetchCanonPrograms();
      state.programs = fresh;
      await ctx.persistCanonCache();
      url = findProgramMap(session, fresh);
    } catch {
      url = '';
    }
    if (url) session.summaryImageUrl = url;
    return url;
  }

  async function publish(session: ActiveSession, button: HTMLButtonElement | null): Promise<void> {
    if (session.nostrEventId || state.publishingSessionId !== null) return;
    const signer = await ctx.getActiveSigner();
    if (!signer) {
      ctx.toast(state.pubkey ? 'Signer connection was lost — sign in again from Settings to publish' : 'Sign in with your Nostr signer in Settings to publish', 'bad');
      return;
    }
    state.publishingSessionId = session.id;
    state.publishingStatus = 'Waiting for signer...';
    if (button) { button.disabled = true; button.textContent = state.publishingStatus; }
    let message: { text: string; kind: 'ok' | 'bad' };
    const setStatus = (text: string): void => {
      state.publishingStatus = text;
      if (button?.isConnected) button.textContent = text;
    };
    const label = (stage: string): string => ({
      'preparing-image': 'Preparing muscle map...',
      'waiting-for-signer': 'Waiting for signer...',
      'uploading-image': 'Uploading muscle map...',
      publishing: 'Publishing...'
    }[stage] || 'Waiting for signer...');
    try {
      const imageUrl = await resolveImageUrl(session);
      const result = await publishWorkoutSummary(signer, session, normalizeWeightUnit(state.settings.unit), undefined, {
        exercises: state.exercises, imageUrl, onStage: (stage) => setStatus(label(stage))
      });
      session.nostrEventId = result.event.id;
      await state.store?.markSessionPublished(session.id, result.event.id);
      const inHistory = state.finishedSessions.find((item) => item.id === session.id);
      if (inHistory) inHistory.nostrEventId = result.event.id;
      if (button?.isConnected) button.textContent = 'Published';
      message = { text: `Summary published to ${result.okRelays.length} relay${result.okRelays.length === 1 ? '' : 's'}`, kind: 'ok' };
    } catch (error) {
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Publish summary'; }
      message = { text: `Publish failed: ${(error as Error).message}`, kind: 'bad' };
    }
    state.publishingSessionId = null;
    state.publishingStatus = null;
    if (!button?.isConnected && !root.querySelector('#modal.open')) ctx.render();
    ctx.toast(message.text, message.kind);
  }

  function render(session: ActiveSession): void {
    const doneSets = session.sets.filter((set) => set.done);
    const volume = Math.round(doneSets.reduce((sum, set) => sum + (Number(set.reps) || 0) * (Number(set.weight) || 0), 0));
    const stats = [
      { val: durationLabel(sessionDurationSeconds(session)), label: 'Duration' },
      { val: doneSets.length, label: 'Sets' },
      { val: volume > 0 ? `${Math.round(ctx.wDisplay(volume) ?? 0)} ${ctx.unitLabel()}` : '—', label: 'Volume' },
      { val: new Set(doneSets.map((set) => set.exerciseSlug)).size, label: 'Exercises' }
    ];
    ctx.openModal(`
      <div class="summary-hero">
        <div class="sh-medal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12"/></svg></div>
        <div class="sh-copy"><strong>${html(session.sheetName || 'Freestyle')}</strong><small>nicely done — here's the recap</small></div>
      </div>
      <div class="summary-stats">${stats.map((item) => `<div class="summary-stat"><div class="ss-val">${html(String(item.val))}</div><div class="ss-label">${item.label}</div></div>`).join('')}</div>
      <div class="subsection-head"><span>Vs last time</span><small>working-set volume per exercise</small></div>
      <div class="summary-compare"><div class="empty">First local web session — comparison appears after you repeat this workout.</div></div>
      <div class="form-actions">
        ${state.pubkey ? '<button class="button primary" id="finish-publish" type="button">Publish summary</button>' : '<button class="button primary" id="finish-publish" type="button" disabled title="Sign in with your Nostr signer in Settings to publish">Publish summary</button>'}
        <button class="button quiet" id="finish-done" type="button">Done</button>
      </div>`);
    root.querySelector('#finish-publish')?.addEventListener('click', (event) => { void publish(session, event.currentTarget as HTMLButtonElement); });
    root.querySelector('#finish-done')?.addEventListener('click', ctx.closeModal);
  }

  return { publish, render };
}
