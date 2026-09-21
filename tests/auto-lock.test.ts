// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_LOCK_KEY, autoLockDelay, createAutoLock, readAutoLockSetting, writeAutoLockSetting, type AutoLockSetting } from '../src/app/auto-lock';
import { deviceSecurityCard } from '../src/app/device-vault-view';
import type { AppState } from '../src/app/state';

const MINUTE = 60 * 1000;

function harness(options: { setting?: AutoLockSetting; busy?: boolean; unlocked?: boolean } = {}) {
  let clock = 0;
  let unlocked = options.unlocked ?? true;
  let busy = options.busy ?? false;
  let visibility: DocumentVisibilityState = 'visible';
  const target = new EventTarget() as unknown as Document;
  Object.defineProperty(target, 'visibilityState', { get: () => visibility });
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  // The real lock ends in the unlock prompt; the vault is locked from here on.
  const lock = vi.fn(() => { unlocked = false; });
  const auto = createAutoLock({ root, target, isUnlocked: () => unlocked, lock, busy: () => busy, now: () => clock, setting: () => options.setting ?? '30' });
  return {
    auto, lock, root,
    advance(ms: number) { clock += ms; },
    tap() { target.dispatchEvent(new Event('pointerdown')); },
    hide() { visibility = 'hidden'; target.dispatchEvent(new Event('visibilitychange')); },
    show() { visibility = 'visible'; target.dispatchEvent(new Event('visibilitychange')); },
    setBusy(value: boolean) { busy = value; },
    unlock() { unlocked = true; }
  };
}

describe('auto-lock', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('defaults to thirty minutes and offers the lengths the issue asks for', () => {
    expect(readAutoLockSetting()).toBe('30');
    expect([autoLockDelay('15'), autoLockDelay('30'), autoLockDelay('60'), autoLockDelay('close')]).toEqual([15 * MINUTE, 30 * MINUTE, 60 * MINUTE, null]);
  });

  it('locks after the limit without activity, through the explicit lock', () => {
    const h = harness();
    h.advance(29 * MINUTE);
    h.auto.check();
    expect(h.lock).not.toHaveBeenCalled();
    h.advance(1 * MINUTE);
    h.auto.check();
    expect(h.lock).toHaveBeenCalledTimes(1);
  });

  it('starts the clock again on every tap or key', () => {
    const h = harness();
    h.advance(25 * MINUTE);
    h.tap();
    h.advance(25 * MINUTE);
    h.auto.check();
    expect(h.lock).not.toHaveBeenCalled();
  });

  it('does not lock for a brief trip to another app', () => {
    const h = harness();
    h.advance(5 * MINUTE);
    h.hide();
    h.advance(3 * MINUTE);
    h.show();
    expect(h.lock).not.toHaveBeenCalled();
  });

  // Background timers freeze on phones, so the return is when a long absence is noticed.
  it('locks on return after being away longer than the limit', () => {
    const h = harness({ setting: '15' });
    h.hide();
    h.advance(20 * MINUTE);
    h.show();
    expect(h.lock).toHaveBeenCalledTimes(1);
  });

  it('keeps a live workout open however long nobody touches it', () => {
    const h = harness();
    h.setBusy(true);
    h.advance(45 * MINUTE);
    h.auto.check();
    expect(h.lock).not.toHaveBeenCalled();
    // The workout ending starts the clock rather than locking at once.
    h.setBusy(false);
    h.auto.check();
    expect(h.lock).not.toHaveBeenCalled();
  });

  it('never locks when set to lock only when Workstr closes', () => {
    const h = harness({ setting: 'close' });
    h.advance(24 * 60 * MINUTE);
    h.auto.check();
    expect(h.lock).not.toHaveBeenCalled();
  });

  it('does nothing while the vault is already locked, and starts afresh after unlocking', () => {
    const h = harness();
    h.advance(31 * MINUTE);
    h.auto.check();
    expect(h.lock).toHaveBeenCalledTimes(1);
    h.advance(10 * MINUTE);
    h.auto.check();
    h.unlock();
    h.advance(1 * MINUTE);
    h.auto.check();
    expect(h.lock).toHaveBeenCalledTimes(1);
  });

  it('checks on its own interval', () => {
    vi.useFakeTimers();
    const lock = vi.fn();
    let clock = 0;
    document.body.innerHTML = '<div id="app"></div>';
    const auto = createAutoLock({ root: document.getElementById('app')!, target: new EventTarget() as unknown as Document, isUnlocked: () => true, lock, now: () => clock, setting: () => '15' });
    clock = 16 * MINUTE;
    vi.advanceTimersByTime(30 * 1000);
    expect(lock).toHaveBeenCalledTimes(1);
    auto.stop();
  });

  it('saves the Settings choice on this device and applies it at once', () => {
    const h = harness();
    h.root.innerHTML = deviceSecurityCard({ deviceVault: 'unlocked' } as AppState);
    const select = h.root.querySelector<HTMLSelectElement>('#auto-lock-select')!;
    expect(select.value).toBe('30');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['After 15 minutes', 'After 30 minutes', 'After 1 hour', 'When Workstr closes']);
    select.value = '15';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(localStorage.getItem(AUTO_LOCK_KEY)).toBe('15');
    h.advance(16 * MINUTE);
    h.auto.check();
    expect(h.lock).toHaveBeenCalledTimes(1);
  });

  it('ignores a stored value it does not know', () => {
    writeAutoLockSetting('5' as AutoLockSetting);
    expect(readAutoLockSetting()).toBe('30');
  });
});
