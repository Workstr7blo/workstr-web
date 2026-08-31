import type { SheetExercise } from '../core/types';
import type { SheetDraft, SheetWithExercises } from '../db/store';
import { beastModeEligibility, beastModeLockedMarkup } from '../features/sheets/beast-mode';
import { creatorProgramDTag, publishCreatorProgram } from '../nostr/program-publish';
import { redactNwcSecrets } from '../nostr/nwc';
import type { Signer } from '../signer/types';
import type { AppState } from './state';

export interface ProgramPublishControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  getSigner(): Promise<Signer | null>;
}

function localSheetId(address: string): number {
  return address.startsWith('local:') ? Number(address.slice('local:'.length)) || 0 : 0;
}

function sheetExerciseDraft(row: SheetExercise): Omit<SheetExercise, 'id' | 'sheet_id'> {
  return {
    exercise_slug: row.exercise_slug,
    exercise_name: row.exercise_name,
    muscle_group: row.muscle_group,
    image_url: row.image_url,
    position: row.position,
    sets: row.sets,
    reps: row.reps,
    rest: row.rest,
    weight: row.weight,
    notes: row.notes
  };
}

function publishedSheetDraft(sheet: SheetWithExercises, eventPubkey: string, eventId: string, publishedAt: number): SheetDraft {
  return {
    name: sheet.name,
    notes: sheet.notes,
    difficulty: sheet.difficulty,
    tags: sheet.tags,
    blocks: sheet.blocks,
    is_temporary: sheet.is_temporary,
    source_type: sheet.source_type,
    nostr_pubkey: eventPubkey,
    nostr_address: `33402:${eventPubkey}:${creatorProgramDTag(sheet)}`,
    nostr_event_id: eventId,
    nostr_published_at: new Date(publishedAt * 1000).toISOString(),
    origin_created_at: publishedAt,
    exercises: sheet.exercises.map(sheetExerciseDraft)
  };
}

export function createProgramPublishController(ctx: ProgramPublishControllerContext) {
  const { root, state, render, toast, openModal, getSigner } = ctx;

  async function publishProgram(address: string): Promise<void> {
    const sheet = state.sheets.find((item) => item.id === localSheetId(address));
    if (!sheet) { toast('Program not found', 'bad'); return; }
    if (!beastModeEligibility(state).unlocked) {
      openModal(beastModeLockedMarkup(state, sheet.name));
      return;
    }
    const signer = await getSigner();
    if (!signer) { toast('Sign in before publishing programs.', 'bad'); return; }
    try {
      const result = await publishCreatorProgram(signer, sheet, state.settings.publicRelays, {
        onStage: (stage) => toast(stage === 'waiting-for-signer' ? 'Approve program publish in your signer…' : 'Publishing program to public relays…')
      });
      if (state.store) {
        await state.store.saveSheet(publishedSheetDraft(sheet, result.event.pubkey, result.event.id, result.event.created_at), sheet.id);
        state.sheets = await state.store.listSheets();
      }
      render();
      const relayCount = result.okRelays.length;
      toast(`Published ${sheet.name} to ${relayCount} public relay${relayCount === 1 ? '' : 's'}${result.confirmed ? ' and confirmed.' : '.'}`, 'ok');
    } catch (error) {
      const message = redactNwcSecrets(error instanceof Error ? error.message : String(error || 'Program publish failed.'));
      toast(message || 'Program publish failed.', 'bad');
    }
  }

  function bind(): void {
    root.querySelectorAll<HTMLElement>('[data-publish-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      void publishProgram(button.dataset.publishProgram || '');
    }));
  }

  return { bind, publishProgram };
}
