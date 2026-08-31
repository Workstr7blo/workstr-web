import type { SheetWithExercises } from '../db/store';
import type { PublishCreatorProgramResult } from '../nostr/program-publish';
import type { Signer, SignedNostrEvent, UnsignedNostrEvent } from '../signer/types';
import type { ProgramPublishControllerContext } from './program-publish-controller';
import { renderShell } from './shell';
import type { ShellHandle, ShellOptions } from './shell-types';

const SMOKE_PUBKEY = 'a'.repeat(64);
const ISOLATED_RELAYS: string[] = [];
const LOOPBACK_SMOKE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const smokeSigner: Signer = {
  type: 'local',
  getPublicKey: async () => SMOKE_PUBKEY,
  signEvent: async (event: UnsignedNostrEvent): Promise<SignedNostrEvent> => ({
    ...event,
    id: 'b'.repeat(64),
    pubkey: SMOKE_PUBKEY,
    sig: 'c'.repeat(128)
  }),
  nip44Encrypt: async () => { throw new Error('isolated browser smoke has no encryption transport'); },
  nip44Decrypt: async () => { throw new Error('isolated browser smoke has no encryption transport'); }
};

type CreatorProgramPublisher = NonNullable<ProgramPublishControllerContext['publishCreatorProgram']>;

export interface IsolatedBrowserSmokeBoundary extends Pick<ProgramPublishControllerContext, 'getSigner' | 'programPublishRelays'> {
  publishCreatorProgram: CreatorProgramPublisher;
}

export function assertIsolatedBrowserSmokeOrigin(hostname: string): void {
  if (!LOOPBACK_SMOKE_HOSTS.has(hostname)) {
    throw new Error('isolated browser smoke may only boot on a loopback origin');
  }
}

export function createIsolatedBrowserSmokeBoundary(): IsolatedBrowserSmokeBoundary {
  return {
    getSigner: async () => smokeSigner,
    programPublishRelays: ISOLATED_RELAYS,
    publishCreatorProgram: async (...[signer, sheet, relays]: Parameters<CreatorProgramPublisher>): Promise<PublishCreatorProgramResult> => {
      if (signer !== smokeSigner || relays !== ISOLATED_RELAYS || relays.length) {
        throw new Error('isolated browser smoke publisher rejected an unisolated publish');
      }
      return {
        event: await smokeSigner.signEvent({ kind: 33402, created_at: 0, tags: [['d', `smoke:${sheet.id}`]], content: '' }),
        okRelays: [],
        failedRelays: [],
        confirmed: false
      };
    }
  };
}

export function renderIsolatedBrowserSmoke(root: HTMLElement): ShellHandle {
  const programPublish = createIsolatedBrowserSmokeBoundary();
  const options: ShellOptions = { programPublish, skipCatalogRefresh: true };
  return renderShell(root, options);
}