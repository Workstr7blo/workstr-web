import { beastModeEligibility, beastModeLockedMarkup } from '../features/sheets/beast-mode';
import { CANON_RELAYS } from '../nostr/canon';
import { deleteCreatorProgram, forgetCanonProgram, type DeleteCreatorProgramResult } from '../nostr/program-delete';
import { expectedCreatorProgramAddress, sheetDraftWithIdentity } from '../nostr/program-ownership';
import { creatorProgramFingerprint, publishCreatorProgram } from '../nostr/program-publish';
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
  deleteCreatorProgram?: (...args: Parameters<typeof deleteCreatorProgram>) => Promise<DeleteCreatorProgramResult>;
  // Writes the catalog snapshot, so a program deleted from relays stays gone offline.
  persistCanonCache?(): Promise<void>;
}

function localSheetId(address: string): number {
  return address.startsWith('local:') ? Number(address.slice('local:'.length)) || 0 : 0;
}

export function createProgramPublishController(ctx: ProgramPublishControllerContext) {
  const { root, state, render, toast, openModal, getSigner } = ctx;
  const publish = ctx.publishCreatorProgram || publishCreatorProgram;
  const retract = ctx.deleteCreatorProgram || deleteCreatorProgram;

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
          nostr_published_content_hash: creatorProgramFingerprint(sheet),
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

  // A Programs card carries `local:<id>`; a Discover card carries the relay address, which may
  // have no local program linked to it at all.
  async function deleteFromRelays(address: string): Promise<void> {
    const sheet = address.startsWith('local:') ? state.sheets.find((item) => item.id === localSheetId(address)) : undefined;
    const relayCopy = sheet ? undefined : state.programs.find((item) => item.address === address);
    const target = sheet?.nostr_address
      ? { address: sheet.nostr_address, eventId: sheet.nostr_event_id }
      : relayCopy ? { address: relayCopy.address, eventId: relayCopy.eventId || undefined } : null;
    if (!target) { toast('Program not found', 'bad'); return; }
    const name = sheet?.name || relayCopy?.name || 'this program';
    const keeps = state.sheets.some((item) => item.nostr_address === target.address) ? ' It stays in Programs on this device.' : '';
    if (!window.confirm(`Delete ${name} from public relays? Relays that honour deletion requests stop serving it, but one that already copied it may keep it.${keeps}`)) return;
    const signer = await getSigner();
    if (!signer) { toast('Sign in before deleting programs from relays.', 'bad'); return; }
    try {
      // Discover reads the catalog relays as well as the configured ones, so the request goes to both.
      const relays = ctx.programPublishRelays ?? [...new Set([...(state.settings.publicRelays || []), ...CANON_RELAYS])];
      const result = await retract(signer, target, relays, {
        onStage: (stage) => toast(stage === 'waiting-for-signer' ? 'Approve the deletion in your signer…' : 'Sending the deletion to public relays…')
      });
      state.programs = state.programs.filter((item) => item.address !== target.address);
      forgetCanonProgram(target.address);
      await ctx.persistCanonCache?.();
      if (state.store) {
        // The local program is kept, but it no longer claims a publication that was retracted.
        for (const linked of state.sheets.filter((item) => item.nostr_address === target.address)) {
          if (linked.id) await state.store.saveSheet(sheetDraftWithIdentity(linked, {}), linked.id);
        }
        state.sheets = await state.store.listSheets();
      }
      render();
      const relayCount = result.okRelays.length;
      toast(`Deleted ${name} from ${relayCount} public relay${relayCount === 1 ? '' : 's'}.`, 'ok');
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error || 'Program deletion failed.'));
      toast(message || 'Program deletion failed.', 'bad');
    }
  }

  // Scoped so a program list rewritten by a filter can rebind its own cards without the
  // page around them being rendered.
  function bind(scope: ParentNode = root): void {
    scope.querySelectorAll<HTMLElement>('[data-publish-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      void publishProgram(button.dataset.publishProgram || '');
    }));
    scope.querySelectorAll<HTMLElement>('[data-delete-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      void deleteFromRelays(button.dataset.deleteProgram || '');
    }));
  }

  return { bind, publishProgram, deleteFromRelays };
}
