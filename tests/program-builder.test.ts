// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createProgramBuilder } from '../src/app/program-builder';
import type { AppState } from '../src/app/state';
import type { SheetWithExercises, WorkstrStore } from '../src/db/store';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function publishedSheet(pubkey: string): SheetWithExercises {
  return {
    id: 7,
    slug: 'leg-day',
    name: 'Leg Day',
    notes: '',
    difficulty: 'beginner',
    tags: ['strength'],
    is_temporary: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    nostr_pubkey: pubkey,
    nostr_address: `33402:${pubkey}:workstr:beastmode:program:leg-day`,
    nostr_event_id: 'event1',
    nostr_published_at: '2026-09-01T00:00:00.000Z',
    origin_created_at: 1788220800,
    exercises: [{ id: 1, sheet_id: 7, exercise_slug: 'squat', exercise_name: 'Squat', muscle_group: 'Quadriceps', image_url: '', position: 0, sets: 3, reps: '8', rest: 60, weight: 0, notes: '' }]
  };
}

function setup(statePatch: Partial<AppState> = {}) {
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
  const state = { store, settings: { unit: 'kg' }, sheets: [], ...statePatch } as unknown as AppState;
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
    (root.querySelector('[data-goal="strength"]') as HTMLElement).click();
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Leg Day';
    name.dispatchEvent(new Event('input'));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Leg Day',
      tags: ['strength'],
      exercises: [expect.objectContaining({ exercise_slug: 'squat', sets: 3, reps: '8' })]
    }), undefined);
    expect(closeModal).toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
  });

  it('keeps the publication identity when editing your own published program', async () => {
    const { root, controller, saveSheet } = setup({ pubkey: ME });
    await controller.open(publishedSheet(ME));
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Leg Day Heavy';
    name.dispatchEvent(new Event('input'));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Leg Day Heavy',
      nostr_pubkey: ME,
      nostr_address: `33402:${ME}:workstr:beastmode:program:leg-day`,
      nostr_event_id: 'event1',
      nostr_published_at: '2026-09-01T00:00:00.000Z',
      origin_created_at: 1788220800
    }), 7);
  });

  it("forks another author's imported program when it is edited", async () => {
    const { root, controller, saveSheet } = setup({ pubkey: ME });
    await controller.open(publishedSheet(OTHER));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.not.objectContaining({ nostr_address: expect.anything() }), 7);
    expect(saveSheet).toHaveBeenCalledWith(expect.not.objectContaining({ nostr_pubkey: expect.anything() }), 7);
  });

  it('replaces the comma tag field with capped goal chips and detected labels', async () => {
    const { root, controller, saveSheet } = setup();
    await controller.open();
    expect(root.querySelector('#sheet-tags')).toBeNull();
    (root.querySelector('[data-pick-slug="push-up"]') as HTMLElement).click();
    expect(root.querySelector('.builder-auto-labels')?.textContent).toContain('Upper Body');
    for (const goal of ['strength', 'hypertrophy', 'conditioning']) {
      (root.querySelector(`[data-goal="${goal}"]`) as HTMLElement).click();
    }
    const name = root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Goal Test';
    name.dispatchEvent(new Event('input'));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();

    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      tags: ['strength', 'hypertrophy']
    }), undefined);
    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      tags: expect.not.arrayContaining(['conditioning'])
    }), undefined);
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
    const duration = root.querySelector<HTMLInputElement>('[data-section-field="durationMin"]')!;
    duration.value = '3';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
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
        expect.objectContaining({ exercise_slug: 'plank-to-push-up', sets: 1, reps: '', rest: 60 })
      ]),
      blocks: [{
        type: 'emom',
        // Three minutes of four moves: the section still stops at three minutes.
        totalDurationSec: 180,
        rounds: 1,
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

describe('builder exercise pictures', () => {
  it('shows and saves the library picture over the one the program saved', async () => {
    const sheet = {
      id: 7, slug: 'p', name: 'P', notes: '', difficulty: '', tags: [], is_temporary: false, created_at: '', updated_at: '',
      exercises: [{ id: 1, sheet_id: 7, exercise_slug: 'push-up', exercise_name: 'Push Up', image_url: 'https://x/old.png', position: 0, sets: 3, reps: '10', rest: 60 }]
    } as SheetWithExercises;
    const saveSheet = vi.fn(async () => 7);
    const store = { listExercises: async () => [{ slug: 'push-up', name: 'Push Up', muscle_group: 'Chest', image_url: 'https://x/new.png' }], saveSheet, listSheets: async () => [] } as unknown as WorkstrStore;
    const { root, controller } = setup({ store });

    await controller.open(sheet);
    expect(root.querySelector('.wex-img')?.getAttribute('src')).toBe('https://x/new.png');

    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();
    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({ exercises: [expect.objectContaining({ image_url: 'https://x/new.png' })] }), 7);
  });
});

describe('EMOM moves in the builder', () => {
  const minuteLabels = (root: HTMLElement) => [...root.querySelectorAll('.emom-rx-minute-label')].map((label) => label.textContent);
  const moveNames = (root: HTMLElement) => [...root.querySelectorAll('.emom-rx-name strong')].map((name) => name.textContent);

  async function emomBuilder() {
    const app = setup();
    await app.controller.open();
    const mode = app.root.querySelector<HTMLSelectElement>('#sheet-mode')!;
    mode.value = 'emom';
    mode.dispatchEvent(new Event('change'));
    const name = app.root.querySelector<HTMLInputElement>('#sheet-name')!;
    name.value = 'Minute work';
    name.dispatchEvent(new Event('input'));
    return app;
  }
  const addMoves = (root: HTMLElement, sectionIndex: number, ...slugs: string[]) => {
    (root.querySelector(`[data-toggle-section-picker="${sectionIndex}"]`) as HTMLButtonElement).click();
    for (const slug of slugs) (root.querySelector(`[data-section-exercise="${sectionIndex}"][data-slug="${slug}"]`) as HTMLButtonElement).click();
  };

  it('schedules moves by their order, with no minute to type, and keeps the total duration', async () => {
    const { root, saveSheet } = await emomBuilder();
    addMoves(root, 0, 'sit-up', 'leg-raise', 'squat');
    expect(root.querySelector('[data-f="intervalIndex"]')).toBeNull();
    expect(minuteLabels(root)).toEqual(['Minute 1', 'Minute 2', 'Minute 3']);
    expect(root.querySelector('.emom-section-help')?.textContent).toBe('One move begins each minute, in the order shown.');
    expect(root.querySelector('.emom-section-title span')?.textContent).toBe('10 min · 10 intervals · 3 moves');

    (root.querySelector('[aria-label="Move Squat up"]') as HTMLButtonElement).click();
    expect(moveNames(root)).toEqual(['Sit Up', 'Squat', 'Leg Raise']);
    expect(root.querySelector('[aria-label="Move Sit Up up"]')?.hasAttribute('disabled')).toBe(true);

    (root.querySelector('[aria-label="Remove Sit Up"] svg') as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(moveNames(root)).toEqual(['Squat', 'Leg Raise']);
    expect(minuteLabels(root)).toEqual(['Minute 1', 'Minute 2']);

    const duration = root.querySelector<HTMLInputElement>('[data-section-field="durationMin"]')!;
    duration.value = '8';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.emom-section-title span')?.textContent).toBe('8 min · 8 intervals · 2 moves');

    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();
    expect(saveSheet).toHaveBeenCalledWith(expect.objectContaining({
      blocks: [expect.objectContaining({
        type: 'emom', totalDurationSec: 480, rounds: 4,
        intervals: [
          expect.objectContaining({ steps: [expect.objectContaining({ exerciseSlug: 'squat' })] }),
          expect.objectContaining({ steps: [expect.objectContaining({ exerciseSlug: 'leg-raise' })] })
        ]
      })]
    }), undefined);
  });

  it('opens a legacy section at its real length and says shared minutes were split', async () => {
    const { root, controller } = setup();
    await controller.open({
      id: 5, slug: 'legacy', name: 'Legacy', notes: '', difficulty: '', tags: [], is_temporary: false, created_at: '', updated_at: '', exercises: [],
      blocks: [{ type: 'emom', rounds: 10, intervals: [
        { durationSec: 60, steps: [{ exerciseSlug: 'sit-up', exerciseName: 'Sit Up' }, { exerciseSlug: 'leg-raise', exerciseName: 'Leg Raise' }] },
        { durationSec: 60, steps: [{ exerciseSlug: 'squat', exerciseName: 'Squat' }] }
      ] }]
    } as SheetWithExercises);
    expect(root.querySelector<HTMLInputElement>('[data-section-field="durationMin"]')?.value).toBe('20');
    expect(root.querySelector('.emom-section-note')?.textContent).toContain('shared a minute');
    expect(minuteLabels(root)).toEqual(['Minute 1', 'Minute 2', 'Minute 3']);
  });

  it('refuses a section with no moves', async () => {
    const { root, saveSheet, toast } = await emomBuilder();
    addMoves(root, 0, 'sit-up');
    (root.querySelector('#add-emom-section') as HTMLButtonElement).click();
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();
    expect(saveSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Add a move to every EMOM section', 'bad');
  });

  it('refuses a timed target longer than the minute', async () => {
    const { root, saveSheet, toast } = await emomBuilder();
    addMoves(root, 0, 'sit-up');
    const type = root.querySelector<HTMLSelectElement>('.emom-rx-type')!;
    type.value = 'seconds';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.emom-rx-value')?.getAttribute('max')).toBe('60');
    const seconds = root.querySelector<HTMLInputElement>('.emom-rx-value')!;
    seconds.value = '75';
    seconds.dispatchEvent(new Event('input', { bubbles: true }));
    (root.querySelector('#sheet-save') as HTMLButtonElement).click();
    await tick();
    expect(saveSheet).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Timed steps cannot exceed the interval length', 'bad');
  });
});
