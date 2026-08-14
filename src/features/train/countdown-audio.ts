export type CountdownCue = 'short' | 'final';

export class CountdownCueGuard {
  private played = new Set<string>();

  countdown(channel: string, period: string | number, secondsRemaining: number): CountdownCue | null {
    if (secondsRemaining < 1 || secondsRemaining > 5) return null;
    return this.once(`${channel}:${period}:${secondsRemaining}`, 'short');
  }

  finish(channel: string, period: string | number): CountdownCue | null {
    return this.once(`${channel}:${period}:final`, 'final');
  }

  reset(): void {
    this.played.clear();
  }

  private once(key: string, cue: CountdownCue): CountdownCue | null {
    if (this.played.has(key)) return null;
    this.played.add(key);
    return cue;
  }
}

let audioContext: AudioContext | null = null;

export function unlockCountdownAudio(): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
  } catch { /* Audio cues are an optional enhancement. */ }
}

export function playCountdownCue(cue: CountdownCue | null): void {
  if (!cue || !audioContext || audioContext.state !== 'running') return;
  try {
    const now = audioContext.currentTime;
    const duration = cue === 'final' ? 0.32 : 0.09;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(cue === 'final' ? 1175 : 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(cue === 'final' ? 0.16 : 0.1, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch { /* Never let a device audio failure interrupt a workout. */ }
}
