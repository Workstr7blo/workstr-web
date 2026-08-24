// @vitest-environment jsdom
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
    listExercises: async () => [
      { slug: 'push-up', name: 'Push Up', muscle_group: 'Chest', default_sets: 4, default_reps: '15', default_rest: 30 },
      { slug: 'supermen', name: 'Supermen', muscle_group: 'Back', default_sets: 4, default_reps: '15', default_rest: 30 },
      { slug: 'triceps-dip', name: 'Triceps Dip', muscle_group: 'Triceps', default_sets: 4, default_reps: '15', default_rest: 45 },
      { slug: 'plank-to-push-up', name: 'Plank to Push Up', muscle_group: 'Core', default_sets: 3, default_reps: '40', default_rest: 20 },
      { slug: 'sit-up', name: 'Sit Up', muscle_group: 'Core', default_sets: 3, default_reps: '40', default_rest: 20 },
      { slug: 'shoulder-tap', name: 'Shoulder Tap', muscle_group: 'Core', default_sets: 3, default_reps: '40', default_rest: 20 },
      { slug: 'leg-raise', name: 'Leg Raise', muscle_group: 'Core', default_sets: 3, default_reps: '40', default_rest: 20 },
      { slug: 'squat', name: 'Squat', muscle_group: 'Quadriceps', default_sets: 3, default_reps: '8', default_rest: 60 }
    ],
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

  it('saves a mixed normal strength section with an EMOM superset circuit', async () => {
    const { root, controller, saveSheet } = setup();
    await controller.open();
    const mode = root.querySelector<HTMLSelectElement>('#sheet-mode')!;
    mode.value = 'mixed';
    mode.dispatchEvent(new Event('change'));
    for (const slug of ['push-up', 'supermen', 'triceps-dip']) {
      (root.querySelector(`[data-pick-slug="${slug}"]`) as HTMLElement).click();
    }
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Strength + core EMOM';
    name.dispatchEvent(new Event('input'));
    const rounds = root.querySelector<HTMLInputElement>('[data-section-field="rounds"]')!;
    rounds.value = '3';
    rounds.dispatchEvent(new Event('input', { bubbles: true }));
    (root.querySelector('[data-toggle-section-picker="0"]') as HTMLButtonElement).click();
    for (const slug of ['plank-to-push-up', 'sit-up', 'shoulder-tap', 'leg-raise']) {
      (root.querySelector(`[data-section-exercise="0"][data-slug="${slug}"]`) as HTMLButtonElement).click();
    }
    expect(root.querySelectorAll<HTMLSelectElement>('.emom-rx-type')).toHaveLength(4);
    while (true) {
      const targetType = [...root.querySelectorAll<HTMLSelectElement>('.emom-rx-type')].find((select) => select.value !== 'seconds');
      if (!targetType) break;
      targetType.value = 'seconds';
      targetType.dispatchEvent(new Event('change', { bubbles: true }));
    }
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Strength + core EMOM',
      exercises: expect.arrayContaining([
        expect.objectContaining({ exercise_slug: 'push-up', sets: 4, reps: '15', rest: 30 }),
        expect.objectContaining({ exercise_slug: 'triceps-dip', sets: 4, reps: '15', rest: 45 }),
        expect.objectContaining({ exercise_slug: 'plank-to-push-up', sets: 3, reps: '', rest: 60 })
      ]),
      blocks: [{
        type: 'emom',
        rounds: 3,
        intervals: [
          expect.objectContaining({ durationSec: 60, steps: [expect.objectContaining({ exerciseSlug: 'plank-to-push-up', targetDurationSec: 40 })] }),
          expect.objectContaining({ durationSec: 60, steps: [expect.objectContaining({ exerciseSlug: 'sit-up', targetDurationSec: 40 })] }),
          expect.objectContaining({ durationSec: 60, steps: [expect.objectContaining({ exerciseSlug: 'shoulder-tap', targetDurationSec: 40 })] }),
          expect.objectContaining({ durationSec: 60, steps: [expect.objectContaining({ exerciseSlug: 'leg-raise', targetDurationSec: 40 })] })
        ]
      }]
    }), undefined);
  });

  it('refuses to put one exercise in both halves of a mixed program', async () => {
    const { root, controller, toast } = setup();
    await controller.open();
    const mode = root.querySelector<HTMLSelectElement>('#sheet-mode')!;
    mode.value = 'mixed';
    mode.dispatchEvent(new Event('change'));
    (root.querySelector('[data-pick-slug="push-up"]') as HTMLElement).click();
    (root.querySelector('[data-toggle-section-picker="0"]') as HTMLButtonElement).click();
    (root.querySelector('[data-section-exercise="0"][data-slug="push-up"]') as HTMLButtonElement).click();
    expect(toast).toHaveBeenCalledWith('Push Up is already in the strength section', 'bad');
    expect(root.querySelectorAll('.emom-prescription-row')).toHaveLength(0);

    (root.querySelector('[data-toggle-section-picker="0"]') as HTMLButtonElement).click();
    (root.querySelector('[data-section-exercise="0"][data-slug="sit-up"]') as HTMLButtonElement).click();
    expect(root.querySelectorAll('.emom-prescription-row')).toHaveLength(1);
    (root.querySelector('[data-pick-slug="sit-up"]') as HTMLElement).click();
    expect(toast).toHaveBeenCalledWith('Sit Up is already in an EMOM section', 'bad');
  });
});
