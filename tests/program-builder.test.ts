import { describe, expect, it, vi } from 'vitest';
import { createProgramBuilder } from '../src/app/program-builder';
import type { AppState } from '../src/app/state';
import type { WorkstrStore } from '../src/db/store';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  document.body.innerHTML = '<div id="app"><div id="modal"><button id="modal-close"></button><div id="modal-content"></div></div></div>';
  const root = document.getElementById('app') as HTMLElement;
  const saveSheet = vi.fn(async () => 1);
  const store = {
    listExercises: async () => [{ slug: 'squat', name: 'Squat', muscle_group: 'Quadriceps', default_sets: 3, default_reps: '8', default_rest: 60 }],
    saveSheet,
    listSheets: async () => []
  } as unknown as WorkstrStore;
  const state = { store, settings: { unit: 'kg' }, sheets: [] } as unknown as AppState;
  const render = vi.fn();
  const toast = vi.fn();
  const closeModal = vi.fn();
  const controller = createProgramBuilder({
    root, state, render, toast, closeModal,
    openModal: (content) => { root.querySelector('#modal-content')!.innerHTML = content; }
  });
  return { root, controller, saveSheet, render, toast, closeModal };
}

describe('program builder controller', () => {
  it('creates a normal program from a library exercise', async () => {
    const { root, controller, saveSheet, render, closeModal } = setup();
    await controller.open();
    (root.querySelector('[data-pick-slug="squat"]') as HTMLElement).click();
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Leg Day';
    name.dispatchEvent(new Event('input'));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Leg Day',
      exercises: [expect.objectContaining({ exercise_slug: 'squat', sets: 3, reps: '8' })]
    }), undefined);
    expect(closeModal).toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
  });

  it('keeps invalid empty programs open with a useful error', async () => {
    const { root, controller, saveSheet, toast } = setup();
    await controller.open();
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('name is required', 'bad');
  });
});
