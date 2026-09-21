// Locks Workstr after a stretch of real inactivity, through the same `lock()` the Lock Workstr
// button uses - the vault forgets its key, the signer and the Tip Jar wallet close, and the
// device code is asked for again. There is no second, partial kind of locked.
//
// Inactivity, not backgrounding. Between sets people switch to music, read a message and lock
// the phone; locking every time the app is hidden would put the code prompt in front of every
// set. Time away does count, though: coming back after longer than the limit finds the app
// locked, because the timer is judged against the clock, not against how long it was running.
// A live workout counts as activity - an EMOM clock can run for half an hour untouched.
//
// This is not `VAULT_UPDATE_AWAY_MS` in `update-controller.ts`, which only decides when a PWA
// update may reload. The two do different jobs and are tuned separately.
export type AutoLockSetting = '15' | '30' | '60' | 'close';

export const AUTO_LOCK_KEY = 'workstr.autoLock';
export const DEFAULT_AUTO_LOCK: AutoLockSetting = '30';
export const AUTO_LOCK_OPTIONS: Array<{ value: AutoLockSetting; label: string }> = [
  { value: '15', label: 'After 15 minutes' },
  { value: '30', label: 'After 30 minutes' },
  { value: '60', label: 'After 1 hour' },
  { value: 'close', label: 'When Workstr closes' }
];

const CHECK_EVERY_MS = 30 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

// A device preference, like the device code itself: it is kept in this browser and never synced.
export function readAutoLockSetting(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): AutoLockSetting {
  try {
    const value = storage?.getItem(AUTO_LOCK_KEY);
    return AUTO_LOCK_OPTIONS.some((option) => option.value === value) ? value as AutoLockSetting : DEFAULT_AUTO_LOCK;
  } catch {
    return DEFAULT_AUTO_LOCK;
  }
}

export function writeAutoLockSetting(value: AutoLockSetting, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(AUTO_LOCK_KEY, value);
  } catch {
    // Storage refused: the choice lasts for this session only, which is still a choice.
  }
}

/** Milliseconds of inactivity before locking, or null for "only when Workstr closes". */
export function autoLockDelay(setting: AutoLockSetting): number | null {
  return setting === 'close' ? null : Number(setting) * 60 * 1000;
}

export interface AutoLockContext {
  root: HTMLElement;
  isUnlocked(): boolean;
  lock(): void;
  /** Something is running that counts as activity on its own, such as a live workout. */
  busy?(): boolean;
  now?(): number;
  setting?(): AutoLockSetting;
  target?: Document;
}

export function createAutoLock(ctx: AutoLockContext) {
  const now = ctx.now || Date.now;
  const target = ctx.target || document;
  let setting = ctx.setting ? ctx.setting() : readAutoLockSetting();
  let lastActivity = now();

  const touch = (): void => { lastActivity = now(); };

  function check(): void {
    if (!ctx.isUnlocked()) { touch(); return; }
    if (ctx.busy?.()) { touch(); return; }
    const delay = autoLockDelay(setting);
    if (delay === null || now() - lastActivity < delay) return;
    touch();
    ctx.lock();
  }

  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, touch, { capture: true, passive: true });
  // Background timers are throttled or frozen on phones, so the interval alone cannot be
  // trusted to fire on time; coming back to the app is the moment that always gets checked.
  target.addEventListener('visibilitychange', () => { if (target.visibilityState === 'visible') check(); });
  const timer = setInterval(check, CHECK_EVERY_MS);

  // The Settings select, delegated so it survives every Settings render.
  ctx.root.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.id !== 'auto-lock-select') return;
    const next = AUTO_LOCK_OPTIONS.find((option) => option.value === select.value)?.value;
    if (!next) return;
    setting = next;
    writeAutoLockSetting(next);
    touch();
  });

  return {
    check,
    touch,
    stop(): void { clearInterval(timer); }
  };
}
