import { beastModeEligibility, beastModeLockedMarkup } from '../features/sheets/beast-mode';
import { expectedCreatorProgramAddress, sheetDraftWithIdentity } from '../nostr/program-ownership';
import { publishCreatorProgram } from '../nostr/program-publish';
import type { PublishCreatorProgramResult } from '../nostr/program-publish';
import { redactSecrets } from '../nostr/secret-redaction';
import type { Signer } from '../signer/types';
import type { AppState } from './state';

export interface ProgramPublishControllerContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  openModal(content: string): void;
  getSigner(): Promise<Signer | null>;
  // The isolated browser smoke injects a local fake; production keeps the real publisher.
  publishCreatorProgram?: (...args: Parameters<typeof publishCreatorProgram>) => Promise<PublishCreatorProgramResult>;
  // Omitted in production. The smoke passes an empty list so fixture clicks
  // cannot inherit configured public relay URLs.
  programPublishRelays?: string[];
}

function localSheetId(address: string): number {
  return address.startsWith('local:') ? Number(address.slice('local:'.length)) || 0 : 0;
}

export function createProgramPublishController(ctx: ProgramPublishControllerContext) {
  const { root, state, render, toast, openModal, getSigner } = ctx;
  const publish = ctx.publishCreatorProgram || publishCreatorProgram;

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
      const result = await publish(signer, sheet, ctx.programPublishRelays ?? state.settings.publicRelays, {
        onStage: (stage) => toast(stage === 'waiting-for-signer' ? 'Approve program publish in your signer…' : 'Publishing program to public relays…')
      });
      if (state.store) {
        const { pubkey, id, created_at: publishedAt } = result.event;
        await state.store.saveSheet(sheetDraftWithIdentity(sheet, {
          nostr_pubkey: pubkey,
          nostr_address: expectedCreatorProgramAddress(sheet, pubkey),
          nostr_event_id: id,
          nostr_published_at: new Date(publishedAt * 1000).toISOString(),
          origin_created_at: publishedAt
        }), sheet.id);
        state.sheets = await state.store.listSheets();
      }
      render();
      const relayCount = result.okRelays.length;
      toast(`Published ${sheet.name} to ${relayCount} public relay${relayCount === 1 ? '' : 's'}${result.confirmed ? ' and confirmed.' : '.'}`, 'ok');
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error || 'Program publish failed.'));
      toast(message || 'Program publish failed.', 'bad');
    }
  }

  // Scoped so a program list rewritten by a filter can rebind its own cards without the
  // page around them being rendered.
  function bind(scope: ParentNode = root): void {
    scope.querySelectorAll<HTMLElement>('[data-publish-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      void publishProgram(button.dataset.publishProgram || '');
    }));
  }

  return { bind, publishProgram };
}
