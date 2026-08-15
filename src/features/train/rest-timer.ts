import { html } from '../../app/format';
import { CountdownCueGuard, playCountdownCue } from './countdown-audio';
import { restSecondsRemaining } from './session-logic';

export class RestTimer {
  private timer = 0;
  private total = 0;
  private remaining = 0;
  private endsAt = 0;
  private autoAdvance = false;
  private period = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly cueGuard: CountdownCueGuard,
    private readonly onComplete: (autoAdvance: boolean) => void
  ) {}

  get active(): boolean { return this.endsAt > 0; }

  start(seconds: number, autoAdvance: boolean, nextExerciseName = ''): void {
    this.root.querySelector('#session-rest-overlay')?.classList.add('show');
    this.total = Number(seconds) || 90;
    this.remaining = this.total;
    this.endsAt = Date.now() + this.total * 1000;
    this.period += 1;
    this.autoAdvance = autoAdvance;
    const nextUp = this.root.querySelector('#rest-nextup');
    if (nextUp) nextUp.innerHTML = nextExerciseName ? `Next up: <b>${html(nextExerciseName)}</b>` : '';
    this.updateView();
    this.cue();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.reconcile(), 1000);
  }

  reconcile(): void {
    if (!this.endsAt) return;
    this.remaining = restSecondsRemaining(this.endsAt);
    this.updateView();
    this.cue();
    if (this.remaining > 0) return;
    const autoAdvance = this.autoAdvance;
    this.skip();
    this.onComplete(autoAdvance);
  }

  adjust(delta: number): void {
    if (this.endsAt) this.remaining = restSecondsRemaining(this.endsAt);
    this.remaining = Math.max(5, this.remaining + delta);
    this.endsAt = Date.now() + this.remaining * 1000;
    if (this.total < this.remaining) this.total = this.remaining;
    this.updateView();
  }

  skip(): void {
    window.clearInterval(this.timer);
    this.endsAt = 0;
    this.autoAdvance = false;
    this.root.querySelector('#session-rest-overlay')?.classList.remove('show');
  }

  stop(): void {
    this.skip();
    this.total = 0;
    this.remaining = 0;
  }

  private cue(): void {
    const cue = this.remaining === 0
      ? this.cueGuard.finish('rest', this.period)
      : this.cueGuard.countdown('rest', this.period, this.remaining);
    playCountdownCue(cue);
  }

  private updateView(): void {
    const value = this.root.querySelector('#session-rest-val');
    if (value) value.textContent = String(this.remaining);
    const ring = this.root.querySelector<SVGCircleElement>('#rest-ring-fg');
    if (!ring) return;
    const circumference = 339.3;
    const offset = this.total > 0 ? circumference * (1 - this.remaining / this.total) : 0;
    ring.style.strokeDashoffset = String(Math.max(0, Math.min(circumference, offset)));
    ring.style.stroke = this.remaining <= 5 ? 'var(--danger-red)' : 'var(--sovereign-purple)';
  }
}
