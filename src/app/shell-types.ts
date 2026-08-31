import type { ProgramPublishControllerContext } from './program-publish-controller';
import type { AppState } from './state';

export interface ShellOptions {
  programPublish?: Pick<ProgramPublishControllerContext, 'getSigner' | 'publishCreatorProgram' | 'programPublishRelays'>;
  skipCatalogRefresh?: boolean;
}

export interface ShellHandle {
  state: AppState;
  ready: Promise<void>;
  publishProgram(address: string): Promise<void>;
}