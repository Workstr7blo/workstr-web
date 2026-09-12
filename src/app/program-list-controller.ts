import type { RelayProgram } from '../nostr/canon';
import type { SheetWithExercises } from '../db/store';
import { sheetToProgram } from '../features/sheets/views';
import type { ProgramBrowser } from '../features/sheets/program-browser';
import { renderProgramResults, updateProgramFilterSheet } from './browse-surfaces';
import type { AppState } from './state';

export interface ProgramListContext {
  root: HTMLElement;
  state: AppState;
  render(): void;
  toast(message: string, kind?: 'ok' | 'bad'): void;
  startTraining(program: RelayProgram): void;
  importProgram(program: RelayProgram, button: HTMLButtonElement): Promise<void>;
  openBuilder(sheet: SheetWithExercises): void;
  // The three actions a card offers that belong to other controllers. They take the same
  // scope for the same reason everything here does.
  bindPublish(scope: ParentNode): void;
  bindTip(scope: ParentNode): void;
}

const LIST_IDS: Record<ProgramBrowser, string> = {
  programs: '#programs-list',
  discover: '#program-discover-list'
};

/**
 * The two program lists: what a card does, and writing a list when a filter changes what
 * belongs in it.
 *
 * Card bindings are scoped rather than delegated. A filter rewrites a list without the page
 * around it being rendered, so the new cards need listeners; the nodes are freshly written,
 * so binding them cannot double a listener on one that was already there. The exercise
 * grids delegate instead - one action per card there, nine here, and a delegated dispatch
 * of nine reads worse than nine bindings.
 */
export function createProgramList(ctx: ProgramListContext) {
  const { root, state, render, toast } = ctx;

  function bindCards(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('[data-toggle-program]').forEach((header) => header.addEventListener('click', () => {
      const address = header.dataset.toggleProgram || null;
      state.expandedProgramAddress = state.expandedProgramAddress === address ? null : address;
      render();
    }));
    scope.querySelectorAll<HTMLElement>('[data-toggle-exitem]').forEach((header) => header.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = header.dataset.toggleExitem;
      const item = key ? root.querySelector<HTMLElement>(`[data-exitem="${CSS.escape(key)}"]`) : null;
      item?.classList.toggle('open');
    }));
    scope.querySelectorAll<HTMLElement>('[data-start-program]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const address = button.dataset.startProgram;
      const program = state.sheets.map(sheetToProgram).find((item) => item.address === address);
      if (program) ctx.startTraining(program);
    }));
    scope.querySelectorAll<HTMLElement>('[data-import-program]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const program = state.programs.find((item) => item.address === button.dataset.importProgram);
      if (program) await ctx.importProgram(program, button as HTMLButtonElement);
    }));
    scope.querySelectorAll<HTMLElement>('[data-edit-sheet]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const sheet = state.sheets.find((item) => item.id === Number(button.dataset.editSheet));
      if (sheet) ctx.openBuilder(sheet);
    }));
    scope.querySelectorAll<HTMLElement>('[data-del-sheet]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!state.store || !window.confirm('Delete this program?')) return;
      await state.store.deleteSheet(Number(button.dataset.delSheet) || 0);
      state.sheets = await state.store.listSheets();
      render();
      toast('Program deleted');
    }));
    ctx.bindPublish(scope);
    ctx.bindTip(scope);
  }

  // The toolbar above the list, and the search field being typed into, are not touched.
  function renderList(context: ProgramBrowser): void {
    renderProgramResults(root, state, context);
    const list = root.querySelector(LIST_IDS[context]);
    if (list) bindCards(list);
    updateProgramFilterSheet(root, state);
  }

  // A catalog answer changes both lists at once - the local one shares the relay's exercise
  // names, the Discover one is the answer itself - and both are in the page's markup even
  // when only one sub-panel is showing, so both are written.
  function renderMounted(): void {
    (Object.keys(LIST_IDS) as ProgramBrowser[]).forEach((context) => {
      if (root.querySelector(LIST_IDS[context])) renderList(context);
    });
  }

  return { bindCards, renderList, renderMounted };
}
