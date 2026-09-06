import type { ProgramPublishControllerContext } from './program-publish-controller';
import type { RenderTrace } from './root-rebuild';
import type { AppState } from './state';

export interface ShellOptions {
  programPublish?: Pick<ProgramPublishControllerContext, 'getSigner' | 'publishCreatorProgram' | 'programPublishRelays'>;
  skipCatalogRefresh?: boolean;
}

export interface ShellHandle {
  state: AppState;
  ready: Promise<void>;
  // What made the shell rebuild its root, and how often. Diagnostic: read by tests and by
  // the dev console, never branched on.
  renders: RenderTrace;
  publishProgram(address: string): Promise<void>;
}